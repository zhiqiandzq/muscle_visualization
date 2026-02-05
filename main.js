import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ==================== Configuration ====================
const CONFIG = {
  modelPath: '/models/muslce_avatar_with_pose_v8(rename).glb',  // 修改为你的模型路径
  musclePrefix: 'muscle_',
  colors: {
    background: 0xf5f5f5,
    defaultMuscle: 0xcc8888,      // 默认肌肉颜色
    highlightMuscle: 0xff2222,    // 高亮颜色（更鲜艳）
    highlightEmissive: 0xff0000,  // 高亮发光颜色
    hoverMuscle: 0xffcc00,        // 悬停颜色（更亮的黄色）
    hoverEmissive: 0xff8800,      // 悬停发光颜色
    otherMesh: 0xdddddd,          // 其他mesh颜色
  },
  opacity: {
    muscle: 0.9,
    muscleWhenOtherHighlighted: 0.15,  // 当其他肌肉高亮时的透明度
    otherMesh: 0.3,
  },
  // 高亮动画设置
  highlight: {
    pulseSpeed: 2.0,              // 脉动速度
    pulseMin: 0.5,                // 最小发光强度
    pulseMax: 1.0,                // 最大发光强度
  }
};

// ==================== Global State ====================
let scene, camera, renderer, controls;
let raycaster, mouse;
let muscleMeshes = [];           // 所有肌肉mesh
let otherMeshes = [];            // 其他mesh
let selectedMuscle = null;       // 当前选中的肌肉（单选模式）
let selectedMuscles = new Set(); // 多选的肌肉集合
let hoveredMuscle = null;        // 当前悬停的肌肉
let originalMaterials = new Map(); // 存储原始材质
let skeletonHelper = null;       // 骨架辅助显示
let skeletonVisible = false;     // 骨架是否可见
let boneLabels = [];             // 骨骼名称标签
let bones = [];                  // 所有骨骼引用
let jointSpheres = [];           // 关节球体
let boneLines = [];              // 骨骼连接线

// ==================== 名称映射系统 ====================
// 核心映射：原始名称 -> 显示名称
// 这个映射永远不变，即使用户多次修改名称，也能通过原始名称找到当前的显示名称
let originalToDisplayName = new Map();  // mesh.name (原始名称) -> displayName (显示名称)

// 肌肉分组：显示名称 -> 原始名称数组
// 当多个肌肉共享同一个显示名称时，点击该名称会高亮所有相关肌肉
let muscleGroups = new Map();  // displayName -> [originalName1, originalName2, ...]

// 通过原始名称获取mesh
let meshByOriginalName = new Map();  // originalName -> mesh

// LocalStorage key
const STORAGE_KEY = 'muscle_display_names';

// 从 localStorage 加载映射
function loadNameMappingFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const mapping = JSON.parse(stored);
      originalToDisplayName.clear();
      Object.entries(mapping).forEach(([original, display]) => {
        originalToDisplayName.set(original, display);
      });
      console.log(`📂 Loaded ${Object.keys(mapping).length} name mappings from localStorage`);
    }
  } catch (e) {
    console.error('Failed to load name mappings from localStorage:', e);
  }
}

// 保存映射到 localStorage
function saveNameMappingToStorage() {
  try {
    const mapping = Object.fromEntries(originalToDisplayName);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mapping));
    console.log(`💾 Saved ${originalToDisplayName.size} name mappings to localStorage`);
  } catch (e) {
    console.error('Failed to save name mappings to localStorage:', e);
  }
}

// ==================== Initialization ====================
function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.colors.background);

  // Camera
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 1.5, 3);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  document.getElementById('viewer-container').appendChild(renderer.domElement);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 1, 0);

  // Raycaster for mouse picking
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Lighting
  setupLighting();

  // Event listeners
  setupEventListeners();

  // Load model
  loadModel();

  // Start render loop
  animate();
}

function setupLighting() {
  // Ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  // Directional light
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Hemisphere light for better color
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
  scene.add(hemiLight);

  // Grid helper
  const gridHelper = new THREE.GridHelper(10, 20, 0xcccccc, 0xeeeeee);
  scene.add(gridHelper);
}

function setupEventListeners() {
  // Window resize
  window.addEventListener('resize', onWindowResize);

  // Mouse events for raycasting
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onMouseClick);

  // Sidebar buttons
  document.getElementById('btn-show-all').addEventListener('click', showAllMuscles);
  document.getElementById('btn-hide-all').addEventListener('click', hideAllMuscles);
  document.getElementById('btn-close-panel').addEventListener('click', clearSelection);
  document.getElementById('btn-hide').addEventListener('click', hideSelected);
  document.getElementById('btn-focus').addEventListener('click', focusOnSelected);
  
  // Apply name button
  document.getElementById('btn-apply-name').addEventListener('click', applyDisplayName);
  
  // Enter key to apply name
  document.getElementById('info-display-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') applyDisplayName();
  });

  // Search input
  document.getElementById('search-input').addEventListener('input', onSearchInput);
  
  // Multi-select controls
  document.getElementById('btn-clear-selection').addEventListener('click', clearMultiSelection);
  document.getElementById('btn-rename').addEventListener('click', openRenameModal);
  document.getElementById('btn-ungroup').addEventListener('click', openUngroupModal);
  
  // Rename modal
  document.getElementById('btn-close-modal').addEventListener('click', closeRenameModal);
  document.getElementById('btn-cancel-rename').addEventListener('click', closeRenameModal);
  document.getElementById('btn-confirm-rename').addEventListener('click', confirmRename);
  
  // Ungroup modal
  document.getElementById('btn-close-ungroup-modal').addEventListener('click', closeUngroupModal);
  document.getElementById('btn-cancel-ungroup').addEventListener('click', closeUngroupModal);
  document.getElementById('btn-confirm-ungroup').addEventListener('click', confirmUngroup);
  
  // Selection panel reset button
  document.getElementById('btn-reset-selected').addEventListener('click', ungroupCurrentSelection);
  
  // Export JSON
  document.getElementById('btn-export-json').addEventListener('click', exportToJsonFile);
  document.getElementById('btn-import-json').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', importFromJsonFile);
  document.getElementById('btn-reset-all').addEventListener('click', resetAllNames);
  
  // Skeleton toggle
  document.getElementById('btn-toggle-skeleton').addEventListener('click', toggleSkeleton);
}

// ==================== Model Loading ====================
function loadModel() {
  const loader = new GLTFLoader();
  
  loader.load(
    CONFIG.modelPath,
    (gltf) => {
      const model = gltf.scene;
      
      // Process all meshes
      model.traverse((child) => {
        if (child.isMesh || child.isSkinnedMesh) {
          const name = child.name.toLowerCase();
          
          if (name.startsWith(CONFIG.musclePrefix)) {
            // This is a muscle mesh
            setupMuscleMesh(child);
            muscleMeshes.push(child);
          } else {
            // Other meshes - make semi-transparent and non-interactive
            setupOtherMesh(child);
            otherMeshes.push(child);
          }
        }
      });

      scene.add(model);
      
      // 创建骨架可视化
      setupSkeletonHelper(model);
      
      // 从 localStorage 加载保存的名称映射
      loadNameMappingFromStorage();
      
      // Build sidebar muscle list
      buildMuscleList();
      
      // Hide loading indicator
      document.getElementById('loading').style.display = 'none';
      
      console.log(`Loaded ${muscleMeshes.length} muscle meshes`);
    },
    (progress) => {
      const percent = (progress.loaded / progress.total * 100).toFixed(0);
      document.querySelector('#loading span').textContent = `Loading... ${percent}%`;
    },
    (error) => {
      console.error('Error loading model:', error);
      document.querySelector('#loading span').textContent = 'Error loading model!';
    }
  );
}

function setupMuscleMesh(mesh) {
  // Create muscle material with emissive support for glow effects
  const material = new THREE.MeshPhysicalMaterial({
    color: CONFIG.colors.defaultMuscle,
    transparent: true,
    opacity: CONFIG.opacity.muscle,
    side: THREE.DoubleSide,
    roughness: 0.5,
    metalness: 0.1,
    emissive: 0x000000,         // 发光颜色（初始关闭）
    emissiveIntensity: 0,       // 发光强度
  });
  
  // Store original material
  originalMaterials.set(mesh.uuid, mesh.material);
  
  mesh.material = material;
  mesh.userData.isMuscle = true;
  mesh.userData.originalColor = CONFIG.colors.defaultMuscle;
  mesh.userData.originalName = mesh.name;  // 保存原始名称
  
  // 建立原始名称到mesh的映射
  meshByOriginalName.set(mesh.name, mesh);
}

function setupOtherMesh(mesh) {
  // Make other meshes semi-transparent and gray
  const material = new THREE.MeshPhysicalMaterial({
    color: CONFIG.colors.otherMesh,
    transparent: true,
    opacity: CONFIG.opacity.otherMesh,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  
  mesh.material = material;
  mesh.userData.isMuscle = false;
}

// ==================== Skeleton Visualization ====================
function setupSkeletonHelper(model) {
  // 收集所有骨骼
  bones = [];
  model.traverse((child) => {
    if (child.isBone) {
      bones.push(child);
    }
  });
  
  if (bones.length === 0) {
    console.log('⚠️ No skeleton found in the model');
    return;
  }
  
  console.log(`🦴 Found ${bones.length} bones`);
  
  // 尝试创建 SkeletonHelper
  model.traverse((child) => {
    if (child.isSkinnedMesh && child.skeleton && !skeletonHelper) {
      skeletonHelper = new THREE.SkeletonHelper(child);
      skeletonHelper.visible = skeletonVisible;
      skeletonHelper.renderOrder = 1000;
      scene.add(skeletonHelper);
      console.log(`🦴 Created SkeletonHelper with ${child.skeleton.bones.length} bones`);
    }
  });
  
  // 创建自定义骨骼连接线（使用圆柱体代替线条，更明显）
  createBoneConnections();
  
  // 为每个骨骼创建关节球体和名称标签
  createBoneLabelsAndJoints();
  
  console.log(`🦴 Found ${bones.length} bones`);
}

// 创建骨骼标签和关节球体
// 当前选中的关节
let selectedJoint = null;
let hoveredJoint = null;

// 创建骨骼连接线（使用圆柱体，更明显）
function createBoneConnections() {
  // 清除旧的连接线
  boneLines.forEach(line => scene.remove(line));
  boneLines = [];
  
  // 连接线材质
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    depthWrite: false,
  });
  
  // 为每个有父骨骼的骨骼创建连接线
  bones.forEach((bone) => {
    if (bone.parent && bone.parent.isBone) {
      // 创建一个圆柱体作为骨骼连接
      const cylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0015, 0.0015, 1, 6),
        lineMaterial.clone()
      );
      cylinder.visible = skeletonVisible;
      cylinder.renderOrder = 999;
      cylinder.userData.childBone = bone;
      cylinder.userData.parentBone = bone.parent;
      scene.add(cylinder);
      boneLines.push(cylinder);
    }
  });
  
  console.log(`🦴 Created ${boneLines.length} bone connections`);
}

// 更新骨骼连接线位置
function updateBoneConnections() {
  boneLines.forEach((cylinder) => {
    const childBone = cylinder.userData.childBone;
    const parentBone = cylinder.userData.parentBone;
    
    if (childBone && parentBone) {
      const childPos = new THREE.Vector3();
      const parentPos = new THREE.Vector3();
      childBone.getWorldPosition(childPos);
      parentBone.getWorldPosition(parentPos);
      
      // 计算中点和长度
      const midPoint = new THREE.Vector3().addVectors(childPos, parentPos).multiplyScalar(0.5);
      const length = childPos.distanceTo(parentPos);
      
      // 设置位置和缩放
      cylinder.position.copy(midPoint);
      cylinder.scale.y = length;
      
      // 设置朝向
      cylinder.lookAt(childPos);
      cylinder.rotateX(Math.PI / 2);
    }
  });
}

function createBoneLabelsAndJoints() {
  // 清除旧的标签和球体
  boneLabels.forEach(label => scene.remove(label));
  jointSpheres.forEach(sphere => scene.remove(sphere));
  boneLabels = [];
  jointSpheres = [];
  
  // 关节球体材质
  const jointGeometry = new THREE.SphereGeometry(0.006, 8, 8);
  
  bones.forEach((bone, index) => {
    // 创建关节球体 - 每个球体有自己的材质以便单独改变颜色
    const jointMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,  // 绿色
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
    });
    
    const sphere = new THREE.Mesh(jointGeometry, jointMaterial);
    sphere.visible = skeletonVisible;
    sphere.renderOrder = 1001;
    sphere.userData.bone = bone;
    sphere.userData.boneIndex = index;
    sphere.userData.isJoint = true;  // 标记为关节
    scene.add(sphere);
    jointSpheres.push(sphere);
    
    // 创建文字标签 - 默认隐藏，只在点击时显示
    const label = createTextSprite(bone.name);
    label.visible = false;  // 默认隐藏
    label.renderOrder = 1002;
    label.userData.bone = bone;
    label.userData.boneIndex = index;
    scene.add(label);
    boneLabels.push(label);
  });
}

// 创建文字精灵
function createTextSprite(text) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  
  // 设置字体和测量文字
  const fontSize = 48;
  context.font = `bold ${fontSize}px Arial`;
  const textWidth = context.measureText(text).width;
  
  // 设置 canvas 大小
  canvas.width = textWidth + 20;
  canvas.height = fontSize + 20;
  
  // 重新设置字体（canvas 大小改变后需要重设）
  context.font = `bold ${fontSize}px Arial`;
  
  // 绘制背景（圆角矩形）
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  const radius = 8;
  context.beginPath();
  context.moveTo(radius, 0);
  context.lineTo(canvas.width - radius, 0);
  context.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
  context.lineTo(canvas.width, canvas.height - radius);
  context.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
  context.lineTo(radius, canvas.height);
  context.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
  context.lineTo(0, radius);
  context.quadraticCurveTo(0, 0, radius, 0);
  context.closePath();
  context.fill();
  
  // 绘制文字
  context.fillStyle = '#00ff00';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  
  // 创建纹理和精灵
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  
  const sprite = new THREE.Sprite(spriteMaterial);
  
  // 设置精灵大小
  const scale = 0.15;
  sprite.scale.set(scale * canvas.width / canvas.height, scale, 1);
  
  return sprite;
}

// 更新骨骼标签和关节球体位置
function updateBoneLabels() {
  if (!skeletonVisible) return;
  
  const offset = new THREE.Vector3(0, 0.02, 0);  // 标签偏移
  
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    const worldPos = new THREE.Vector3();
    bone.getWorldPosition(worldPos);
    
    // 更新关节球体位置
    if (jointSpheres[i]) {
      jointSpheres[i].position.copy(worldPos);
    }
    
    // 更新标签位置（稍微偏移以避免重叠）
    if (boneLabels[i]) {
      boneLabels[i].position.copy(worldPos).add(offset);
    }
  }
  
  // 更新骨骼连接线位置
  updateBoneConnections();
}

function toggleSkeleton() {
  if (bones.length === 0) {
    console.log('No skeleton available');
    return;
  }
  
  skeletonVisible = !skeletonVisible;
  
  // 隐藏骨架时清除关节选择
  if (!skeletonVisible) {
    clearJointSelection();
  }
  
  // 切换骨架线条显示（SkeletonHelper）
  if (skeletonHelper) {
    skeletonHelper.visible = skeletonVisible;
  }
  
  // 切换自定义骨骼连接线显示
  boneLines.forEach(line => {
    line.visible = skeletonVisible;
  });
  
  // 切换关节球体显示
  jointSpheres.forEach(sphere => {
    sphere.visible = skeletonVisible;
    // 重置球体状态
    sphere.material.color.setHex(0x00ff00);
    sphere.scale.setScalar(1);
  });
  
  // 标签默认全部隐藏（只有点击关节时才显示）
  boneLabels.forEach(label => {
    label.visible = false;
  });
  
  // 立即更新位置
  if (skeletonVisible) {
    updateBoneLabels();
  }
  
  // 更新按钮状态
  const btn = document.getElementById('btn-toggle-skeleton');
  if (btn) {
    btn.classList.toggle('active', skeletonVisible);
    btn.textContent = skeletonVisible ? '🦴 Hide Skeleton' : '🦴 Show Skeleton';
  }
  
  console.log(`🦴 Skeleton visibility: ${skeletonVisible}`);
}

// ==================== Sidebar ====================
function buildMuscleList() {
  const listContainer = document.getElementById('muscle-list');
  listContainer.innerHTML = '';
  
  // 重建肌肉分组
  rebuildMuscleGroups();
  
  // 获取所有唯一的显示名称并排序
  const displayNames = new Set();
  muscleMeshes.forEach(mesh => {
    const displayName = originalToDisplayName.get(mesh.name) || mesh.name;
    displayNames.add(displayName);
  });
  
  const sortedNames = [...displayNames].sort((a, b) => a.localeCompare(b));
  
  sortedNames.forEach((displayName) => {
    const originalNames = muscleGroups.get(displayName) || [];
    const meshes = originalNames.map(name => meshByOriginalName.get(name)).filter(m => m);
    
    if (meshes.length === 0) return;
    
    const item = document.createElement('div');
    item.className = 'muscle-item';
    item.dataset.displayName = displayName;
    item.dataset.meshIds = meshes.map(m => m.uuid).join(',');
    
    const isGroup = meshes.length > 1;
    const hasCustomName = meshes.some(m => originalToDisplayName.has(m.name));
    
    if (hasCustomName) {
      item.classList.add('has-custom-name');
    }
    if (isGroup) {
      item.classList.add('is-group');
    }
    
    // 显示名称和原始名称（如果是分组则显示数量）
    const subInfo = isGroup 
      ? `<span class="muscle-original">(${meshes.length} meshes)</span>`
      : (hasCustomName ? `<span class="muscle-original">(${meshes[0].name})</span>` : '');
    
    item.innerHTML = `
      <input type="checkbox" class="muscle-checkbox">
      <span class="muscle-icon">${isGroup ? '[G]' : ''}</span>
      <div class="muscle-name-container">
        <span class="muscle-name">${displayName}</span>
        ${subInfo}
      </div>
      <span class="muscle-toggle">👁️</span>
    `;
    
    // 复选框用于多选
    const checkbox = item.querySelector('.muscle-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMultiSelect(meshes, item, checkbox.checked);
    });
    
    // 点击名称高亮所有相关肌肉
    item.querySelector('.muscle-name').addEventListener('click', () => {
      selectMuscleGroup(meshes, displayName);
    });
    
    // 点击toggle显示/隐藏
    item.querySelector('.muscle-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleGroupVisibility(meshes, item);
    });
    
    listContainer.appendChild(item);
  });
  
  updateSelectionCount();
}

// 重建肌肉分组映射
function rebuildMuscleGroups() {
  muscleGroups.clear();
  
  muscleMeshes.forEach(mesh => {
    const displayName = originalToDisplayName.get(mesh.name) || mesh.name;
    
    if (!muscleGroups.has(displayName)) {
      muscleGroups.set(displayName, []);
    }
    muscleGroups.get(displayName).push(mesh.name);
  });
}

function toggleGroupVisibility(meshes, item) {
  // 检查当前是否全部可见
  const allVisible = meshes.every(m => m.visible);
  const newVisible = !allVisible;
  
  meshes.forEach(mesh => {
    mesh.visible = newVisible;
  });
  
  const toggle = item.querySelector('.muscle-toggle');
  toggle.textContent = newVisible ? '👁️' : '🚫';
  toggle.style.opacity = newVisible ? 1 : 0.5;
}

// ==================== 多选功能 ====================
function toggleMultiSelect(meshes, item, isSelected) {
  meshes.forEach(mesh => {
    if (isSelected) {
      selectedMuscles.add(mesh);
    } else {
      selectedMuscles.delete(mesh);
    }
  });
  
  item.classList.toggle('selected', isSelected);
  updateSelectionCount();
  updateRenameButton();
}

function clearMultiSelection() {
  selectedMuscles.clear();
  
  document.querySelectorAll('.muscle-item').forEach(item => {
    item.classList.remove('selected');
    const checkbox = item.querySelector('.muscle-checkbox');
    if (checkbox) checkbox.checked = false;
  });
  
  updateSelectionCount();
  updateRenameButton();
}

function updateSelectionCount() {
  const count = selectedMuscles.size;
  document.getElementById('selection-count').textContent = `${count} selected`;
}

// ==================== 重命名模态框 ====================
function openRenameModal() {
  if (selectedMuscles.size === 0) return;
  
  const modal = document.getElementById('rename-modal');
  modal.classList.remove('hidden');
  
  document.getElementById('rename-count').textContent = `${selectedMuscles.size} muscle(s) selected`;
  document.getElementById('new-group-name').value = '';
  document.getElementById('new-group-name').focus();
}

function closeRenameModal() {
  document.getElementById('rename-modal').classList.add('hidden');
}

function confirmRename() {
  const newName = document.getElementById('new-group-name').value.trim();
  if (!newName) {
    alert('Please enter a name');
    return;
  }
  
  // 为所有选中的肌肉设置相同的显示名称
  selectedMuscles.forEach(mesh => {
    const originalName = mesh.userData.originalName || mesh.name;
    originalToDisplayName.set(originalName, newName);
  });
  
  // 保存到 localStorage
  saveNameMappingToStorage();
  
  console.log(`✏️ Renamed ${selectedMuscles.size} muscles to: ${newName}`);
  console.log('Current mapping:', Object.fromEntries(originalToDisplayName));
  
  // 关闭模态框并清除选择
  closeRenameModal();
  clearMultiSelection();
  
  // 重建列表
  buildMuscleList();
}

// ==================== Ungroup 功能 ====================
function openUngroupModal() {
  // 收集所有选中的、有自定义名称的肌肉
  const groupedMuscles = [];
  selectedMuscles.forEach(mesh => {
    const originalName = mesh.userData.originalName || mesh.name;
    if (originalToDisplayName.has(originalName)) {
      groupedMuscles.push({
        mesh,
        originalName,
        displayName: originalToDisplayName.get(originalName)
      });
    }
  });
  
  if (groupedMuscles.length === 0) {
    alert('No grouped muscles selected. Select muscles that have been renamed to ungroup them.');
    return;
  }
  
  const modal = document.getElementById('ungroup-modal');
  modal.classList.remove('hidden');
  
  // 构建列表
  const listContainer = document.getElementById('ungroup-list');
  listContainer.innerHTML = '';
  
  groupedMuscles.forEach(({ originalName, displayName }) => {
    const item = document.createElement('div');
    item.className = 'ungroup-item';
    item.innerHTML = `
      <input type="checkbox" class="ungroup-checkbox" data-original="${originalName}" checked>
      <span class="ungroup-display">${displayName}</span>
      <span class="ungroup-arrow">→</span>
      <span class="ungroup-original">${originalName}</span>
    `;
    listContainer.appendChild(item);
  });
  
  document.getElementById('ungroup-info').textContent = 
    `${groupedMuscles.length} grouped muscle(s) found. Select which ones to restore to original names:`;
}

function closeUngroupModal() {
  document.getElementById('ungroup-modal').classList.add('hidden');
}

function confirmUngroup() {
  const checkboxes = document.querySelectorAll('#ungroup-list .ungroup-checkbox:checked');
  
  if (checkboxes.length === 0) {
    alert('Please select at least one muscle to ungroup');
    return;
  }
  
  // 删除选中肌肉的自定义名称映射
  checkboxes.forEach(checkbox => {
    const originalName = checkbox.dataset.original;
    originalToDisplayName.delete(originalName);
    console.log(`Ungrouped: ${originalName}`);
  });
  
  // 保存到 localStorage
  saveNameMappingToStorage();
  
  console.log('Current mapping after ungroup:', Object.fromEntries(originalToDisplayName));
  
  // 关闭模态框并清除选择
  closeUngroupModal();
  clearMultiSelection();
  
  // 重建列表
  buildMuscleList();
}

// 从 selection panel 直接 ungroup 当前选中的肌肉组
function ungroupCurrentSelection() {
  const panel = document.getElementById('selection-panel');
  const selectedOriginalNames = JSON.parse(panel.dataset.selectedMeshes || '[]');
  
  if (selectedOriginalNames.length === 0) return;
  
  // 检查是否有自定义名称
  const hasCustomNames = selectedOriginalNames.some(name => originalToDisplayName.has(name));
  
  if (!hasCustomNames) {
    alert('This muscle/group has no custom name to remove.');
    return;
  }
  
  // 删除所有选中肌肉的自定义名称
  selectedOriginalNames.forEach(originalName => {
    if (originalToDisplayName.has(originalName)) {
      console.log(`Ungrouped: ${originalName} (was: ${originalToDisplayName.get(originalName)})`);
      originalToDisplayName.delete(originalName);
    }
  });
  
  // 保存到 localStorage
  saveNameMappingToStorage();
  
  console.log('Current mapping after ungroup:', Object.fromEntries(originalToDisplayName));
  
  // 关闭面板并重建列表
  clearSelection();
  buildMuscleList();
}

function updateRenameButton() {
  const btnRename = document.getElementById('btn-rename');
  const btnUngroup = document.getElementById('btn-ungroup');
  
  btnRename.disabled = selectedMuscles.size === 0;
  
  // Ungroup 按钮只在有已分组的肌肉被选中时启用
  let hasGroupedMuscles = false;
  selectedMuscles.forEach(mesh => {
    const originalName = mesh.userData.originalName || mesh.name;
    if (originalToDisplayName.has(originalName)) {
      hasGroupedMuscles = true;
    }
  });
  btnUngroup.disabled = !hasGroupedMuscles;
}

function onSearchInput(e) {
  const query = e.target.value.toLowerCase();
  const items = document.querySelectorAll('.muscle-item');
  
  items.forEach((item) => {
    const name = item.querySelector('.muscle-name').textContent.toLowerCase();
    const original = item.querySelector('.muscle-original')?.textContent.toLowerCase() || '';
    item.style.display = (name.includes(query) || original.includes(query)) ? 'flex' : 'none';
  });
}

function toggleMuscleVisibility(mesh, item) {
  mesh.visible = !mesh.visible;
  const toggle = item.querySelector('.muscle-toggle');
  toggle.textContent = mesh.visible ? '👁️' : '🚫';
  toggle.style.opacity = mesh.visible ? 1 : 0.5;
}

function showAllMuscles() {
  muscleMeshes.forEach((mesh) => {
    mesh.visible = true;
  });
  document.querySelectorAll('.muscle-toggle').forEach((toggle) => {
    toggle.textContent = '👁️';
    toggle.style.opacity = 1;
  });
}

function hideAllMuscles() {
  muscleMeshes.forEach((mesh) => {
    mesh.visible = false;
  });
  document.querySelectorAll('.muscle-toggle').forEach((toggle) => {
    toggle.textContent = '🚫';
    toggle.style.opacity = 0.5;
  });
}

// ==================== Selection & Interaction ====================
// 选择一个肌肉组（可能包含多个mesh）
function selectMuscleGroup(meshes, displayName) {
  // 清除之前的高亮
  clearHighlight();
  
  // 创建高亮mesh的Set用于快速查找
  const highlightedSet = new Set(meshes.map(m => m.uuid));
  
  // 降低其他肌肉的透明度，让高亮肌肉更明显
  muscleMeshes.forEach(muscle => {
    if (!highlightedSet.has(muscle.uuid)) {
      // 非高亮肌肉变淡
      muscle.material.opacity = CONFIG.opacity.muscleWhenOtherHighlighted;
      muscle.material.depthWrite = false;
      muscle.renderOrder = 0;
    }
  });
  
  // 皮肤也变得更透明
  otherMeshes.forEach(mesh => {
    mesh.material.opacity = 0.05;
  });
  
  // 高亮所有相关的mesh - 增强视觉效果
  meshes.forEach(mesh => {
    mesh.material.color.setHex(CONFIG.colors.highlightMuscle);
    mesh.material.opacity = 1.0;  // 完全不透明
    mesh.material.depthWrite = true;
    mesh.renderOrder = 999;  // 最后渲染，显示在最前
    
    if (mesh.material.emissive) {
      mesh.material.emissive.setHex(CONFIG.colors.highlightEmissive);
      mesh.material.emissiveIntensity = 1.0;
    }
  });
  
  // 存储高亮的 meshes 用于脉动动画
  highlightedMeshes = [...meshes];
  
  // 设置当前选中（使用第一个mesh作为代表）
  selectedMuscle = meshes[0];
  
  // 更新sidebar active状态
  document.querySelectorAll('.muscle-item').forEach(item => {
    item.classList.remove('active');
  });
  const item = document.querySelector(`.muscle-item[data-display-name="${displayName}"]`);
  if (item) {
    item.classList.add('active');
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  
  // 更新选择面板
  updateSelectionPanelForGroup(meshes, displayName);
}

function selectMuscle(mesh) {
  const originalName = mesh.userData.originalName || mesh.name;
  const displayName = originalToDisplayName.get(originalName) || originalName;
  
  // 获取同组的所有mesh
  const groupMembers = muscleGroups.get(displayName) || [originalName];
  const meshes = groupMembers.map(name => meshByOriginalName.get(name)).filter(m => m);
  
  selectMuscleGroup(meshes, displayName);
}

function clearHighlight() {
  // 清除高亮动画列表
  highlightedMeshes = [];
  
  // 恢复肌肉的原始状态
  muscleMeshes.forEach(mesh => {
    mesh.material.color.setHex(CONFIG.colors.defaultMuscle);
    mesh.material.opacity = CONFIG.opacity.muscle;
    mesh.material.depthWrite = true;
    mesh.renderOrder = 0;
    if (mesh.material.emissive) {
      mesh.material.emissive.setHex(0x000000);
      mesh.material.emissiveIntensity = 0;
    }
  });
  
  // 恢复皮肤的原始透明度
  otherMeshes.forEach(mesh => {
    mesh.material.opacity = CONFIG.opacity.otherMesh;
  });
}

function clearSelection() {
  clearHighlight();
  
  document.querySelectorAll('.muscle-item').forEach(item => {
    item.classList.remove('active');
  });
  
  selectedMuscle = null;
  document.getElementById('selection-panel').classList.add('hidden');
}

function updateSelectionPanelForGroup(meshes, displayName) {
  const panel = document.getElementById('selection-panel');
  panel.classList.remove('hidden');
  
  // 获取原始名称列表
  const originalNames = meshes.map(m => m.userData.originalName || m.name);
  
  // 显示当前显示名称（标题）
  const meshCount = meshes.length > 1 ? ` (${meshes.length} meshes)` : '';
  document.getElementById('selected-name').textContent = displayName + meshCount;
  
  // 显示原始名称（永远不变）
  const originalNamesElement = document.getElementById('info-original-names');
  if (originalNames.length <= 3) {
    originalNamesElement.textContent = originalNames.join(', ');
  } else {
    originalNamesElement.textContent = `${originalNames.slice(0, 3).join(', ')} ... (+${originalNames.length - 3} more)`;
  }
  originalNamesElement.title = originalNames.join('\n');  // hover 显示完整列表
  
  // 输入框显示当前的显示名称
  document.getElementById('info-display-name').value = displayName;
  document.getElementById('info-display-name').placeholder = 'Enter new display name...';
  
  // 存储当前选中的meshes以供Apply使用
  panel.dataset.selectedMeshes = JSON.stringify(originalNames);
}

function updateSelectionPanel(mesh) {
  const originalName = mesh.userData.originalName || mesh.name;
  const displayName = originalToDisplayName.get(originalName) || originalName;
  updateSelectionPanelForGroup([mesh], displayName);
}

// 应用显示名称
function applyDisplayName() {
  const panel = document.getElementById('selection-panel');
  const selectedOriginalNames = JSON.parse(panel.dataset.selectedMeshes || '[]');
  
  if (selectedOriginalNames.length === 0) return;
  
  const input = document.getElementById('info-display-name');
  const newName = input.value.trim();
  
  if (newName) {
    // 为所有选中的mesh设置相同的显示名称
    selectedOriginalNames.forEach(originalName => {
      originalToDisplayName.set(originalName, newName);
    });
    
    // 保存到 localStorage
    saveNameMappingToStorage();
    
    console.log(`✏️ Set display name for ${selectedOriginalNames.length} mesh(es): -> ${newName}`);
    console.log('Original names:', selectedOriginalNames);
    console.log('Current mapping:', Object.fromEntries(originalToDisplayName));
    
    // 重建列表
    buildMuscleList();
    
    // 重新选中该组
    const groupMembers = muscleGroups.get(newName) || [];
    const meshes = groupMembers.map(name => meshByOriginalName.get(name)).filter(m => m);
    if (meshes.length > 0) {
      selectMuscleGroup(meshes, newName);
    }
  } else {
    // 如果输入为空，删除自定义名称（恢复原始名称）
    selectedOriginalNames.forEach(originalName => {
      originalToDisplayName.delete(originalName);
    });
    
    // 保存到 localStorage
    saveNameMappingToStorage();
    
    console.log(`✏️ Removed display names for: ${selectedOriginalNames.join(', ')}`);
    
    // 重建列表
    buildMuscleList();
    clearSelection();
  }
}

function hideSelected() {
  const panel = document.getElementById('selection-panel');
  const selectedOriginalNames = JSON.parse(panel.dataset.selectedMeshes || '[]');
  
  if (selectedOriginalNames.length === 0) return;
  
  // 隐藏所有选中的mesh
  selectedOriginalNames.forEach(originalName => {
    const mesh = meshByOriginalName.get(originalName);
    if (mesh) {
      mesh.visible = false;
    }
  });
  
  // 更新sidebar toggles
  document.querySelectorAll('.muscle-item').forEach((item) => {
    const meshIds = item.dataset.meshIds?.split(',') || [];
    const meshes = meshIds.map(id => muscleMeshes.find(m => m.uuid === id)).filter(m => m);
    const allHidden = meshes.length > 0 && meshes.every(m => !m.visible);
    
    if (allHidden) {
      const toggle = item.querySelector('.muscle-toggle');
      toggle.textContent = '🚫';
      toggle.style.opacity = 0.5;
    }
  });
  
  // Clear selection and close panel
  clearSelection();
  
  console.log(`Hidden muscles: ${selectedOriginalNames.join(', ')}`);
}

function focusOnSelected() {
  const panel = document.getElementById('selection-panel');
  const selectedOriginalNames = JSON.parse(panel.dataset.selectedMeshes || '[]');
  
  if (selectedOriginalNames.length === 0) return;
  
  // 获取所有选中mesh的包围盒
  const box = new THREE.Box3();
  selectedOriginalNames.forEach(originalName => {
    const mesh = meshByOriginalName.get(originalName);
    if (mesh) {
      box.expandByObject(mesh);
    }
  });
  
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  // Animate camera to focus on meshes
  const distance = Math.max(size.x, size.y, size.z) * 2.5;
  const targetPosition = center.clone().add(new THREE.Vector3(0, 0, distance));
  
  // Smooth transition
  controls.target.copy(center);
  camera.position.copy(targetPosition);
}

// ==================== Mouse Events ====================
function onMouseMove(event) {
  // Calculate mouse position in normalized device coordinates
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  
  // 首先检测关节球体（如果骨架可见）
  if (skeletonVisible && jointSpheres.length > 0) {
    const jointIntersects = raycaster.intersectObjects(jointSpheres, false);
    const jointHit = jointIntersects.find(i => i.object.visible && i.object.userData.isJoint);
    
    if (jointHit) {
      const sphere = jointHit.object;
      renderer.domElement.style.cursor = 'pointer';
      
      // 悬停效果
      if (hoveredJoint !== sphere) {
        // 重置之前悬停的关节
        if (hoveredJoint && hoveredJoint !== selectedJoint) {
          hoveredJoint.material.color.setHex(0x00ff00);
          hoveredJoint.scale.setScalar(1);
        }
        
        // 应用新的悬停效果
        hoveredJoint = sphere;
        if (sphere !== selectedJoint) {
          sphere.material.color.setHex(0xffff00);  // 黄色悬停
          sphere.scale.setScalar(1.5);  // 放大
        }
      }
      
      // 显示关节名称 tooltip
      showTooltip(sphere.userData.bone.name, event.clientX, event.clientY);
      return;  // 优先处理关节，不再检测肌肉
    } else {
      // 没有悬停在关节上，重置悬停状态
      if (hoveredJoint && hoveredJoint !== selectedJoint) {
        hoveredJoint.material.color.setHex(0x00ff00);
        hoveredJoint.scale.setScalar(1);
      }
      hoveredJoint = null;
    }
  }
  
  // 检测肌肉 mesh
  const intersects = raycaster.intersectObjects(muscleMeshes, false);
  
  // Find first visible muscle
  let hit = null;
  for (const intersect of intersects) {
    let obj = intersect.object;
    while (obj) {
      if (obj.visible && obj.userData.isMuscle) {
        hit = { ...intersect, object: obj };
        break;
      }
      obj = obj.parent;
    }
    if (hit) break;
  }
  
  if (hit) {
    const mesh = hit.object;
    
    // Update cursor
    renderer.domElement.style.cursor = 'pointer';
    
    // Hover effect
    if (hoveredMuscle !== mesh) {
      // Reset previous hover
      if (hoveredMuscle && hoveredMuscle !== selectedMuscle && !highlightedMeshes.includes(hoveredMuscle)) {
        hoveredMuscle.material.color.setHex(CONFIG.colors.defaultMuscle);
        if (hoveredMuscle.material.emissive) {
          hoveredMuscle.material.emissive.setHex(0x000000);
          hoveredMuscle.material.emissiveIntensity = 0;
        }
      }
      
      // Apply new hover - 增强悬停效果
      hoveredMuscle = mesh;
      if (mesh !== selectedMuscle && !highlightedMeshes.includes(mesh)) {
        mesh.material.color.setHex(CONFIG.colors.hoverMuscle);
        if (mesh.material.emissive) {
          mesh.material.emissive.setHex(CONFIG.colors.hoverEmissive);
          mesh.material.emissiveIntensity = 0.5;
        }
      }
    }
    
    // Show tooltip - 显示自定义名称
    const originalName = mesh.userData.originalName || mesh.name;
    const displayName = originalToDisplayName.get(originalName) || originalName;
    showTooltip(displayName, event.clientX, event.clientY);
  } else {
    // No hit - reset hover state
    renderer.domElement.style.cursor = 'default';
    
    if (hoveredMuscle && hoveredMuscle !== selectedMuscle && !highlightedMeshes.includes(hoveredMuscle)) {
      hoveredMuscle.material.color.setHex(CONFIG.colors.defaultMuscle);
      if (hoveredMuscle.material.emissive) {
        hoveredMuscle.material.emissive.setHex(0x000000);
        hoveredMuscle.material.emissiveIntensity = 0;
      }
    }
    hoveredMuscle = null;
    
    hideTooltip();
  }
}

function onMouseClick(event) {
  raycaster.setFromCamera(mouse, camera);
  
  // 首先检测关节球体（如果骨架可见）
  if (skeletonVisible && jointSpheres.length > 0) {
    const jointIntersects = raycaster.intersectObjects(jointSpheres, false);
    const jointHit = jointIntersects.find(i => i.object.visible && i.object.userData.isJoint);
    
    if (jointHit) {
      selectJoint(jointHit.object);
      return;  // 优先处理关节点击
    }
  }
  
  // 检测肌肉 mesh
  const intersects = raycaster.intersectObjects(muscleMeshes, false);
  
  // Find first visible muscle
  let hit = null;
  for (const intersect of intersects) {
    let obj = intersect.object;
    while (obj) {
      if (obj.visible && obj.userData.isMuscle) {
        hit = { ...intersect, object: obj };
        break;
      }
      obj = obj.parent;
    }
    if (hit) break;
  }
  
  if (hit) {
    // 点击肌肉时清除选中的关节
    clearJointSelection();
    selectMuscle(hit.object);
  } else {
    // 点击空白处清除关节选择
    clearJointSelection();
  }
}

// 选中关节
function selectJoint(sphere) {
  // 清除之前选中的关节
  clearJointSelection();
  
  selectedJoint = sphere;
  const boneIndex = sphere.userData.boneIndex;
  
  // 高亮选中的关节
  sphere.material.color.setHex(0xff6600);  // 橙色
  sphere.scale.setScalar(2);
  
  // 显示对应的标签
  if (boneLabels[boneIndex]) {
    boneLabels[boneIndex].visible = true;
  }
  
  console.log(`🦴 Selected joint: ${sphere.userData.bone.name}`);
}

// 清除关节选择
function clearJointSelection() {
  if (selectedJoint) {
    const boneIndex = selectedJoint.userData.boneIndex;
    
    // 恢复颜色和大小
    selectedJoint.material.color.setHex(0x00ff00);
    selectedJoint.scale.setScalar(1);
    
    // 隐藏标签
    if (boneLabels[boneIndex]) {
      boneLabels[boneIndex].visible = false;
    }
    
    selectedJoint = null;
  }
}

function showTooltip(text, x, y) {
  const tooltip = document.getElementById('info-tooltip');
  tooltip.textContent = text;
  tooltip.style.left = (x + 15) + 'px';
  tooltip.style.top = (y + 15) + 'px';
  tooltip.classList.remove('hidden');
}

function hideTooltip() {
  document.getElementById('info-tooltip').classList.add('hidden');
}

// ==================== Window Resize ====================
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==================== Animation Loop ====================
// 存储高亮的 meshes 用于脉动动画
let highlightedMeshes = [];

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  
  // 高亮肌肉脉动效果
  if (highlightedMeshes.length > 0) {
    const time = performance.now() * 0.001;  // 转换为秒
    const pulse = (Math.sin(time * CONFIG.highlight.pulseSpeed * Math.PI) + 1) / 2;  // 0-1
    const intensity = CONFIG.highlight.pulseMin + pulse * (CONFIG.highlight.pulseMax - CONFIG.highlight.pulseMin);
    
    highlightedMeshes.forEach(mesh => {
      if (mesh.material.emissive) {
        // 脉动发光强度
        mesh.material.emissiveIntensity = intensity;
      }
    });
  }
  
  // 更新骨骼标签位置（如果骨架可见）
  if (skeletonVisible) {
    updateBoneLabels();
  }
  
  renderer.render(scene, camera);
}

// ==================== 调试和导出功能 ====================
// 导出当前的名称映射（原始名称 -> 显示名称）
function exportNameMapping() {
  const mapping = Object.fromEntries(originalToDisplayName);
  console.log('Name Mapping (Original -> Display):');
  console.log(JSON.stringify(mapping, null, 2));
  return mapping;
}

// 导入名称映射
function importNameMapping(mapping) {
  originalToDisplayName.clear();
  Object.entries(mapping).forEach(([original, display]) => {
    originalToDisplayName.set(original, display);
  });
  saveNameMappingToStorage();  // 保存到 localStorage
  buildMuscleList();
  console.log(`Imported ${Object.keys(mapping).length} name mappings`);
}

// 通过原始名称获取显示名称
function getDisplayName(originalName) {
  return originalToDisplayName.get(originalName) || originalName;
}

// 通过原始名称设置显示名称
function setDisplayName(originalName, displayName) {
  if (meshByOriginalName.has(originalName)) {
    originalToDisplayName.set(originalName, displayName);
    saveNameMappingToStorage();  // 保存到 localStorage
    buildMuscleList();
    return true;
  }
  return false;
}

// 清除所有名称映射
function clearAllMappings() {
  originalToDisplayName.clear();
  saveNameMappingToStorage();
  buildMuscleList();
  console.log('🗑️ Cleared all name mappings');
}

// 重置所有名称（带确认）
function resetAllNames() {
  const count = originalToDisplayName.size;
  
  if (count === 0) {
    alert('No custom names to reset. All muscles are using their original names.');
    return;
  }
  
  const confirmed = confirm(`Are you sure you want to reset all ${count} custom name(s) to their original names?\n\nThis action cannot be undone.`);
  
  if (confirmed) {
    clearAllMappings();
    clearSelection();
    alert(`Successfully reset ${count} muscle(s) to original names.`);
  }
}

// ==================== 文件导出/导入 ====================
// 导出为 JSON 文件下载
function exportToJsonFile() {
  const mapping = Object.fromEntries(originalToDisplayName);
  const dataStr = JSON.stringify(mapping, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `muscle_name_mapping_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  console.log(`Exported ${originalToDisplayName.size} name mappings to JSON file`);
}

// 从 JSON 文件导入
function importFromJsonFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const mapping = JSON.parse(e.target.result);
      
      // Validate mapping format
      if (typeof mapping !== 'object' || mapping === null) {
        throw new Error('Invalid JSON format: expected an object');
      }
      
      let importCount = 0;
      let skippedCount = 0;
      
      // Apply mappings only for muscles that exist in current model
      for (const [originalName, displayName] of Object.entries(mapping)) {
        if (meshByOriginalName.has(originalName)) {
          originalToDisplayName.set(originalName, displayName);
          importCount++;
        } else {
          skippedCount++;
        }
      }
      
      // Rebuild groups and update UI
      rebuildMuscleGroups();
      updateMuscleList();
      saveNameMappingToStorage();
      clearSelection();
      
      console.log(`📂 Imported ${importCount} name mappings from JSON file (${skippedCount} skipped - not found in model)`);
      alert(`Successfully imported ${importCount} name mappings.${skippedCount > 0 ? ` (${skippedCount} entries skipped - muscles not found in current model)` : ''}`);
      
    } catch (err) {
      console.error('Failed to import JSON file:', err);
      alert(`Failed to import: ${err.message}`);
    }
  };
  
  reader.onerror = () => {
    console.error('Failed to read file');
    alert('Failed to read file');
  };
  
  reader.readAsText(file);
  
  // Reset file input so the same file can be selected again
  event.target.value = '';
}

// 暴露到全局，方便调试
window.muscleViewer = {
  exportNameMapping,
  importNameMapping,
  getDisplayName,
  setDisplayName,
  clearAllMappings,
  exportToJsonFile,
  importFromJsonFile,
  getOriginalToDisplayMap: () => originalToDisplayName,
  getMuscleGroups: () => muscleGroups,
  getMeshByOriginalName: () => meshByOriginalName,
};

// ==================== Start ====================
init();

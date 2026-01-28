import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ==================== Configuration ====================
const CONFIG = {
  modelPath: '/models/muslce_avatar_with_name_add_v7.glb',  // 修改为你的模型路径
  // 皮肤mesh识别关键字（除此之外都是肌肉）
  skinKeyword: 'integumentary_system',
  colors: {
    background: 0xf5f5f5,
    defaultMuscle: 0xcc8888,      // 默认肌肉颜色
    highlightMuscle: 0xff4444,    // 高亮颜色
    hoverMuscle: 0xffaa44,        // 悬停颜色
    otherMesh: 0xdddddd,          // 其他mesh颜色（皮肤等）
  },
  opacity: {
    muscle: 0.9,
    muscleWhenOtherHighlighted: 0.2,  // 当其他肌肉高亮时的透明度
    otherMesh: 0.3,
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
          
          // 检查是否是皮肤 mesh（包含 integumentary_system）
          // 除了皮肤之外的都是肌肉 mesh
          if (name.includes(CONFIG.skinKeyword)) {
            // This is skin - make semi-transparent and non-interactive
            setupOtherMesh(child);
            otherMeshes.push(child);
          } else {
            // This is a muscle mesh
            setupMuscleMesh(child);
            muscleMeshes.push(child);
          }
        }
      });

      scene.add(model);
      
      // 从 localStorage 加载用户自定义的名称映射（如果有）
      loadNameMappingFromStorage();
      
      // Build sidebar muscle list
      buildMuscleList();
      
      // Hide loading indicator
      document.getElementById('loading').style.display = 'none';
      
      console.log(`✅ Loaded ${muscleMeshes.length} muscle meshes, ${otherMeshes.length} other meshes (skin)`);
      console.log('Muscle meshes:', muscleMeshes.map(m => m.name));
      console.log('Other meshes (skin):', otherMeshes.map(m => m.name));
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
  // Create muscle material
  const material = new THREE.MeshPhysicalMaterial({
    color: CONFIG.colors.defaultMuscle,
    transparent: true,
    opacity: CONFIG.opacity.muscle,
    side: THREE.DoubleSide,
    roughness: 0.5,
    metalness: 0.1,
  });
  
  // Store original material
  originalMaterials.set(mesh.uuid, mesh.material);
  
  mesh.material = material;
  mesh.userData.isMuscle = true;
  mesh.userData.originalColor = CONFIG.colors.defaultMuscle;
  mesh.userData.originalName = mesh.name;  // 保存原始名称
  
  // 建立原始名称到mesh的映射
  meshByOriginalName.set(mesh.name, mesh);
  
  // 对于 SkinnedMesh，确保几何体 bounding 正确计算
  if (mesh.isSkinnedMesh) {
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    // 强制更新矩阵
    mesh.updateMatrixWorld(true);
  }
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
  
  // 高亮所有相关的mesh
  meshes.forEach(mesh => {
    mesh.material.color.setHex(CONFIG.colors.highlightMuscle);
    mesh.material.opacity = 1.0;  // 完全不透明
    mesh.material.depthWrite = true;
    mesh.renderOrder = 999;  // 最后渲染，显示在最前
    if (mesh.material.emissive) {
      mesh.material.emissive.setHex(0x331111);
    }
  });
  
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
  // 恢复肌肉的原始状态
  muscleMeshes.forEach(mesh => {
    mesh.material.color.setHex(CONFIG.colors.defaultMuscle);
    mesh.material.opacity = CONFIG.opacity.muscle;
    mesh.material.depthWrite = true;
    mesh.renderOrder = 0;
    if (mesh.material.emissive) {
      mesh.material.emissive.setHex(0x000000);
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
  
  // Raycast only against muscle meshes
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(muscleMeshes, false);
  
  // Find first visible muscle - 直接检查 object 或者向上查找父对象
  let hit = null;
  for (const intersect of intersects) {
    let obj = intersect.object;
    // 向上遍历查找标记为肌肉的对象
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
      if (hoveredMuscle && hoveredMuscle !== selectedMuscle) {
        hoveredMuscle.material.color.setHex(CONFIG.colors.defaultMuscle);
      }
      
      // Apply new hover
      hoveredMuscle = mesh;
      if (mesh !== selectedMuscle) {
        mesh.material.color.setHex(CONFIG.colors.hoverMuscle);
      }
    }
    
    // Show tooltip - 显示自定义名称（如果有的话）
    const originalName = mesh.userData.originalName || mesh.name;
    const displayName = originalToDisplayName.get(originalName) || originalName;
    showTooltip(displayName, event.clientX, event.clientY);
  } else {
    // No hit - reset hover state
    renderer.domElement.style.cursor = 'default';
    
    if (hoveredMuscle && hoveredMuscle !== selectedMuscle) {
      hoveredMuscle.material.color.setHex(CONFIG.colors.defaultMuscle);
    }
    hoveredMuscle = null;
    
    hideTooltip();
  }
}

function onMouseClick(event) {
  // Raycast
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(muscleMeshes, false);
  
  // Find first visible muscle - 直接检查 object 或者向上查找父对象
  let hit = null;
  for (const intersect of intersects) {
    let obj = intersect.object;
    // 向上遍历查找标记为肌肉的对象
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
    selectMuscle(hit.object);
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
function animate() {
  requestAnimationFrame(animate);
  controls.update();
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

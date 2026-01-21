#!/usr/bin/env python3
"""
Simple HTTP server for muscle visualization
Serves static files and GLB models
"""

import http.server
import socketserver
import os
import argparse
from pathlib import Path

class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler with CORS support and proper MIME types"""
    
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.json': 'application/json',
        '.wasm': 'application/wasm',
    }
    
    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

def main():
    parser = argparse.ArgumentParser(description='Muscle Visualization Server')
    parser.add_argument('-p', '--port', type=int, default=8080, help='Port to serve on (default: 8080)')
    parser.add_argument('-d', '--directory', type=str, default='.', help='Directory to serve (default: current)')
    args = parser.parse_args()
    
    os.chdir(args.directory)
    
    with socketserver.TCPServer(("", args.port), CORSHTTPRequestHandler) as httpd:
        print(f"""
╔══════════════════════════════════════════════════════════╗
║          Muscle Visualization Server                      ║
╠══════════════════════════════════════════════════════════╣
║  Server running at:                                       ║
║    http://localhost:{args.port:<5}                               ║
║    http://0.0.0.0:{args.port:<5}                                 ║
║                                                           ║
║  Serving from: {str(Path.cwd())[:40]:<40} ║
║                                                           ║
║  Press Ctrl+C to stop                                     ║
╚══════════════════════════════════════════════════════════╝
        """)
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\nServer stopped.")

if __name__ == '__main__':
    main()

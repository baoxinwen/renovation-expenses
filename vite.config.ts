import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// public/ 里的 _ 前缀文件是图标草稿与预览工具页（服务 5173 开发预览），
// 不得随 publicDir 拷入生产产物公网可达——写盘后从 dist 剔除。
// 源文件保留在 public/ 是为了 dev server 预览工作流，.gitignore 防误提交。
function stripDraftArtifacts() {
  return {
    name: 'strip-draft-artifacts',
    closeBundle() {
      const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
          const p = path.join(dir, name);
          if (name.startsWith('_')) { fs.rmSync(p, { recursive: true, force: true }); continue; }
          if (fs.statSync(p).isDirectory()) walk(p);
        }
      };
      walk(path.resolve(__dirname, 'dist'));
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [react(), stripDraftArtifacts()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5174',
      '/uploads': 'http://127.0.0.1:5174',
    },
  },
});

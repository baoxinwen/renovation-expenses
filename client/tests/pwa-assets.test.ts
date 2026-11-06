// PWA 可安装资产的存在性与关键字段断言（M1/M2）。只断言源文件（构建产物
// 由 vite 保证 public/ → dist/ 的拷贝，不测构建器自身）。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('PWA 可安装资产', () => {
  it('manifest 存在且字段齐全', () => {
    const m = JSON.parse(read('client/public/manifest.webmanifest'));
    expect(m.name).toBe('装修账本');
    expect(m.short_name).toBe('装修账本');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.theme_color).toBe('#8c5e3c');
    expect(m.background_color).toBe('#f5f5f3');
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('四档 PNG 图标文件存在', () => {
    for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
      expect(existsSync(join(root, 'client/public/icons', f)), f).toBe(true);
    }
  });

  it('index.html 挂了 manifest / apple-touch-icon / theme-color / iOS meta', () => {
    const html = read('client/index.html');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('apple-mobile-web-app-capable');
  });

  // r3 M20：构建产物漂移防护——dist 存在时（本地构建过；CI test 阶段无 dist）
  // PWA 资产必须已拷贝，防止「源文件在、产物旧」的部署错位
  it('dist 存在时 PWA 资产已随构建拷入', () => {
    const dist = join(root, 'dist');
    if (!existsSync(dist)) return; // CI 测试阶段不构建，无产物可查
    expect(existsSync(join(dist, 'manifest.webmanifest')), 'dist/manifest.webmanifest').toBe(true);
    expect(existsSync(join(dist, 'icons', 'icon-512.png')), 'dist/icons/icon-512.png').toBe(true);
    expect(existsSync(join(dist, 'icons', 'apple-touch-icon.png')), 'dist/icons/apple-touch-icon.png').toBe(true);
  });
});

// PWA 可安装资产的存在性、引用一致性与产物卫生断言（M1/M2/2026-11-20 门禁 I3/C1/I2）。
// 源文件断言直接读 public/；构建产物卫生只在 dist 存在时校验（本地构建过，
// CI 测试阶段无 dist）——构建器不复制草稿这一点必须由测试钉住。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEME_COLOR } from '../src/hooks/useThemeMode';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** 读 PNG 真实像素尺寸（IHDR 宽高在字节 16-24，大端）——sizes 声明失真即在此现形 */
function pngSize(file: string): { w: number; h: number } {
  const buf = readFileSync(file);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(0, 8).equals(pngSig), `${file} 不是 PNG`).toBe(true);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

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

  // 门禁 C1：public/ 下的 _ 前缀草稿（图标草稿/预览工具页/素材库）只服务
  // 5173 开发预览，绝不能随 publicDir 拷入产物公网可达——构建器剔除逻辑
  // 回归即在此现形（dist 存在时校验，CI 无产物时跳过）
  it('dist 存在时产物不含下划线前缀草稿文件', () => {
    const dist = join(root, 'dist');
    if (!existsSync(dist)) return;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name.startsWith('_')) { offenders.push(p); continue; }
        if (statSync(p).isDirectory()) walk(p);
      }
    };
    walk(dist);
    expect(offenders, `产物携带草稿：${offenders.join('、')}`).toEqual([]);
  });

  // 门禁 I3：manifest 引用 ↔ 真实资产一致性——「引用损坏致无法安装」「sizes
  // 声明失真」「图标设计代次漂移」三类硬故障，只查存在性的旧断言全部放行
  it('manifest 每个 icon 都指向真实文件，PNG 真实尺寸与 sizes 声明一致', () => {
    const m = JSON.parse(read('client/public/manifest.webmanifest'));
    expect(m.icons.length).toBeGreaterThan(0);
    for (const icon of m.icons) {
      const file = join(root, 'client/public', String(icon.src).replace(/^\//, ''));
      expect(existsSync(file), `manifest 引用的文件不存在：${icon.src}`).toBe(true);
      const sizes = String(icon.sizes).toLowerCase();
      if (sizes === 'any' || icon.type !== 'image/png') continue; // SVG 尺寸自适应
      const [w, h] = sizes.split('x').map(Number);
      const real = pngSize(file);
      expect([real.w, real.h], `${icon.src} 实际 ${real.w}x${real.h} ≠ 声明 ${sizes}`).toEqual([w, h]);
    }
  });

  it('index.html 引用的 favicon 与 apple-touch 目标真实存在', () => {
    const html = read('client/index.html');
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((mm) => mm[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const href of hrefs) {
      expect(existsSync(join(root, 'client/public', href.replace(/^\//, ''))), `引用不存在：${href}`).toBe(true);
    }
  });

  // 门禁 I2：状态栏色三方一致——manifest 安装横幅色、index.html 首帧亮色值
  // 与运行时常量必须同源，暗色值必须出现在首帧内联脚本里（否则深色用户首帧闪棕）
  it('theme-color：manifest、index.html 亮色值、运行时常量三方一致且含暗色值', () => {
    const m = JSON.parse(read('client/public/manifest.webmanifest'));
    const html = read('client/index.html');
    expect(m.theme_color.toLowerCase()).toBe(THEME_COLOR.light);
    expect(html).toContain(THEME_COLOR.light);
    expect(html).toContain(THEME_COLOR.dark);
  });
});

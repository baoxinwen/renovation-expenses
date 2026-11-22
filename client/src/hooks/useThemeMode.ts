import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'renovation-expenses.theme-mode';

/** 浏览器栏/PWA 状态栏色（theme-color meta）。暗色取 --bg-linen 暗档（移动顶栏
 *  同底色，状态栏与页面连成一体）；index.html 首帧内联脚本必须用同一组值，
 *  pwa-assets 测试钉住 manifest/index.html/这里三方一致。 */
export const THEME_COLOR = { light: '#8c5e3c', dark: '#0b0b0a' } as const;

function readStored(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function systemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(readStored);
  const [isDark, setIsDark] = useState(() => (readStored() === 'dark') || (readStored() === 'system' && systemDark()));

  useEffect(() => {
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && systemDark());
      const root = document.documentElement;
      // 换肤瞬间抑制全站过渡（tokens.css .theme-switching）：不然所有颜色
      // transition 同时重定向，观感是整页颜色拖影
      root.classList.add('theme-switching');
      root.classList.toggle('dark', dark);
      // 状态栏/浏览器栏色跟随主题（PWA standalone 每次启动都在首屏，不跟随则深色下顶一条亮带）
      document.querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light));
      setIsDark(dark);
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
    };
    apply();
    localStorage.setItem(STORAGE_KEY, mode);

    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mode]);

  // 其他标签页修改主题时同步
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        setMode(e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((m: ThemeMode) => setMode(m), []);
  return { mode, isDark, setMode: update };
}

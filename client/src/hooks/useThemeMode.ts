import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'renovation-expenses.theme-mode';

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

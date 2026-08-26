import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 数字滚动：600ms ease-out 滚到新值；reduced-motion 时直接跳变。
 * 返回动画中的当前值。
 */
export function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    if (prefersReducedMotion() || !Number.isFinite(target)) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    startRef.current = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      setDisplay(value);
      fromRef.current = value; // 动画中记录当前值，目标再变时从视觉现状起步（不回退）
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

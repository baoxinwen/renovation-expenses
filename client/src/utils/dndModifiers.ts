import type { Modifier } from '@dnd-kit/core';

/** 垂直排序的拖拽约束（逻辑对齐官方 @dnd-kit/modifiers 的 restrictToVerticalAxis /
 *  restrictToParentElement，为免新增依赖就地实现）：
 *  1) 只沿 Y 轴跟随——与垂直排序语义一致，水平锁死；
 *  2) 拖拽跟随限制在可拖拽项的父容器内（行 = tbody，板块 = 清单区）——
 *     行拖不出板块表格，松手落点永远合法，不会出现「行拖丢」的怪状态。 */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

export const restrictToParentElement: Modifier = ({ containerNodeRect, draggingNodeRect, transform }) => {
  if (!containerNodeRect || !draggingNodeRect) return transform;
  return {
    ...transform,
    x: Math.min(Math.max(transform.x, containerNodeRect.left - draggingNodeRect.left), containerNodeRect.right - draggingNodeRect.right),
    y: Math.min(Math.max(transform.y, containerNodeRect.top - draggingNodeRect.top), containerNodeRect.bottom - draggingNodeRect.bottom),
  };
};

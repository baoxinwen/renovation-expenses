/**
 * 预算清单的拖拽包装组件。
 * 从 Plan.tsx 拆出，仅服务清单表格场景；项目信息编辑统一走行点击弹窗。
 */
import { createContext, useContext } from 'react';
import { HolderOutlined } from '@ant-design/icons';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import type { Section } from '../../api';

// ---------- dnd-kit：项目行拖拽（拖手柄列） ----------
const RowListenersContext = createContext<{ attributes?: DraggableAttributes; listeners?: SyntheticListenerMap }>({});

// 铁律 9a：拖拽动效性格——落位用过阻尼弹簧近似（快速减速、零回弹咬死），不用 dnd-kit 默认 ease
const DROP_TRANSITION = '480ms cubic-bezier(0.16, 1, 0.3, 1)';

export function SortableRow(props: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: number }) {
  const id = props['data-row-key'];
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: id! });
  const style: React.CSSProperties = {
    ...props.style,
    // 垂直排序：忽略水平位移，防止拖拽中行体超出容器出现横向滚动条
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : transform),
    // 只过渡 transform（落位回弹）；不点名属性会连 hover 底色一起拖 480ms
    transition: isDragging ? undefined : `transform ${DROP_TRANSITION}`,
    ...(isDragging ? { position: 'relative', zIndex: 2, background: 'var(--surface)', boxShadow: 'var(--shadow-card)' } : {}),
  };
  return (
    <RowListenersContext.Provider value={{ attributes, listeners }}>
      {/* attributes 不上 tr：role=button/tabIndex 会覆盖表格行语义、整行变成无效 tab 站；
          与 listeners 一起归位到把手（KeyboardSensor 的键盘拖拽也从把手进入） */}
      <tr {...props} ref={setNodeRef} style={style} />
    </RowListenersContext.Provider>
  );
}

export function DragHandle() {
  const { attributes, listeners } = useContext(RowListenersContext);
  return (
    <HolderOutlined
      className="drag-handle"
      {...attributes}
      {...listeners}
      aria-label="拖动调整顺序"
    />
  );
}

// ---------- dnd-kit：板块卡片拖拽 ----------
const SectionHandleContext = createContext<{ attributes?: DraggableAttributes; listeners?: SyntheticListenerMap }>({});

export function SectionDragHandle() {
  const { attributes, listeners } = useContext(SectionHandleContext);
  return (
    <HolderOutlined
      className="drag-handle"
      {...attributes}
      {...listeners}
      aria-label="拖动调整板块顺序"
    />
  );
}

export function SortableSectionCard({ section, index, children }: {
  section: Section; index: number; children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: section.id });
  return (
    <SectionHandleContext.Provider value={{ attributes, listeners }}>
      <div
        ref={setNodeRef}
        className="rise-in"
        style={{
          animationDelay: `${Math.min(index, 6) * 40}ms`,
          transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : transform),
          transition: isDragging ? undefined : `transform ${DROP_TRANSITION}`,
          ...(isDragging ? { position: 'relative', zIndex: 3, opacity: 0.9 } : {}),
        }}
      >
        {children}
      </div>
    </SectionHandleContext.Provider>
  );
}

/**
 * 预算清单的拖拽包装组件。
 * 从 Plan.tsx 拆出，仅服务清单表格场景；项目信息编辑统一走行点击弹窗。
 */
import { createContext, useContext } from 'react';
import { HolderOutlined } from '@ant-design/icons';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import type { Section } from '../../api';

// ---------- dnd-kit：项目行拖拽（拖手柄列） ----------
const RowListenersContext = createContext<{ listeners?: SyntheticListenerMap }>({});

export function SortableRow(props: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: number }) {
  const id = props['data-row-key'];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: id! });
  const style: React.CSSProperties = {
    ...props.style,
    // 垂直排序：忽略水平位移，防止拖拽中行体超出容器出现横向滚动条
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 2, background: 'var(--surface)', boxShadow: 'var(--shadow-card)' } : {}),
  };
  return (
    <RowListenersContext.Provider value={{ listeners }}>
      <tr {...props} ref={setNodeRef} {...attributes} style={style} />
    </RowListenersContext.Provider>
  );
}

export function DragHandle() {
  const { listeners } = useContext(RowListenersContext);
  return <HolderOutlined className="drag-handle" {...listeners} />;
}

// ---------- dnd-kit：板块卡片拖拽 ----------
const SectionHandleContext = createContext<{ listeners?: SyntheticListenerMap }>({});

export function SectionDragHandle() {
  const { listeners } = useContext(SectionHandleContext);
  return <HolderOutlined className="drag-handle" {...listeners} />;
}

export function SortableSectionCard({ section, index, children }: {
  section: Section; index: number; children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  return (
    <SectionHandleContext.Provider value={{ listeners }}>
      <div
        ref={setNodeRef}
        {...attributes}
        className="rise-in"
        style={{
          animationDelay: `${Math.min(index, 6) * 40}ms`,
          transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : transform),
          transition,
          ...(isDragging ? { position: 'relative', zIndex: 3, opacity: 0.9 } : {}),
        }}
      >
        {children}
      </div>
    </SectionHandleContext.Provider>
  );
}

/**
 * 预算清单的可编辑单元格与拖拽包装组件。
 * 从 Plan.tsx 拆出（该页原 660 行职责过载），仅服务清单表格场景。
 */
import { createContext, useContext, useState } from 'react';
import { Input, InputNumber } from 'antd';
import { HolderOutlined } from '@ant-design/icons';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Section } from '../../api';

// ---------- 行内编辑单元格：失焦提交；成功闪光 / 失败回滚 ----------
export function EditableText({ value, onCommit, placeholder }: {
  value: string; onCommit: (v: string) => Promise<boolean>; placeholder?: string;
}) {
  const [flash, setFlash] = useState(false);
  const [resetKey, setResetKey] = useState(0); // 保存失败时强制回滚显示
  return (
    <div className={`editable-cell ${flash ? 'flash-saved' : ''}`}>
      <Input
        key={`${value}-${resetKey}`}
        size="small"
        variant="borderless"
        defaultValue={value}
        placeholder={placeholder}
        onClick={(e) => e.stopPropagation()}
        onBlur={async (e) => {
          const v = e.target.value.trim();
          if (v === value) return;
          if (await onCommit(v)) {
            setFlash(true);
            setTimeout(() => setFlash(false), 650);
          } else {
            setResetKey((k) => k + 1);
          }
        }}
      />
    </div>
  );
}

export function EditableNum({ value, onCommit }: {
  value: number | null; onCommit: (v: number | null) => Promise<boolean>;
}) {
  const [flash, setFlash] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  return (
    <div className={`editable-cell num ${flash ? 'flash-saved' : ''}`}>
      <InputNumber
        key={`${String(value)}-${resetKey}`}
        size="small"
        variant="borderless"
        defaultValue={value ?? undefined}
        min={0}
        formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
        parser={(t) => Number(String(t).replace(/,/g, '')) as number}
        style={{ width: '100%' }}
        onClick={(e) => e.stopPropagation()}
        onBlur={async (e) => {
          const raw = e.target.value.trim().replace(/,/g, '');
          let next: number | null;
          if (raw === '') next = 0;
          else {
            const n = Number(raw);
            if (!Number.isFinite(n)) {
              setResetKey((k) => k + 1); // 非法输入回滚显示为服务器值
              return;
            }
            next = n;
          }
          if (next === value) return;
          if (await onCommit(next)) {
            setFlash(true);
            setTimeout(() => setFlash(false), 650);
          } else {
            setResetKey((k) => k + 1);
          }
        }}
      />
    </div>
  );
}

// ---------- dnd-kit：项目行拖拽（拖手柄列） ----------
const RowListenersContext = createContext<{ listeners?: Record<string, unknown> }>({});

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
const SectionHandleContext = createContext<{ listeners?: Record<string, unknown> }>({});

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

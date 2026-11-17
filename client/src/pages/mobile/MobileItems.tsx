import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Collapse, Empty, Input, Skeleton, Tag } from 'antd';
import { HolderOutlined, PlusOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../../api';
import type { Item, ItemFormValues, PlanData } from '../../api';
import { fmtMoney } from '../../format';
import MobileItemDrawer from './MobileItemDrawer';
import MobileSectionManager from './MobileSectionManager';
import ItemFormModal from '../../components/ItemFormModal';

/** 移动清单：搜索 + 板块手风琴 + 项目卡片；点卡片 = 详情抽屉（方案 A，操作收敛在抽屉内） */
export default function MobileItems() {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [search, setSearch] = useState('');
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 板块内添加项目：目标板块 id（null = 关闭表单）
  const [addSectionId, setAddSectionId] = useState<number | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 序号守卫（r3 I6，对照桌面 Plan 同款）：弱网下连续操作（保存实付→删项目）
  // 先发后至的过期响应会整体覆盖新快照——已删项目「复活」显示
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoadError(null);
    try {
      const p = await api.getPlan();
      if (seq !== loadSeq.current) return;
      setPlan(p);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setLoadError((e as Error).message);
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 触摸拖拽：激活距离比桌面(4)略大，防滚动列表时误起拖；
  // KeyboardSensor 与桌面同款——拖拽的单指针替代路径（把手聚焦后空格拾起、
  // 方向键移动、空格落下、Esc 取消）
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // 拖拽落点：乐观更新即时反馈，持久化失败 load() 重拉回滚服务端顺序
  const onItemDragEnd = (secId: number) => async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const sec = plan?.sections.find((s) => s.id === secId);
    if (!sec) return;
    const ids = (sec.items ?? []).map((i) => i.id);
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    setPlan((p) => p && ({
      ...p,
      sections: p.sections.map((s) => s.id !== secId ? s : { ...s, items: arrayMove(s.items ?? [], from, to) }),
    }));
    try {
      await api.reorderItems(arrayMove(ids, from, to));
    } catch (e) {
      toast.error((e as Error).message);
      load();
    }
  };

  // 抽屉目标从 plan 全量取（不从搜索过滤结果取）：load() 重拉后抽屉自动拿到
  // 最新值；项目被删除后 find 落空 → drawerItem 为 null → 抽屉关闭
  const drawerItem = useMemo(
    () => drawerId == null ? null : (plan?.sections.flatMap((s) => s.items ?? []).find((i) => i.id === drawerId) ?? null),
    [plan, drawerId],
  );

  const q = search.trim().toLowerCase();
  const searching = q.length > 0;
  const sections = useMemo(() => {
    if (!plan) return [];
    if (!q) return plan.sections;
    return plan.sections
      .map((sec) => ({
        ...sec,
        items: (sec.items ?? []).filter((it) =>
          it.name.toLowerCase().includes(q) || it.spec.toLowerCase().includes(q) || it.note.toLowerCase().includes(q)),
      }))
      .filter((sec) => (sec.items ?? []).length > 0);
  }, [plan, q]);
  // 受控折叠：搜索时默认全展开——否则命中项目藏在用户手动折叠的面板里，
  // 搜索看起来「无结果」；搜索态的折叠单独记录（否则控件在搜索态像坏了），
  // 清空搜索后回到非搜索态自己的折叠记忆
  const [collapsedKeys, setCollapsedKeys] = useState<string[] | null>(null);
  const [searchCollapsedKeys, setSearchCollapsedKeys] = useState<string[] | null>(null);
  const allKeys = sections.map((s) => String(s.id));
  const activeKeys = searching
    ? (searchCollapsedKeys === null ? allKeys : allKeys.filter((k) => !searchCollapsedKeys.includes(k)))
    : (collapsedKeys === null ? allKeys : collapsedKeys);

  if (!plan) {
    // 加载失败必须给重试入口，不能停在无限骨架屏（桌面端有对应错误卡）
    if (loadError) {
      return (
        <Card>
          <Empty description={`加载失败：${loadError}`} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 20 }} />
          <Button block onClick={load}>重试</Button>
        </Card>
      );
    }
    return <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input.Search
          aria-label="搜索清单项目"
          placeholder="搜项目 / 品牌 / 备注"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ flex: 1 }}
        />
        <Button onClick={() => setManagerOpen(true)}>管理板块</Button>
      </div>
      <div className="label-caption" style={{ marginBottom: 10 }}>
        点项目卡片查看详情与操作
      </div>

      {sections.length === 0 ? (
        <Card><Empty description={`没有找到与「${search}」匹配的项目`} /></Card>
      ) : (
        <Collapse
          activeKey={activeKeys}
          onChange={(k) => {
            const keys = k as string[];
            if (searching) setSearchCollapsedKeys(allKeys.filter((key) => !keys.includes(key)));
            else setCollapsedKeys(keys);
          }}
          items={sections.map((sec) => ({
            key: String(sec.id),
            // 板块头里不放按钮（button 嵌 button，读屏名称互相吞）——
            // 「板块内添加」入口移到面板内容顶部
            label: (
              <span style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{sec.name}</span>
                <span className="tabular" style={{ color: 'var(--ink-2)', fontSize: 12, marginLeft: 8 }}>
                  {fmtMoney(sec.budget_subtotal ?? 0)}
                </span>
              </span>
            ),
            children: (
              <div>
                <Button
                  type="text"
                  icon={<PlusOutlined />}
                  aria-label={`在「${sec.name}」添加项目`}
                  onClick={() => setAddSectionId(sec.id)}
                  style={{ marginBottom: 4 }}
                >
                  添加项目
                </Button>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd(sec.id)}>
                  <SortableContext items={searching ? [] : (sec.items ?? []).map((i) => i.id)} strategy={verticalListSortingStrategy}>
                    {(sec.items ?? []).map((it) => (
                      <SortableItemRow
                        key={it.id}
                        item={it}
                        // 搜索态禁拖（与桌面一致：过滤视图里拖动改真实顺序易误拖）；
                        // 折叠态无把手——须先展开
                        handle={!searching && activeKeys.includes(String(sec.id))}
                        onOpen={() => setDrawerId(it.id)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            ),
          }))}
        />
      )}

      <MobileItemDrawer
        item={drawerItem}
        open={drawerId != null}
        sections={plan.sections}
        onClose={() => setDrawerId(null)}
        onChanged={load}
      />

      <MobileSectionManager
        open={managerOpen}
        sections={plan.sections}
        onClose={() => setManagerOpen(false)}
        onChanged={load}
      />

      <ItemFormModal
        open={addSectionId != null}
        confirmLoading={saving}
        onOk={async (values: ItemFormValues) => {
          if (addSectionId == null) return;
          setSaving(true);
          try {
            await api.addItem(addSectionId, values);
            setAddSectionId(null);
            toast.success('已添加');
            load();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
        onCancel={() => setAddSectionId(null)}
      />
    </div>
  );
}

/** 可排序项目行：主区是原生 button（键盘 Enter/Space 开抽屉），把手是兄弟元素
 *  （attributes+listeners 都挂把手——读屏的拖拽指令与实际焦点在同一元素上），
 *  两者无嵌套。已买行用降文字色表达（与桌面 .row-bought 同语义），
 *  不再压整行透明度——12px 副行会被带进对比度不达标区间 */
function SortableItemRow({ item: it, handle, onOpen }: { item: Item; handle: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: it.id });
  const style: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '11px 4px', minHeight: 48,
    borderBottom: '1px solid var(--line)',
    transform: CSS.Transform.toString(transform),
    ...(isDragging ? { position: 'relative', zIndex: 10, background: 'var(--bg-linen)' } : {}),
  };
  return (
    <div ref={setNodeRef} style={style}>
      <button
        className="row-link"
        onClick={onOpen}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: 4, flexShrink: 0,
            background: it.bought ? 'var(--sage)' : it.order_count > 0 ? 'var(--wood-600)' : 'var(--line)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: it.bought ? 'var(--ink-2)' : undefined }}>{it.name}</span>
            {it.order_count > 0 && <Tag style={{ marginRight: 0, lineHeight: '16px' }}>{it.order_count} 单</Tag>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {it.spec || '—'} · {it.bought
              ? `实付 ${fmtMoney(it.paid_amount ?? it.quantity * it.unit_price)}`
              : `${it.quantity} × ${fmtMoney(it.unit_price)}`}
            {it.bought_date ? ` · ${it.bought_date} 买` : ''}
          </div>
        </div>
        <span className="tabular" style={{ fontWeight: 650, color: it.bought ? 'var(--ink-2)' : undefined }}>{fmtMoney(it.budget_amount)}</span>
      </button>
      {handle && (
        // 触控目标 ≥44px；不挂 .drag-handle——那个 class 桌面默认隐身 hover
        // 浮现，移动端无 hover 必须常显。attributes+listeners 在此：
        // 键盘聚焦后空格拾起、方向键移动（KeyboardSensor）
        <span
          {...attributes}
          {...listeners}
          aria-label="拖动调整顺序"
          onClick={(e) => e.stopPropagation()}
          style={{ touchAction: 'none', display: 'flex', alignItems: 'center', minHeight: 44, minWidth: 44, justifyContent: 'center', padding: '0 10px', color: 'var(--ink-3)', cursor: 'grab' }}
        >
          {/* antd 图标自带 role=img aria-label="holder"，会污染把手名称——隐藏之 */}
          <span aria-hidden><HolderOutlined /></span>
        </span>
      )}
    </div>
  );
}

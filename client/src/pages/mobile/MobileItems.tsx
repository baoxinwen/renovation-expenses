import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Collapse, Empty, Input, Skeleton, Tag } from 'antd';
import { toast } from 'sonner';
import { api } from '../../api';
import type { Item, PlanData } from '../../api';
import { fmtMoney } from '../../format';
import BuyModal from '../../components/BuyModal';

/** 移动清单：搜索 + 板块手风琴 + 项目卡片；点卡片 = 购买登记（编辑/排序请回电脑端） */
export default function MobileItems() {
  const nav = useNavigate();
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [search, setSearch] = useState('');
  const [buyTarget, setBuyTarget] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      setPlan(await api.getPlan());
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
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

  if (!plan) return <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>;

  return (
    <div>
      <Input.Search
        placeholder="搜项目 / 品牌 / 备注"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        style={{ marginBottom: 12 }}
      />
      <div className="label-caption" style={{ marginBottom: 10 }}>
        点项目卡片即可记购买；编辑与排序请在电脑端操作
      </div>

      {sections.length === 0 ? (
        <Card><Empty description={`没有找到与「${search}」匹配的项目`} /></Card>
      ) : (
        <Collapse
          defaultActiveKey={sections.map((s) => String(s.id))}
          items={sections.map((sec) => ({
            key: String(sec.id),
            label: (
              <span>
                <span style={{ fontWeight: 600 }}>{sec.name}</span>
                <span className="tabular" style={{ color: 'var(--ink-2)', fontSize: 12, marginLeft: 8 }}>
                  {fmtMoney(sec.budget_subtotal ?? 0)}
                </span>
              </span>
            ),
            children: (
              <div>
                {(sec.items ?? []).map((it) => (
                  <div
                    key={it.id}
                    onClick={() => {
                      if (it.order_count > 0) nav(`/orders?item_id=${it.id}`);
                      else setBuyTarget(it);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '11px 4px', minHeight: 48,
                      borderBottom: '1px solid var(--line)',
                      opacity: it.bought ? 0.75 : 1,
                    }}
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
                        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                        {it.order_count > 0 && <Tag style={{ marginRight: 0, lineHeight: '16px' }}>{it.order_count} 单</Tag>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.spec || '—'} · {it.quantity} × {fmtMoney(it.unit_price)}
                        {it.bought_date ? ` · ${it.bought_date} 买` : ''}
                      </div>
                    </div>
                    <span className="tabular" style={{ fontWeight: 650 }}>{fmtMoney(it.budget_amount)}</span>
                  </div>
                ))}
              </div>
            ),
          }))}
        />
      )}

      <BuyModal
        item={buyTarget}
        open={!!buyTarget}
        onClose={() => setBuyTarget(null)}
        onConfirm={async (itemId, price, date) => {
          try {
            const updated = await api.updateItem(itemId, { bought: true, unit_price: price, bought_date: date });
            setBuyTarget(null);
            toast.success('已记录购买');
            load();
            return;
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        onUnmark={async (itemId) => {
          try {
            await api.updateItem(itemId, { bought: false });
            setBuyTarget(null);
            toast.success('已取消已买');
            load();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

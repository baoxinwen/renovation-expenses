import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Collapse, Empty, Input, Skeleton, Tag } from 'antd';
import { toast } from 'sonner';
import { api } from '../../api';
import type { PlanData } from '../../api';
import { fmtMoney } from '../../format';
import MobileItemDrawer from './MobileItemDrawer';

/** 移动清单：搜索 + 板块手风琴 + 项目卡片；点卡片 = 详情抽屉（方案 A，操作收敛在抽屉内） */
export default function MobileItems() {
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [search, setSearch] = useState('');
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setPlan(await api.getPlan());
    } catch (e) {
      setLoadError((e as Error).message);
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
  // 受控折叠：搜索时强制全展开——否则命中项目藏在用户手动折叠的面板里，
  // 搜索看起来「无结果」；非搜索态保留手动折叠状态
  const [collapsedKeys, setCollapsedKeys] = useState<string[] | null>(null);
  const activeKeys = searching
    ? sections.map((s) => String(s.id))
    : (collapsedKeys === null ? sections.map((s) => String(s.id)) : collapsedKeys);

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
      <Input.Search
        placeholder="搜项目 / 品牌 / 备注"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        style={{ marginBottom: 12 }}
      />
      <div className="label-caption" style={{ marginBottom: 10 }}>
        点项目卡片查看详情与操作
      </div>

      {sections.length === 0 ? (
        <Card><Empty description={`没有找到与「${search}」匹配的项目`} /></Card>
      ) : (
        <Collapse
          activeKey={activeKeys}
          onChange={(k) => setCollapsedKeys(k as string[])}
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
                    onClick={() => setDrawerId(it.id)}
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
                        {it.spec || '—'} · {it.bought
                          ? `实付 ${fmtMoney(it.paid_amount ?? it.quantity * it.unit_price)}`
                          : `${it.quantity} × ${fmtMoney(it.unit_price)}`}
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

      <MobileItemDrawer
        item={drawerItem}
        open={drawerId != null}
        onClose={() => setDrawerId(null)}
        onChanged={load}
      />
    </div>
  );
}

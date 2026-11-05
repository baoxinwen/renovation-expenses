import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Drawer, Space, Tag, Typography } from 'antd';
import { toast } from 'sonner';
import { api } from '../../api';
import type { Item } from '../../api';
import { fmtMoney } from '../../format';
import { confirmDoubleCount, submitWithForceGuard } from '../../utils/domain';
import BuyModal from '../../components/BuyModal';

/** 项目详情抽屉（方案 A）：点卡片唯一入口，操作全部收敛在抽屉内。
 *  记买/修正实付的守卫链路与原 MobileItems 内联版完全一致（submitWithForceGuard，
 *  force 只由服务端 409 触发——本地快照的双算判定不作仲裁）。 */
export default function MobileItemDrawer({ item, open, onClose, onChanged }: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const nav = useNavigate();
  const [buyOpen, setBuyOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!item) return null;
  const bought = !!item.bought;

  const confirmBuy = async (price: number, date: string) => {
    setSaving(true);
    try {
      const updated = await submitWithForceGuard(
        (force) => api.updateItem(item.id, { bought: true, paid_amount: price, bought_date: date, ...(force ? { force: true } : {}) }),
        () => confirmDoubleCount(item),
      );
      if (!updated) return;
      setBuyOpen(false);
      toast.success('已记录购买');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const unmarkBought = async () => {
    setSaving(true);
    try {
      await api.updateItem(item.id, { bought: false });
      setBuyOpen(false);
      toast.success('已取消已买');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer placement="bottom" open={open} onClose={onClose} height="auto" styles={{ body: { paddingTop: 8 } }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>{item.name}</Typography.Title>
      <div style={{ color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.9, marginBottom: 16 }}>
        <div>{item.spec || '—'}{item.unit ? ` · ${item.quantity} ${item.unit}` : ` · ${item.quantity}`}</div>
        <div>预算 {fmtMoney(item.budget_amount)} ｜ 实际 {bought ? fmtMoney(item.paid_amount ?? item.actual_amount) : '—'}</div>
        <div>
          {bought ? <Tag color="success">已买{item.bought_date ? ` · ${item.bought_date}` : ''}</Tag> : <Tag>未买</Tag>}
          {item.order_count > 0 && (
            <a onClick={() => nav(`/orders?item_id=${item.id}`)}>{item.order_count} 单 · 已付 {fmtMoney(item.order_paid)}</a>
          )}
        </div>
        {item.note && <div style={{ color: 'var(--ink-3)' }}>{item.note}</div>}
      </div>
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Button type="primary" size="large" block onClick={() => setBuyOpen(true)}>
          {bought ? '修正实付' : '记为已买'}
        </Button>
        {/* 编辑 / 删除 / +订单：Task 3/4 在此追加 */}
      </Space>
      <BuyModal
        item={item}
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        confirmLoading={saving}
        onConfirm={(_id, price, date) => confirmBuy(price, date)}
        onUnmark={unmarkBought}
      />
    </Drawer>
  );
}

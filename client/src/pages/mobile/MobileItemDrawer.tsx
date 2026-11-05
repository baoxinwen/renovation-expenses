import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Drawer, Modal, Space, Tag, Typography } from 'antd';
import { toast } from 'sonner';
import { api } from '../../api';
import type { Item, OrderFormValues, Section } from '../../api';
import { fmtMoney } from '../../format';
import { confirmDoubleCount, confirmOrderOnBoughtItem, restoreWithGuard, submitWithForceGuard, undoableDelete } from '../../utils/domain';
import { confirmAsync } from '../../utils/confirm';
import BuyModal from '../../components/BuyModal';
import ItemFormModal from '../../components/ItemFormModal';
import OrderFormModal from '../../components/OrderFormModal';

/** 项目详情抽屉（方案 A）：点卡片唯一入口，操作全部收敛在抽屉内。
 *  记买/修正实付/建订单的守卫链路与桌面一致（submitWithForceGuard，
 *  force 只由服务端 409 触发——本地快照的双算判定不作仲裁）。 */
export default function MobileItemDrawer({ item, open, sections, onClose, onChanged }: {
  item: Item | null;
  open: boolean;
  sections: Section[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const nav = useNavigate();
  const [buyOpen, setBuyOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
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

  // 删除确认与桌面 Plan.deleteItem 同款（挂单项目提示订单保留不计入统计）；
  // 软删后的 8 秒撤销条由 undoableDelete 提供
  const deleteWithConfirm = () =>
    Modal.confirm({
      title: `删除项目「${item.name}」？`,
      content: item.order_count > 0
        ? `该项目下有 ${item.order_count} 个订单，删除后订单保留、其付款不再计入项目实际。`
        : '确定删除该清单项？',
      okType: 'danger',
      okText: '删除',
      onOk: () => undoableDelete({
        label: item.name,
        del: () => api.deleteItem(item.id),
        restore: () => restoreWithGuard((f) => api.restoreItem(item.id, f ? { force: true } : undefined), item.name),
        onChanged: () => { onClose(); onChanged(); },
      }),
    });

  // 建订单：与桌面 Orders.createOrder 同语义（超付确认/守卫/票据补传/跳详情）
  const createOrder = async (values: OrderFormValues, files: File[]) => {
    if (values.paid_now && values.paid_now.amount > values.total_amount) {
      const ok = await confirmAsync({
        title: '付款金额超过订单总额',
        content: `总额 ${fmtMoney(values.total_amount)}，本次 ${fmtMoney(values.paid_now.amount)}。确定继续？`,
      });
      if (!ok) return;
    }
    const submit = async (force: boolean) => {
      const order = await api.addOrder({ ...values, ...(force ? { force: true } : {}) });
      const pay = order.payments?.[0];
      if (pay && files.length) {
        let fail = 0;
        for (const f of files) {
          try { await api.uploadReceipt(pay.id, f); } catch { fail++; }
        }
        if (fail) toast.warning(`${fail} 张票据未上传成功，可在订单详情里补传`);
      }
      toast.success(values.paid_now ? '购买已记录' : '订单已创建');
      setOrderOpen(false);
      nav(`/orders/${order.id}`);
      return order;
    };
    setSaving(true);
    try {
      await submitWithForceGuard(submit, () => confirmOrderOnBoughtItem({ name: item.name }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer placement="bottom" open={open} onClose={onClose} height="auto" styles={{ body: { paddingTop: 8, maxHeight: '70vh', overflowY: 'auto' } }}>
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
        <Button size="large" block onClick={() => setEditOpen(true)}>编辑</Button>
        <Button size="large" block onClick={() => setOrderOpen(true)}>+ 订单</Button>
        <Button danger size="large" block onClick={() => deleteWithConfirm()}>删除项目</Button>
        {/* +订单挂已买项目的双算确认走 createOrder 内守卫 */}
      </Space>
      <OrderFormModal
        open={orderOpen}
        sections={sections}
        confirmLoading={saving}
        defaultItemId={item.id}
        onOk={createOrder}
        onCancel={() => setOrderOpen(false)}
      />
      <ItemFormModal
        open={editOpen}
        initial={item}
        confirmLoading={saving}
        onOk={async (values) => {
          setSaving(true);
          try {
            await api.updateItem(item.id, values);
            setEditOpen(false);
            onClose();
            toast.success('已保存');
            onChanged();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
        onCancel={() => setEditOpen(false)}
      />
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

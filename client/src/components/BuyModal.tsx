import { useEffect } from 'react';
import { Button, DatePicker, Form, InputNumber, Modal } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { Item } from '../api';
import { budgetDelta, formatDelta } from '../utils/budgetCalc';
import { paidPrefill } from '../utils/domain';

interface Values {
  price: number;
  date: Dayjs;
}

/**
 * 购买登记：勾「已买」时的确认弹窗
 * - 未买：登记实际支付金额（预算保持不变）与日期
 * - 已买：修正实付金额/日期，或「取消已买」（实付与日期一并清除）
 */
export default function BuyModal({ item, open, onClose, onConfirm, onUnmark, confirmLoading }: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (itemId: number, price: number, date: string) => void;
  onUnmark: (itemId: number) => void;
  confirmLoading?: boolean;
}) {
  const [form] = Form.useForm();
  const isBought = !!item?.bought;
  // 参考值：数量 × 预算单价（抹零/打包价在此基础上直接改）
  const budgetTotal = item ? Number((item.quantity * item.unit_price).toFixed(2)) : 0;
  // 实时差额：填实付时立即反馈较预算超/省多少
  const price = Form.useWatch('price', form);
  const delta = typeof price === 'number' ? budgetDelta(price, budgetTotal) : null;

  useEffect(() => {
    if (open && item) {
      form.setFieldsValue({
        price: paidPrefill(item),
        date: dayjs(item.bought_date || new Date()),
      });
    }
  }, [open, item, form, budgetTotal]);

  if (!item) return null;

  return (
    <Modal
      title={isBought ? `购买登记 · ${item.name}` : `记购买 · ${item.name}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={confirmLoading}
      destroyOnClose
      okText={isBought ? '保存' : '记为已买'}
    >
      <Form form={form} layout="vertical" onFinish={(v: Values) => onConfirm(item.id, v.price, v.date.format('YYYY-MM-DD'))}>
        <Form.Item
          name="price"
          label="实际支付（元）"
          rules={[{ required: true, message: '请输入实际支付金额' }]}
        >
          <InputNumber min={0} precision={2} style={{ width: '100%' }} inputMode="decimal" />
        </Form.Item>
        {delta && (
          <div
            style={{
              marginTop: -12,
              marginBottom: 16,
              fontSize: 13,
              fontWeight: 600,
              color: delta.amount === 0 ? 'var(--ink-3)' : delta.over ? 'var(--clay)' : 'var(--sage)',
            }}
          >
            较预算：{formatDelta(delta)}
          </div>
        )}
        <Form.Item name="date" label="购买日期" rules={[{ required: true, message: '请选择日期' }]}>
          <DatePicker style={{ width: '100%' }} allowClear={false} />
        </Form.Item>
      </Form>
      {isBought && (
        <Button type="link" danger style={{ padding: 0 }} onClick={() => onUnmark(item.id)}>
          取消已买（清除实付金额与日期）
        </Button>
      )}
    </Modal>
  );
}

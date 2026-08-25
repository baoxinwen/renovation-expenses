import { useEffect, useState } from 'react';
import { Button, DatePicker, Form, InputNumber, Modal, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { Item } from '../api';
import { fmtMoney } from '../format';

interface Values {
  price: number;
  date: Dayjs;
}

/**
 * 购买登记：勾「已买」时的确认弹窗
 * - 未买：确认成交价与日期后标记（改价自动保存，原价由后端存为预算基线）
 * - 已买：编辑成交价/日期，或「取消已买」
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

  useEffect(() => {
    if (open && item) {
      form.setFieldsValue({
        price: item.unit_price,
        date: dayjs(item.bought_date || new Date()),
      });
    }
  }, [open, item, form]);

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
      {item.init_unit_price != null && item.init_unit_price !== item.unit_price && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          预算价 {fmtMoney(item.init_unit_price)} → 成交价改后，预算基线已自动记录（分析页可看漂移）
        </Typography.Text>
      )}
      <Form form={form} layout="vertical" onFinish={(v: Values) => onConfirm(item.id, v.price, v.date.format('YYYY-MM-DD'))}>
        <Form.Item
          name="price"
          label={`成交单价（数量 ${item.quantity}，总价将变为 数量×成交价）`}
          rules={[{ required: true, message: '请输入成交单价' }]}
        >
          <InputNumber min={0} precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="date" label="购买日期" rules={[{ required: true, message: '请选择日期' }]}>
          <DatePicker style={{ width: '100%' }} allowClear={false} />
        </Form.Item>
      </Form>
      {isBought && (
        <Button type="link" danger style={{ padding: 0 }} onClick={() => onUnmark(item.id)}>
          取消已买（保留当前价格）
        </Button>
      )}
    </Modal>
  );
}

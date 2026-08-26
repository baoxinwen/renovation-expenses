import { useEffect, useState } from 'react';
import { DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { api } from '../api';
import type { Order } from '../api';
import { fmtMoney, PAY_METHODS } from '../format';
import { confirmAsync } from '../utils/confirm';
import ReceiptUploader from './ReceiptUploader';

/** 待付尾款行内记付款（桌面清单页 / 移动首页共用），可附票据照片 */
export default function QuickPayModal({ order, onClose, onDone }: {
  order: Order | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    if (order) {
      form.resetFields();
      setFiles([]);
      form.setFieldsValue({
        amount: Math.max(0, order.total_amount - (order.paid ?? 0)),
        pay_date: dayjs(),
        method: '微信',
      });
    }
  }, [order, form]);

  const submit = async (values: { amount: number; pay_date: dayjs.Dayjs; method?: string; note?: string }) => {
    if (!order) return;
    const remaining = order.total_amount - (order.paid ?? 0);
    // 负数=退款、超过未付余额=补差价，都属于非常规操作，二次确认防误触
    if (values.amount < 0 || values.amount > Math.max(0, remaining)) {
      const proceed = await confirmAsync(
        values.amount < 0
          ? { title: '这笔是退款吗？', content: `金额为负（${fmtMoney(values.amount)}）会冲抵已付金额。确定继续？` }
          : { title: '本笔付款将超出未付余额', content: `未付 ${fmtMoney(remaining)}，本笔 ${fmtMoney(values.amount)}。确定继续？` },
      );
      if (!proceed) return;
    }
    setSaving(true);
    try {
      const payment = await api.addPayment(order.id, {
        amount: values.amount,
        pay_date: values.pay_date.format('YYYY-MM-DD'),
        method: values.method,
        note: values.note,
      });
      let fail = 0;
      for (const f of files) {
        try { await api.uploadReceipt(payment.id, f); } catch { fail++; }
      }
      if (fail) toast.warning(`${fail} 张票据未上传成功，可在订单详情补传`);
      toast.success('付款已记录');
      onClose();
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`记付款 · ${order?.title ?? ''}`}
      open={!!order}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnClose
    >
      {order && (
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item
            name="amount" label="金额（元）"
            rules={[{ required: true, message: '请输入金额' }]}
            extra={`未付 ${fmtMoney(order.total_amount - (order.paid ?? 0))}（已预填，可改）`}
          >
            <InputNumber precision={2} style={{ width: '100%' }} inputMode="decimal" />
          </Form.Item>
          <Form.Item name="pay_date" label="付款日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} allowClear={false} />
          </Form.Item>
          <Form.Item name="method" label="付款方式">
            <Select allowClear options={PAY_METHODS.map((m) => ({ value: m, label: m }))} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input placeholder="如：中期款、瓷砖尾款" maxLength={100} />
          </Form.Item>
          <Form.Item label="票据照片（可选）">
            <ReceiptUploader files={files} setFiles={setFiles} compact />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}

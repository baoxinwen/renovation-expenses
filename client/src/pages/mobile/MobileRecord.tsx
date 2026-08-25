import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, DatePicker, Form, Input, InputNumber, Segmented, Select, Typography, Upload } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { api } from '../../api';
import type { Item, Order, Section } from '../../api';
import { fmtMoney, PAY_METHODS } from '../../format';

type Mode = 'pay' | 'bought' | 'new';

/** 记一笔：付一笔款 / 买了东西 / 新购买含票据 —— 移动端核心页 */
export default function MobileRecord() {
  const [mode, setMode] = useState<Mode>('pay');
  const [sections, setSections] = useState<Section[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [saving, setSaving] = useState(false);

  const [payForm] = Form.useForm();
  const [boughtForm] = Form.useForm();
  const [newForm] = Form.useForm();
  const [payFiles, setPayFiles] = useState<File[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [boughtItem, setBoughtItem] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, orders] = await Promise.all([api.getPlan(), api.getOrders({ status: 'open' })]);
      setSections(p.sections);
      setOpenOrders(orders.filter((o) => (o.paid ?? 0) < o.total_amount && o.total_amount > 0));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allItems = useMemo(
    () => sections.flatMap((s) => (s.items ?? []).map((it) => ({ ...it, sectionName: s.name }))),
    [sections],
  );
  const itemOptions = allItems
    .filter((it) => it.order_count === 0)
    .map((it) => ({ value: it.id, label: `${it.name}${it.spec ? ` · ${it.spec}` : ''}`, item: it }));

  const uploadProps = (files: File[], setFiles: (f: File[]) => void) => ({
    accept: '.jpg,.jpeg,.png,.webp',
    multiple: true,
    fileList: files.map((f, i) => ({ uid: `k${i}`, name: f.name, status: 'done' } as never)),
    beforeUpload: (file: unknown) => {
      setFiles([...files, file as File]);
      return false;
    },
    onRemove: (file: { uid?: string }) => {
      const idx = Number(String(file.uid ?? '').slice(1));
      setFiles(files.filter((_, i) => i !== idx));
    },
  });

  // ---- 流程 1：付一笔款 ----
  const submitPay = async (v: { order_id: number; amount: number; pay_date: unknown; method?: string; note?: string }) => {
    const order = openOrders.find((o) => o.id === v.order_id);
    if (!order) return toast.error('请选择订单');
    setSaving(true);
    try {
      const payment = await api.addPayment(order.id, {
        amount: v.amount,
        pay_date: (v.pay_date as dayjs.Dayjs).format('YYYY-MM-DD'),
        method: v.method,
        note: v.note,
      });
      let fail = 0;
      for (const f of payFiles) {
        try { await api.uploadReceipt(payment.id, f); } catch { fail++; }
      }
      toast.success(fail ? `付款已记录，${fail} 张票据失败可稍后补传` : '付款已记录');
      payForm.resetFields();
      setPayFiles([]);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ---- 流程 2：买了东西（已买登记） ----
  const submitBought = async (v: { item_id: number; price: number; date: unknown }) => {
    const item = allItems.find((it) => it.id === v.item_id);
    if (!item) return toast.error('请选择项目');
    setSaving(true);
    try {
      await api.updateItem(item.id, {
        bought: true,
        unit_price: v.price,
        bought_date: (v.date as dayjs.Dayjs).format('YYYY-MM-DD'),
      });
      toast.success(`已记录：${item.name}`);
      setBoughtItem(null);
      boughtForm.resetFields();
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ---- 流程 3：新购买（一次付清含票据） ----
  const submitNew = async (v: {
    item_id?: number; title: string; vendor?: string; total_amount: number;
    pay_date: unknown; pay_method?: string; note?: string;
  }) => {
    setSaving(true);
    try {
      const order = await api.addOrder({
        title: v.title,
        vendor: v.vendor,
        item_id: v.item_id ?? null,
        total_amount: v.total_amount,
        note: v.note,
        paid_now: {
          amount: v.total_amount,
          pay_date: (v.pay_date as dayjs.Dayjs).format('YYYY-MM-DD'),
          method: v.pay_method ?? '微信',
        },
      });
      const pay = order.payments?.[0];
      let fail = 0;
      if (pay) {
        for (const f of newFiles) {
          try { await api.uploadReceipt(pay.id, f); } catch { fail++; }
        }
      }
      toast.success(fail ? '购买已记录，部分票据失败可在订单详情补传' : '购买已记录（订单+付款+票据）');
      newForm.resetFields();
      setNewFiles([]);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Segmented
        block
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        options={[
          { value: 'pay', label: '付一笔款' },
          { value: 'bought', label: '买了东西' },
          { value: 'new', label: '新购买' },
        ]}
        style={{ marginBottom: 12 }}
      />

      {mode === 'pay' && (
        <Card styles={{ body: { padding: 16 } }}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            给未结清的订单付一笔（定金/中期/尾款都可），可拍照留票据
          </Typography.Paragraph>
          <Form form={payForm} layout="vertical" onFinish={submitPay} initialValues={{ pay_date: dayjs(), method: '微信' }}>
            <Form.Item name="order_id" label="选择订单" rules={[{ required: true, message: '请选择订单' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={openOrders.length ? '搜索或选择订单' : '没有未结清订单'}
                options={openOrders.map((o) => ({
                  value: o.id,
                  label: `${o.title}（未付 ${fmtMoney(o.total_amount - (o.paid ?? 0))}）`,
                }))}
                onChange={(id) => {
                  const o = openOrders.find((x) => x.id === id);
                  if (o) payForm.setFieldsValue({ amount: o.total_amount - (o.paid ?? 0) });
                }}
              />
            </Form.Item>
            <Form.Item name="amount" label="金额（元）" rules={[{ required: true, message: '请输入金额' }]}>
              <InputNumber precision={2} style={{ width: '100%' }} inputMode="decimal" />
            </Form.Item>
            <Form.Item name="pay_date" label="日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} allowClear={false} />
            </Form.Item>
            <Form.Item name="method" label="方式">
              <Select allowClear options={PAY_METHODS.map((m) => ({ value: m, label: m }))} />
            </Form.Item>
            <Form.Item name="note" label="备注">
              <Input placeholder="如：中期款" maxLength={100} />
            </Form.Item>
            <Form.Item label="票据照片（可选）">
              <Upload {...uploadProps(payFiles, setPayFiles)}>
                <Button icon={<PaperClipOutlined />}>拍照 / 相册</Button>
              </Upload>
            </Form.Item>
            <Button type="primary" size="large" block htmlType="submit" loading={saving}>记录付款</Button>
          </Form>
        </Card>
      )}

      {mode === 'bought' && (
        <Card styles={{ body: { padding: 16 } }}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            小件买完直接登记：选项目 → 填成交价（默认预算价），总价自动计入
          </Typography.Paragraph>
          <Form form={boughtForm} layout="vertical" onFinish={submitBought} initialValues={{ date: dayjs() }}>
            <Form.Item name="item_id" label="选择清单项目" rules={[{ required: true, message: '请选择项目' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="搜索项目名 / 品牌"
                options={itemOptions}
                onChange={(id) => {
                  const it = allItems.find((x) => x.id === id);
                  setBoughtItem(it ?? null);
                  if (it) boughtForm.setFieldsValue({ price: it.unit_price });
                }}
              />
            </Form.Item>
            {boughtItem && (
              <div style={{ background: 'var(--wood-50)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
                {boughtItem.spec || boughtItem.name} · 数量 {boughtItem.quantity} × {fmtMoney(boughtItem.unit_price)}
                <span className="tabular" style={{ float: 'right', fontWeight: 650 }}>{fmtMoney(boughtItem.budget_amount)}</span>
              </div>
            )}
            <Form.Item name="price" label="成交单价" rules={[{ required: true, message: '请输入成交价' }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} inputMode="decimal" />
            </Form.Item>
            <Form.Item name="date" label="购买日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} allowClear={false} />
            </Form.Item>
            <Button type="primary" size="large" block htmlType="submit" loading={saving}>记为已买</Button>
          </Form>
        </Card>
      )}

      {mode === 'new' && (
        <Card styles={{ body: { padding: 16 } }}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            一次性买齐（订单+付款+票据一步完成，自动结清）
          </Typography.Paragraph>
          <Form form={newForm} layout="vertical" onFinish={submitNew} initialValues={{ pay_date: dayjs(), pay_method: '微信' }}>
            <Form.Item name="item_id" label="关联清单项目（可选）">
              <Select
                showSearch
                allowClear
                optionFilterProp="label"
                placeholder="搜索项目"
                options={sections.flatMap((s) => (s.items ?? []).map((it) => ({ value: it.id, label: `${s.name} / ${it.name}` })))}
                onChange={(id) => {
                  if (!id) return;
                  const it = allItems.find((x) => x.id === id);
                  if (it) newForm.setFieldsValue({ title: it.name, total_amount: it.budget_amount });
                }}
              />
            </Form.Item>
            <Form.Item name="title" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="如：全屋开关面板" maxLength={60} />
            </Form.Item>
            <Form.Item name="vendor" label="商家">
              <Input placeholder="选填" maxLength={60} />
            </Form.Item>
            <Form.Item name="total_amount" label="总额（元）" rules={[{ required: true, message: '请输入总额' }]}>
              <InputNumber min={0.01} precision={2} style={{ width: '100%' }} inputMode="decimal" />
            </Form.Item>
            <Form.Item name="pay_date" label="付款日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} allowClear={false} />
            </Form.Item>
            <Form.Item name="pay_method" label="方式">
              <Select allowClear options={PAY_METHODS.map((m) => ({ value: m, label: m }))} />
            </Form.Item>
            <Form.Item label="票据照片（可选）">
              <Upload {...uploadProps(newFiles, setNewFiles)}>
                <Button icon={<PaperClipOutlined />}>拍照 / 相册</Button>
              </Upload>
            </Form.Item>
            <Button type="primary" size="large" block htmlType="submit" loading={saving}>记录购买</Button>
          </Form>
        </Card>
      )}
    </div>
  );
}

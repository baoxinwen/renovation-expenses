import { useEffect, useState } from 'react';
import { DatePicker, Modal, Form, Input, InputNumber, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import type { Order, OrderFormValues, Section } from '../api';
import { PAY_METHODS } from '../format';
import ReceiptUploader from './ReceiptUploader';

interface Props {
  open: boolean;
  initial?: Order | null;
  sections: Section[];
  confirmLoading?: boolean;
  /** files：一次付清时选择待上传的票据照片（创建订单后自动传到首笔付款） */
  onOk: (values: OrderFormValues, files: File[]) => void;
  onCancel: () => void;
}

export default function OrderFormModal({ open, initial, sections, confirmLoading, onOk, onCancel }: Props) {
  const [form] = Form.useForm();
  const isNew = !initial;
  // 一次付清默认开启：多数从清单行进来的都是一口价小件；分期大件关掉即可
  const [payFull, setPayFull] = useState(true);
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setPayFull(isNew);
      setFiles([]);
      // 编辑模式回填现有值（缺失回填会让"仅改备注"提交时把 item_id 置空、静默解除项目关联）
      if (initial) {
        form.setFieldsValue({
          title: initial.title,
          vendor: initial.vendor || undefined,
          item_id: initial.item_id ?? undefined,
          total_amount: initial.total_amount,
          note: initial.note || undefined,
        });
      }
    }
  }, [open, initial, isNew, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const base: OrderFormValues = {
      title: values.title,
      vendor: values.vendor,
      item_id: values.item_id ?? null,
      total_amount: values.total_amount,
      note: values.note,
    };
    if (isNew && payFull) {
      base.paid_now = {
        amount: values.pay_amount ?? values.total_amount,
        pay_date: (values.pay_date ?? dayjs()).format('YYYY-MM-DD'),
        method: values.pay_method ?? '微信',
      };
    }
    onOk(base, files);
  };

  return (
    <Modal
      title={initial ? '编辑订单' : '新建订单'}
      open={open}
      onCancel={onCancel}
      onOk={submit}
      confirmLoading={confirmLoading}
      destroyOnClose
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ pay_date: dayjs(), pay_method: '微信' }}
      >
        <Form.Item name="title" label="订单名称" rules={[{ required: true, message: '请输入订单名称' }]}>
          <Input placeholder="如：装修公司首期款、瓷砖补货" maxLength={100} />
        </Form.Item>
        <Form.Item name="vendor" label="商家 / 施工方">
          <Input placeholder="如：XX建材店、李师傅" maxLength={100} />
        </Form.Item>
        <Form.Item
          name="item_id"
          label="关联预算项目"
          extra="挂到清单里的某个项目，付款会计入该项目实际支出"
        >
          <Select
            allowClear
            showSearch
            placeholder="选择清单项目（可不选）"
            optionFilterProp="label"
            options={sections
              .filter((s) => (s.items ?? []).length > 0)
              .map((s) => ({
                label: s.name,
                options: (s.items ?? []).map((it) => ({
                  value: it.id,
                  label: `${s.name} / ${it.name}`,
                })),
              }))}
          />
        </Form.Item>
        <Form.Item
          name="total_amount"
          label="订单总额（元）"
          rules={[{ required: true, message: '请输入订单总额' }]}
        >
          <InputNumber min={0.01} precision={2} style={{ width: '100%' }} placeholder="100000" />
        </Form.Item>

        {isNew && (
          <div
            style={{
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '4px 12px 12px',
              marginBottom: 16,
              background: 'var(--wood-50)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
              <span style={{ fontWeight: 600 }}>一次付清</span>
              <Switch checked={payFull} onChange={setPayFull} />
            </div>
            {payFull && (
              <>
                <Form.Item
                  name="pay_amount"
                  label="本次付款金额"
                  extra="默认等于订单总额；定金场景请关闭本开关"
                  style={{ marginBottom: 10 }}
                >
                  <InputNumber min={0.01} precision={2} style={{ width: '100%' }} placeholder="默认 = 订单总额" />
                </Form.Item>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Form.Item name="pay_date" label="付款日期" style={{ marginBottom: 10, flex: 1 }}>
                    <DatePicker style={{ width: '100%' }} allowClear={false} />
                  </Form.Item>
                  <Form.Item name="pay_method" label="付款方式" style={{ marginBottom: 10, flex: 1 }}>
                    <Select allowClear options={PAY_METHODS.map((m) => ({ value: m, label: m }))} />
                  </Form.Item>
                </div>
                <Form.Item label="票据照片（可选）" style={{ marginBottom: 0 }}>
                  <ReceiptUploader files={files} setFiles={setFiles} />
                </Form.Item>
              </>
            )}
          </div>
        )}

        <Form.Item name="note" label="备注">
          <Input.TextArea rows={2} placeholder="型号、口头约定、保修条款等" maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

import { useEffect } from 'react';
import { Modal, Form, Input, InputNumber, Select } from 'antd';
import type { Order, OrderFormValues, Section } from '../api';

interface Props {
  open: boolean;
  initial?: Order | null;
  sections: Section[];
  confirmLoading?: boolean;
  onOk: (values: OrderFormValues) => void;
  onCancel: () => void;
}

export default function OrderFormModal({ open, initial, sections, confirmLoading, onOk, onCancel }: Props) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) {
      form.resetFields();
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
  }, [open, initial, form]);

  return (
    <Modal
      title={initial ? '编辑订单' : '新建订单'}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={confirmLoading}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => onOk({ ...v, item_id: v.item_id ?? null })}
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
          extra="定金+尾款的总口径，事后可修改"
        >
          <InputNumber min={0.01} precision={2} style={{ width: '100%' }} placeholder="100000" />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={2} placeholder="型号、口头约定、保修条款等" maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

import { useEffect } from 'react';
import { Modal, Form, Input, InputNumber } from 'antd';
import type { ItemFormValues } from '../api';

interface Props {
  open: boolean;
  confirmLoading?: boolean;
  onOk: (values: ItemFormValues) => void;
  onCancel: () => void;
}

export default function ItemFormModal({ open, confirmLoading, onOk, onCancel }: Props) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  return (
    <Modal
      title="添加清单项目"
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={confirmLoading}
      destroyOnClose
    >
      {/* onOk 由 Form.onFinish 驱动：form.submit() 校验通过后才会触发，校验失败由表单内红字提示 */}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ quantity: 1, unit_price: 0 }}
        onFinish={(values) => onOk(values as ItemFormValues)}
      >
        <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
          <Input placeholder="如：抽油烟机、电视柜" maxLength={60} />
        </Form.Item>
        <Form.Item name="spec" label="规格 / 品牌参考">
          <Input placeholder="如：小米智能净烟机3pro" maxLength={100} />
        </Form.Item>
        <Form.Item name="unit" label="单位" style={{ display: 'inline-block', width: '30%', marginRight: 8 }}>
          <Input placeholder="台 / 个 / 项" maxLength={10} />
        </Form.Item>
        <Form.Item name="quantity" label="数量" style={{ display: 'inline-block', width: '30%', marginRight: 8 }}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="unit_price" label="单价（元）" style={{ display: 'inline-block', width: '34%' }}>
          <InputNumber min={0} precision={2} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input placeholder="选填" maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

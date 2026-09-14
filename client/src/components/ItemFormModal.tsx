import { useEffect } from 'react';
import { Modal, Form, Input, InputNumber } from 'antd';
import type { Item, ItemFormValues } from '../api';

/** 编辑模式额外可改：实际支付金额（仅已买项目展示） */
export interface ItemFormResult extends ItemFormValues {
  paid_amount?: number | null;
}

interface Props {
  open: boolean;
  /** 传入即编辑模式：回填项目全部字段（含实付金额） */
  initial?: Item | null;
  confirmLoading?: boolean;
  onOk: (values: ItemFormResult) => void;
  onCancel: () => void;
}

export default function ItemFormModal({ open, initial, confirmLoading, onOk, onCancel }: Props) {
  const [form] = Form.useForm();
  const isEdit = !!initial;
  // 参考值：数量 × 预算单价（实付未登记时的回出口径）
  const budgetTotal = initial ? Number((initial.quantity * initial.unit_price).toFixed(2)) : 0;

  useEffect(() => {
    if (!open) return;
    if (initial) {
      form.setFieldsValue({
        name: initial.name,
        spec: initial.spec || undefined,
        unit: initial.unit || undefined,
        quantity: initial.quantity,
        unit_price: initial.unit_price,
        note: initial.note || undefined,
        paid_amount: initial.bought ? (initial.paid_amount ?? budgetTotal) : undefined,
      });
    } else {
      form.resetFields();
    }
  }, [open, initial, form, budgetTotal]);

  return (
    <Modal
      title={isEdit ? `编辑项目 · ${initial!.name}` : '添加清单项目'}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={confirmLoading}
      destroyOnClose
      okText={isEdit ? '保存' : '添加'}
    >
      {/* onOk 由 Form.onFinish 驱动：form.submit() 校验通过后才会触发，校验失败由表单内红字提示 */}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ quantity: 1, unit_price: 0 }}
        onFinish={(v) => {
          const values: ItemFormResult = {
            name: v.name,
            spec: v.spec,
            unit: v.unit,
            quantity: v.quantity ?? 1,
            unit_price: v.unit_price ?? 0,
            note: v.note,
          };
          // 编辑已买项目时提交实付金额（清空输入 = 清除实付，实际回退 数量×单价）
          if (isEdit && initial?.bought) values.paid_amount = v.paid_amount ?? null;
          onOk(values);
        }}
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
        <Form.Item
          name="unit_price"
          label="单价（元）"
          style={{ display: 'inline-block', width: '34%' }}
          extra={isEdit ? '预算单价，改这里不影响已登记的实际支付' : undefined}
        >
          <InputNumber min={0} precision={2} style={{ width: '100%' }} />
        </Form.Item>
        {isEdit && initial?.bought === 1 && (
          <Form.Item
            name="paid_amount"
            label="实际支付（元）"
            extra={`清空并保存 = 清除实付，实际支出回退 数量×单价 = ${budgetTotal} 元`}
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="未登记" />
          </Form.Item>
        )}
        <Form.Item name="note" label="备注">
          <Input placeholder="选填" maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

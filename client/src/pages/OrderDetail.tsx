import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Breadcrumb, Button, Card, Col, Descriptions, Empty, Form, Image, Input, InputNumber, Modal,
  Popconfirm, Row, Select, Space, DatePicker, Table, Tag, Upload,
} from 'antd';
import { ArrowLeftOutlined, CheckOutlined, DownloadOutlined, EditOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { api } from '../api';
import type { Order, Payment, Receipt, Section, OrderFormValues } from '../api';
import { fmtMoney, PAY_METHODS } from '../format';
import { undoableDelete, confirmOrderOnBoughtItem, submitWithForceGuard, submitPaymentWithGuard } from '../utils/domain';
import { confirmAsync } from '../utils/confirm';
import { useIsMobile } from '../hooks/useIsMobile';
import OrderFormModal from '../components/OrderFormModal';

interface PaymentFormValues {
  amount: number;
  pay_date: dayjs.Dayjs;
  method?: string;
  note?: string;
}

/** 付款的票据区：缩略图预览 + 单张删除 + 上传（桌面表格单元格与移动卡片共用同一实现） */
function ReceiptBlock({ p, onRemoveReceipt, onChanged }: {
  p: Payment;
  onRemoveReceipt: (r: Receipt) => void;
  onChanged: () => void;
}) {
  return (
    <Space wrap size={8}>
      <Image.PreviewGroup>
        {(p.receipts ?? []).map((r) => (
          <Image
            key={r.id}
            src={`/uploads/${r.filename}`}
            alt={r.original_name}
            width={44}
            height={44}
            style={{ objectFit: 'cover', borderRadius: 4 }}
          />
        ))}
      </Image.PreviewGroup>
      {(p.receipts ?? []).map((r) => (
        <Button
          key={'del-' + r.id}
          type="text"
          size="small"
          danger
          onClick={() => onRemoveReceipt(r)}
          style={{ padding: 0 }}
        >
          删除「{r.original_name}」
        </Button>
      ))}
      <Upload
        accept=".jpg,.jpeg,.png,.webp"
        showUploadList={false}
        multiple
        customRequest={async ({ file, onSuccess, onError }) => {
          try {
            await api.uploadReceipt(p.id, file as File);
            onSuccess?.({});
            onChanged();
          } catch (e) {
            toast.error((e as Error).message);
            onError?.(e as Error);
          }
        }}
      >
        <Button type="link" size="small" icon={<UploadOutlined />}>上传票据</Button>
      </Upload>
    </Space>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  const orderId = Number(id);
  const nav = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const [payModalOpen, setPayModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [payForm] = Form.useForm();

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    // 序号守卫（对照 Plan/Orders 先例）：多张票据并行上传时先完成的 load
    // 响应后到，旧状态会覆盖新状态（票据列表短暂缺张）
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const order = await api.getOrder(orderId);
      if (seq === loadSeq.current) setOrder(order);
    } catch (e) {
      if (seq === loadSeq.current) {
        toast.error((e as Error).message);
        nav('/orders');
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [orderId, nav]);

  useEffect(() => {
    load();
    api.getPlan().then((p) => setSections(p.sections)).catch((e) => toast.error(`清单加载失败：${(e as Error).message}`));
  }, [load]);

  if (!order) {
    return <Card loading={loading} style={{ height: 300 }} />;
  }

  const paid = order.paid ?? 0;
  const unpaid = Math.max(0, order.total_amount - paid);
  const overpaid = paid > order.total_amount;

  // 编辑模式不提供「一次付清」（付款在详情页管理），files 恒为空
  const saveOrder = async (values: OrderFormValues, _files: File[]) => {
    const submit = async (force: boolean) => {
      const updated = await api.updateOrder(order.id, force ? { ...values, force: true } : values);
      toast.success('订单已更新');
      setEditOpen(false);
      load();
      return updated;
    };
    setSavingEdit(true);
    try {
      // force 只由服务端 409 触发（submitWithForceGuard 统一链路）：本地快照的
      // bought 判定不作仲裁，多端场景会过期；确认文案取最新项目名
      await submitWithForceGuard(submit, async () => {
        let name = values.item_id
          ? sections.flatMap((s) => s.items ?? []).find((it) => it.id === values.item_id)?.name
          : undefined;
        if (!name && values.item_id) {
          try {
            name = (await api.getPlan()).sections.flatMap((s) => s.items ?? []).find((it) => it.id === values.item_id)?.name;
          } catch { /* 拿不到最新清单就用兜底文案 */ }
        }
        return confirmOrderOnBoughtItem({ name: name ?? '该项目' });
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const closeOrder = () =>
    Modal.confirm({
      title: '确认结清',
      content: `将「${order.title}」标记为已结清？`,
      onOk: async () => {
        try {
          await api.updateOrder(order.id, { status: 'closed' });
          toast.success('已标记结清');
          load();
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    });

  const deleteOrder = () =>
    Modal.confirm({
      title: '删除订单',
      content: '删除后 8 秒内可撤销。',
      okType: 'danger',
      okText: '删除',
      onOk: () => undoableDelete({
        label: order.title,
        del: () => api.deleteOrder(order.id),
        // 恢复 409 守卫的处理与订单列表页同链路：确认后带 force 重试
        restore: async () => {
          try {
            return await api.restoreOrder(order.id);
          } catch (e) {
            const err = e as Error & { needForce?: boolean };
            if (!err.needForce) throw e;
            const name = sections.flatMap((s) => s.items ?? []).find((it) => it.id === order.item_id)?.name ?? '关联项目';
            const ok = await confirmAsync({
              title: '恢复会重复计入实际',
              content: `「${name}」在订单删除期间已勾「已买」，恢复会让付款重新计入实际合计。仍要恢复吗？`,
              okText: '仍要恢复',
            });
            if (!ok) throw new Error('已取消恢复');
            return api.restoreOrder(order.id, { force: true });
          }
        },
        onChanged: () => nav('/orders'),
        afterRestore: () => nav('/orders'),
      }),
    });

  const openPayModal = (p?: Payment) => {
    setEditingPayment(p ?? null);
    payForm.resetFields();
    if (p) {
      payForm.setFieldsValue({
        amount: p.amount,
        pay_date: dayjs(p.pay_date),
        method: p.method || undefined,
        note: p.note || undefined,
      });
    }
    setPayModalOpen(true);
  };

  const submitPayment = async (values: PaymentFormValues) => {
    const body = {
      amount: values.amount,
      pay_date: values.pay_date.format('YYYY-MM-DD'),
      method: values.method ?? '',
      note: values.note ?? '',
    };
    // 付款超出未付余额时允许保存但给出提示（现实中存在补差价）；编辑时按扣除原金额后的余额判断
    const effectiveUnpaid = unpaid + (editingPayment ? editingPayment.amount : 0);
    if (body.amount > 0 && body.amount > effectiveUnpaid) {
      const proceed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '本笔付款将超出订单未付余额',
          content: `未付余额 ${fmtMoney(effectiveUnpaid)}，本笔 ${fmtMoney(body.amount)}。确定继续？`,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!proceed) return;
    }
    setSavingPayment(true);
    try {
      if (editingPayment) {
        await api.updatePayment(editingPayment.id, body);
        toast.success('付款已更新');
      } else {
        // 近重复守卫（r2 I4）：同订单同金额同日期已存在时服务端 409，确认后放行
        await submitPaymentWithGuard(
          (force) => api.addPayment(order.id, { ...body, ...(force ? { force: true } : {}) }),
          (err) => confirmAsync({
            title: '这笔付款可能是重复提交',
            content: `${err.message}。确属另一笔同日同额付款可继续。`,
            okText: '仍要记录',
          }),
        );
        toast.success('付款已记录');
      }
      setPayModalOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingPayment(false);
    }
  };

  // 已结清的出口：发现尾款/质保金/退款要记时可回到「进行中」（既有状态开关的逆操作）
  const reopenOrder = async () => {
    try {
      await api.updateOrder(order.id, { status: 'open' });
      toast.success('已重新打开');
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const deletePayment = async (p: Payment) => {
    try {
      await api.deletePayment(p.id);
      toast.success('付款已删除');
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // 票据是维权凭证且物理删除不可恢复（服务端直接 unlink），误触代价高——必须二次确认
  const removeReceipt = (r: Receipt) =>
    Modal.confirm({
      title: `删除票据「${r.original_name}」？`,
      content: '记录与照片文件将被永久删除，不可撤销。',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await api.deleteReceipt(r.id);
          load();
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    });

  const payments = order.payments ?? [];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Breadcrumb
        items={[{ title: <Link to="/orders"><ArrowLeftOutlined /> 订单</Link> }, { title: order.title }]}
      />

      <Card
        title={order.title}
        extra={
          <Space wrap>
            {order.status === 'open' && paid >= order.total_amount && order.total_amount > 0 && (
              <Button icon={<CheckOutlined />} onClick={closeOrder}>标记结清</Button>
            )}
            {order.status === 'closed' && (
              <Button onClick={reopenOrder}>重新打开</Button>
            )}
            {(order.payments ?? []).some((p) => (p.receipts ?? []).length > 0) && (
              <Button icon={<DownloadOutlined />} href={`/api/export/receipts?order_id=${order.id}`}>下载票据</Button>
            )}
            <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>编辑</Button>
            <Button danger onClick={deleteOrder}>删除</Button>
          </Space>
        }
      >
        <Row gutter={16}>
          <Col xs={24} md={16}>
            <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
              <Descriptions.Item label="商家 / 施工方">{order.vendor || '—'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {order.status === 'closed' ? <Tag color="green">已结清</Tag> : <Tag color="blue">进行中</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="关联预算项目" span={3}>
                {order.item_name ? (
                  <Space size={6}>
                    <span>{order.item_name}</span>
                    {order.section_name && <Tag bordered={false}>{order.section_name}</Tag>}
                  </Space>
                ) : '未关联（付款不计入清单实际）'}
              </Descriptions.Item>
              <Descriptions.Item label="订单总额">
                <span style={{ fontSize: 20, fontWeight: 600 }}>{fmtMoney(order.total_amount)}</span>
              </Descriptions.Item>
              {order.note && (
                <Descriptions.Item label="备注" span={3}>{order.note}</Descriptions.Item>
              )}
            </Descriptions>
          </Col>
          <Col xs={24} md={8}>
            <div style={{ textAlign: 'right', padding: 8, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ color: '#8c8c8c' }}>已付 / 未付</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--sage)' }}>{fmtMoney(paid)}</div>
              <div style={{ fontSize: 16, color: overpaid ? '#faad14' : unpaid > 0 ? '#fa8c16' : '#52c41a' }}>
                {overpaid ? '已付超出 ' : '未付 '}
                {fmtMoney(overpaid ? paid - order.total_amount : unpaid)}
              </div>
            </div>
          </Col>
        </Row>
      </Card>

      <Card
        title={`付款记录（${payments.length} 笔）`}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openPayModal()}>
            记一笔付款
          </Button>
        }
      >
        {isMobile ? (
          /* 移动端卡片：桌面付款表 7 列在窄屏只剩横滚 860px——手机核对付款与
             给工头看票据照片是核心场景，卡片化后缩略图/上传/修改直达 */
          payments.length === 0 ? (
            <Card>
              <Empty description="还没有付款记录，点击右上角「记一笔付款」开始" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 20 }} />
            </Card>
          ) : (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {payments.map((p) => (
                <Card key={p.id} size="small" styles={{ body: { padding: '10px 12px' } }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{p.pay_date}</span>
                    <span className="tabular" style={{ fontWeight: 600, fontSize: 16, color: p.amount < 0 ? 'var(--sage)' : undefined }}>
                      {fmtMoney(p.amount)}
                    </span>
                  </div>
                  {(p.method || p.note) && (
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>
                      {[p.method, p.note].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <ReceiptBlock p={p} onRemoveReceipt={removeReceipt} onChanged={load} />
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                    <Button type="link" size="small" onClick={() => openPayModal(p)}>修改</Button>
                    <Popconfirm
                      title="删除该笔付款？"
                      description={(p.receipts ?? []).length
                        ? `该笔付款及 ${(p.receipts ?? []).length} 张票据照片将一并永久删除，不可撤销`
                        : '该笔付款将被永久删除，不可撤销'}
                      okText="删除"
                      okType="danger"
                      onConfirm={() => deletePayment(p)}
                    >
                      <Button type="link" size="small" danger>删除</Button>
                    </Popconfirm>
                  </div>
                </Card>
              ))}
            </Space>
          )
        ) : (
        <Table<Payment>
          rowKey="id"
          dataSource={payments}
          pagination={false}
          locale={{ emptyText: '还没有付款记录，点击右上角「记一笔付款」开始' }}
          columns={[
            { title: '日期', dataIndex: 'pay_date', width: 110 },
            {
              title: '金额', dataIndex: 'amount', width: 130, align: 'right',
              render: (v: number) => (
                <span style={{ fontWeight: 600, color: v < 0 ? '#52c41a' : undefined }}>{fmtMoney(v)}</span>
              ),
            },
            { title: '方式', dataIndex: 'method', width: 90, render: (v: string) => v || '—' },
            { title: '备注', dataIndex: 'note', render: (v: string) => v || '—' },
            {
              title: '票据', width: 280,
              render: (_, p) => (
                <ReceiptBlock p={p} onRemoveReceipt={removeReceipt} onChanged={load} />
              ),
            },
            {
              title: '操作', width: 130,
              render: (_, p) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => openPayModal(p)}>修改</Button>
                  <Popconfirm
                    title="删除该笔付款？"
                    description={(p.receipts ?? []).length
                      ? `该笔付款及 ${(p.receipts ?? []).length} 张票据照片将一并永久删除，不可撤销`
                      : '该笔付款将被永久删除，不可撤销'}
                    okText="删除"
                    okType="danger"
                    onConfirm={() => deletePayment(p)}
                  >
                    <Button type="link" size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          summary={() =>
            payments.length ? (
              <Table.Summary.Row style={{ fontWeight: 600 }}>
                <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">{fmtMoney(paid)}</Table.Summary.Cell>
                <Table.Summary.Cell index={2} colSpan={4} />
              </Table.Summary.Row>
            ) : null
          }
        />
        )}
      </Card>

      <OrderFormModal
        open={editOpen}
        initial={order}
        sections={sections}
        confirmLoading={savingEdit}
        onOk={saveOrder}
        onCancel={() => setEditOpen(false)}
      />

      <Modal
        title={editingPayment ? '修改付款' : '记一笔付款'}
        open={payModalOpen}
        onCancel={() => setPayModalOpen(false)}
        onOk={() => payForm.submit()}
        confirmLoading={savingPayment}
        destroyOnClose
      >
        <Form
          form={payForm}
          layout="vertical"
          initialValues={{ pay_date: dayjs(), method: '微信' }}
          onFinish={submitPayment}
        >
          <Form.Item
            name="amount"
            label="金额（元）"
            rules={[{ required: true, message: '请输入金额' }]}
            extra="付款为正数；退货/退款请输入负数，统计自动冲抵"
          >
            <InputNumber precision={2} style={{ width: '100%' }} placeholder="2000" inputMode="decimal" />
          </Form.Item>
          <Form.Item name="pay_date" label="付款日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="method" label="付款方式">
            <Select allowClear options={PAY_METHODS.map((m) => ({ value: m, label: m }))} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input placeholder="如：定金、货到付尾款、退货" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

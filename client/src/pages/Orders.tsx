import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Order, OrderFormValues, Section } from '../api';
import { fmtMoney } from '../format';
import WoodProgress from '../components/WoodProgress';
import { toast } from 'sonner';
import OrderFormModal from '../components/OrderFormModal';

export default function Orders() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [sections, setSections] = useState<Section[]>([]);
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState<{ section_id?: number; item_id?: number; status?: string; q: string }>(() => ({
    item_id: searchParams.get('item_id') ? Number(searchParams.get('item_id')) : undefined,
    section_id: searchParams.get('section_id') ? Number(searchParams.get('section_id')) : undefined,
    // 默认只看进行中的订单，隐藏已结清小件；从清单行带 item_id 进来时显示该项目的全部订单
    status: searchParams.get('status') ?? (searchParams.get('item_id') ? undefined : 'open'),
    q: '',
  }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.getOrders({ ...filters, q: filters.q || undefined }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    api.getPlan().then((p) => setSections(p.sections)).catch((e) => toast.error(`清单加载失败：${(e as Error).message}`));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 从清单页带 new=1 跳转过来时直接打开新建弹窗
  useEffect(() => {
    if (searchParams.get('new') === '1') setModalOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findItem = (id: number) =>
    sections.flatMap((s) => s.items ?? []).find((it) => it.id === id);

  const createOrder = async (values: OrderFormValues, files: File[]) => {
    // 双算校验：挂到已勾「已买」的项目会重复计入实际
    const target = values.item_id ? findItem(values.item_id) : null;
    if (target?.bought) {
      const proceed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '该项目已勾选「已买」',
          content: `「${target.name}」的总价已计入实际，再把订单付款挂上去会重复计入。通常二选一即可，仍要关联吗？`,
          okText: '仍要关联',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!proceed) return;
    }
    // 一次付清金额超出总额（用户手动改大）时确认
    if (values.paid_now && values.paid_now.amount > values.total_amount) {
      const ok = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '付款金额超过订单总额',
          content: `总额 ${fmtMoney(values.total_amount)}，本次 ${fmtMoney(values.paid_now!.amount)}。确定继续？`,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const order = await api.addOrder(values);
      // 一次付清：把选好的票据直接传到首笔付款上
      const pay = order.payments?.[0];
      if (pay && files.length) {
        let fail = 0;
        for (const f of files) {
          try { await api.uploadReceipt(pay.id, f); } catch { fail++; }
        }
        if (fail) toast.warning(`${fail} 张票据未上传成功，可在订单详情里补传`);
      }
      toast.success(values.paid_now ? '购买已记录（订单+付款+票据）' : '订单已创建');
      setModalOpen(false);
      nav(`/orders/${order.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const doDeleteOrder = async (o: Order) => {
    try {
      await api.deleteOrder(o.id);
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    toast.success(`已删除「${o.title}」`, {
      duration: 8000,
      action: {
        label: '撤销',
        onClick: () => api.restoreOrder(o.id).then(load).catch((e) => toast.error((e as Error).message)),
      },
    });
    load();
  };

  const closeOrder = (o: Order) => {
    Modal.confirm({
      title: '确认结清',
      content: `将「${o.title}」标记为已结清？`,
      onOk: async () => {
        try {
          await api.updateOrder(o.id, { status: 'closed' });
          toast.success('已标记结清');
          load();
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    });
  };

  const unpaid = (o: Order) => Math.max(0, (o.total_amount ?? 0) - (o.paid ?? 0));
  const sum = rows.reduce(
    (acc, o) => ({ total: acc.total + o.total_amount, paid: acc.paid + (o.paid ?? 0) }),
    { total: 0, paid: 0 },
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap size={12}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            新建订单
          </Button>
          <Select
            style={{ width: 140 }}
            allowClear
            placeholder="全部板块"
            value={filters.section_id}
            onChange={(v) => setFilters((f) => ({ ...f, section_id: v, item_id: undefined }))}
            options={sections.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Select
            style={{ width: 180 }}
            allowClear
            showSearch
            placeholder="全部项目"
            optionFilterProp="label"
            value={filters.item_id}
            onChange={(v) => setFilters((f) => ({ ...f, item_id: v }))}
            options={sections.flatMap((s) =>
              (s.items ?? []).map((it) => ({ value: it.id, label: `${s.name} / ${it.name}` })))}
          />
          <Select
            style={{ width: 120 }}
            allowClear
            placeholder="全部状态"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={[
              { value: 'open', label: '进行中' },
              { value: 'closed', label: '已结清' },
            ]}
          />
          <Input.Search
            style={{ width: 220 }}
            placeholder="搜订单 / 商家 / 项目"
            allowClear
            onSearch={(v) => setFilters((f) => ({ ...f, q: v }))}
          />
          <Button icon={<ReloadOutlined />} onClick={load} />
        </Space>
      </Card>

      <Table<Order>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        onRow={(r) => ({ onClick: () => nav(`/orders/${r.id}`), style: { cursor: 'pointer' } })}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 笔订单` }}
        scroll={{ x: 980 }}
        columns={[
          {
            title: '订单',
            dataIndex: 'title',
            render: (_, o) => (
              <div>
                <div style={{ fontWeight: 500 }}>{o.title}</div>
                {o.vendor && <div style={{ color: '#8c8c8c', fontSize: 12 }}>{o.vendor}</div>}
              </div>
            ),
          },
          {
            title: '预算项目',
            width: 200,
            render: (_, o) =>
              o.item_name ? (
                <Space size={4} wrap>
                  <span>{o.item_name}</span>
                  {o.section_name && <Tag bordered={false}>{o.section_name}</Tag>}
                </Space>
              ) : (
                <span style={{ color: '#bfbfbf' }}>未关联</span>
              ),
          },
          { title: '总额', dataIndex: 'total_amount', width: 110, align: 'right', render: (v) => fmtMoney(v) },
          { title: '已付', dataIndex: 'paid', width: 110, align: 'right', render: (v) => fmtMoney(v) },
          {
            title: '未付',
            width: 110,
            align: 'right',
            render: (_, o) => {
              const over = (o.paid ?? 0) > o.total_amount;
              return over ? (
                <span style={{ color: '#faad14' }}>已付超出</span>
              ) : (
                <span style={{ color: unpaid(o) > 0 ? undefined : '#52c41a' }}>{fmtMoney(unpaid(o))}</span>
              );
            },
          },
          {
            title: '付款进度',
            width: 170,
            render: (_, o) => {
              const paid = o.paid ?? 0;
              const pct = o.total_amount > 0 ? Math.min(100, (paid / o.total_amount) * 100) : 0;
              return (
                <Space size={8}>
                  <div style={{ flex: 1, minWidth: 80 }}>
                    <WoodProgress value={paid} budget={o.total_amount} size="sm" />
                  </div>
                  <span className="tabular" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{Math.round(pct)}%</span>
                </Space>
              );
            },
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (v: string, o) =>
              v === 'closed' ? (
                <Tag color="green">已结清</Tag>
              ) : (o.paid ?? 0) >= o.total_amount && o.total_amount > 0 ? (
                <Tag color="orange">建议结清</Tag>
              ) : (
                <Tag color="blue">进行中</Tag>
              ),
          },
          {
            title: '操作',
            width: 195,
            render: (_, o) => (
              <Space size={0} onClick={(e) => e.stopPropagation()}>
                <Button type="link" size="small" onClick={() => nav(`/orders/${o.id}`)}>详情</Button>
                {(o.receipt_count ?? 0) > 0 && (
                  <Button type="link" size="small" href={`/api/export/receipts?order_id=${o.id}`}>票据</Button>
                )}
                {o.status === 'open' && (o.paid ?? 0) >= o.total_amount && o.total_amount > 0 && (
                  <Button type="link" size="small" onClick={() => closeOrder(o)}>结清</Button>
                )}
                <Popconfirm
                  title="删除该订单？"
                  description="付款与票据会隐藏保留（8 秒内可撤销）"
                  okText="删除"
                  okType="danger"
                  onConfirm={() => doDeleteOrder(o)}
                >
                  <Button type="link" size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        summary={() =>
          rows.length ? (
            <Table.Summary.Row style={{ fontWeight: 600 }}>
              <Table.Summary.Cell index={0}>合计（{rows.length} 笔）</Table.Summary.Cell>
              <Table.Summary.Cell index={1} />
              <Table.Summary.Cell index={2} align="right">{fmtMoney(sum.total)}</Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">{fmtMoney(sum.paid)}</Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">{fmtMoney(Math.max(0, sum.total - sum.paid))}</Table.Summary.Cell>
              <Table.Summary.Cell index={5} colSpan={3} />
            </Table.Summary.Row>
          ) : null
        }
      />

      <OrderFormModal
        open={modalOpen}
        sections={sections}
        confirmLoading={saving}
        onOk={createOrder}
        onCancel={() => setModalOpen(false)}
      />
    </Space>
  );
}

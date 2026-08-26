import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Button, Card, Checkbox, Col, Dropdown, Empty, Form, Input, InputNumber,
  Modal, Row, Skeleton, Space, Table, Tag, Tooltip, Typography, Upload,
  type TableColumnsType,
} from 'antd';
import {
  DownloadOutlined, DownOutlined, EditOutlined, MoreOutlined, PlusOutlined,
  RightOutlined, UploadOutlined,
} from '@ant-design/icons';
import { toast } from 'sonner';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { api } from '../api';
import type { Item, Order, PlanData, Section } from '../api';
import { fmtMoney } from '../format';
import ItemFormModal from '../components/ItemFormModal';
import { EditableText, EditableNum, SortableRow, DragHandle, SectionDragHandle, SortableSectionCard } from '../components/plan/PlanEditing';
import BuyModal from '../components/BuyModal';
import QuickPayModal from '../components/QuickPayModal';
import WoodProgress from '../components/WoodProgress';
import AnimatedMoney from '../components/AnimatedMoney';

// ---------- 行内编辑单元格：失焦提交，成功闪光 / 失败回滚 ----------
export default function Plan() {
  const nav = useNavigate();
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  const [targetOpen, setTargetOpen] = useState(false);
  const [targetForm] = Form.useForm();

  const [sectionModalOpen, setSectionModalOpen] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [itemModal, setItemModal] = useState<{ sectionId: number } | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  // 购买登记弹窗 / 待付尾款行内付款弹窗
  const [buyTarget, setBuyTarget] = useState<Item | null>(null);
  const [buySaving, setBuySaving] = useState(false);
  const [payTarget, setPayTarget] = useState<Order | null>(null);

  // 清单搜索 / 板块折叠 / 待付尾款摘要展开
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    try { return new Set<number>(JSON.parse(localStorage.getItem('reno-collapsed') ?? '[]')); }
    catch { return new Set(); }
  });
  const [unpaid, setUnpaid] = useState<Order[]>([]);
  const [unpaidOpen, setUnpaidOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, orders] = await Promise.all([api.getPlan(), api.getOrders({ status: 'open' })]);
      setPlan(p);
      setUnpaid(orders.filter((o) => (o.paid ?? 0) < o.total_amount && o.total_amount > 0));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 局部更新：单元格保存后只替换该行并重算小计/总计，避免整表重渲染
  const patchItem = useCallback((item: Item) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const sections = prev.sections.map((sec) => {
        if (!sec.items || !sec.items.some((i) => i.id === item.id)) return sec;
        const items = sec.items.map((i) => (i.id === item.id ? item : i));
        return {
          ...sec,
          items,
          budget_subtotal: items.reduce((s, i) => s + i.budget_amount, 0),
          actual_subtotal: items.reduce((s, i) => s + i.actual_amount, 0),
        };
      });
      return {
        ...prev,
        sections,
        plan_total: sections.reduce((s, sec) => s + (sec.budget_subtotal ?? 0), 0),
        actual_total: sections.reduce((s, sec) => s + (sec.actual_subtotal ?? 0), 0),
      };
    });
  }, []);

  const saveItem = async (item: Item, patch: Record<string, unknown>): Promise<boolean> => {
    try {
      const updated = await api.updateItem(item.id, patch);
      patchItem(updated);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };

  const deleteItem = (item: Item) =>
    Modal.confirm({
      title: `删除项目「${item.name}」？`,
      content: item.order_count > 0
        ? `该项目下有 ${item.order_count} 个订单，删除后订单保留、其付款不再计入项目实际。`
        : '确定删除该清单项？',
      okType: 'danger',
      okText: '删除',
      onOk: async () => {
        try {
          await api.deleteItem(item.id);
        } catch (e) {
          toast.error((e as Error).message);
          return;
        }
        toast.success(`已删除「${item.name}」`, {
          duration: 8000,
          action: {
            label: '撤销',
            onClick: () => api.restoreItem(item.id).then(load).catch((e) => toast.error((e as Error).message)),
          },
        });
        load();
      },
    });

  // 勾「已买」→ 打开购买登记弹窗（确认成交价与日期；原价由后端存为预算基线）
  const confirmBuy = async (itemId: number, price: number, date: string) => {
    const item = buyTarget;
    if (item && !item.bought && item.order_paid > 0) {
      const proceed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '该项目已有订单付款，可能重复计入',
          content: `「${item.name}」下订单已付 ${fmtMoney(item.order_paid)}，再记为已买会把总价也计入实际。通常二选一即可，仍要记吗？`,
          okText: '仍要记',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!proceed) return;
    }
    setBuySaving(true);
    try {
      const updated = await api.updateItem(itemId, { bought: true, unit_price: price, bought_date: date });
      patchItem(updated);
      setBuyTarget(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBuySaving(false);
    }
  };

  const unmarkBought = async (itemId: number) => {
    setBuySaving(true);
    try {
      const updated = await api.updateItem(itemId, { bought: false });
      patchItem(updated);
      setBuyTarget(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBuySaving(false);
    }
  };

  const toggleCollapse = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // 持久化放 updater 之外：StrictMode 下 updater 会双执行
    setCollapsedAfterPersist();
  };
  const setCollapsedAfterPersist = () => {};

  // 板块拖拽排序
  const onSectionDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !plan) return;
    const oldIndex = plan.sections.findIndex((s) => s.id === active.id);
    const newIndex = plan.sections.findIndex((s) => s.id === over.id);
    const sections = arrayMove(plan.sections, oldIndex, newIndex);
    setPlan((prev) => (prev ? { ...prev, sections } : prev));
    try {
      await api.reorderSections(sections.map((s) => s.id));
    } catch (e) {
      toast.error((e as Error).message);
      load();
    }
  };

  // 项目拖拽排序（板块内）
  const onItemDragEnd = (section: Section) => async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !section.items) return;
    const oldIndex = section.items.findIndex((i) => i.id === active.id);
    const newIndex = section.items.findIndex((i) => i.id === over.id);
    const items = arrayMove(section.items, oldIndex, newIndex);
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map((s) =>
          s.id === section.id ? { ...s, items: [...items] } : s),
      };
    });
    try {
      await api.reorderItems(items.map((i) => i.id));
    } catch (e) {
      toast.error((e as Error).message);
      load();
    }
  };

  const deleteSection = (sec: Section) =>
    Modal.confirm({
      title: `删除板块「${sec.name}」？`,
      content: `板块下 ${(sec.items ?? []).length} 个项目会一并移出清单（订单与付款保留但不再计入统计）。删除后 8 秒内可撤销。`,
      okType: 'danger',
      okText: '删除',
      onOk: async () => {
        try {
          await api.deleteSection(sec.id);
          toast.success(`已删除板块「${sec.name}」`, {
            duration: 8000,
            action: {
              label: '撤销',
              onClick: () => api.restoreSection(sec.id).then(load).catch((e) => toast.error((e as Error).message)),
            },
          });
          load();
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    });

  const saveTarget = async (values: { total_budget: number }) => {
    try {
      await api.saveSettings(values.total_budget);
      toast.success('预算目标已保存');
      setTargetOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const doImport = async (file: File) => {
    Modal.confirm({
      title: '导入 Excel 将替换当前清单',
      content: '现有板块与项目会被清空后重建（订单与付款保留，但不再挂到项目上）。确定继续？',
      okText: '替换导入',
      okType: 'danger',
      onOk: async () => {
        try {
          const r = await api.importPlan(file, 'replace');
          toast.success(`导入成功：${r.sections} 个板块、${r.items} 个项目${r.target != null ? `，目标 ${fmtMoney(r.target)}` : ''}`);
          load();
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    });
    return false;
  };

  if (!plan) {
    return loading ? (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card><Skeleton active paragraph={{ rows: 1 }} /></Card>
        <Card><Skeleton active paragraph={{ rows: 7 }} title /></Card>
        <Card><Skeleton active paragraph={{ rows: 5 }} title /></Card>
      </Space>
    ) : (
      <Card>
        <Alert
          type="error"
          showIcon
          message="清单加载失败"
          description="可能是账本服务没有启动。请先启动服务（双击 启动.bat），然后重试。数据不会丢失。"
          action={<Button size="small" onClick={load}>重试</Button>}
        />
      </Card>
    );
  }

  const diff = plan!.plan_total - plan!.total_budget;
  const overBudget = plan!.total_budget > 0 && diff > 0;
  const allItems = plan!.sections.flatMap((s) => s.items ?? []);
  const bought = allItems.filter((i) => i.bought || i.actual_amount > 0).length;

  // 搜索过滤（名称/规格/备注；命中的板块保留，空的隐藏）
  const q = search.trim().toLowerCase();
  const searching = q.length > 0;
  const visibleSections = searching
    ? plan!.sections
        .map((sec) => ({
          ...sec,
          items: (sec.items ?? []).filter((it) =>
            it.name.toLowerCase().includes(q) ||
            it.spec.toLowerCase().includes(q) ||
            it.note.toLowerCase().includes(q)),
        }))
        .filter((sec) => (sec.items ?? []).length > 0)
    : plan!.sections;
  const totalUnpaid = unpaid.reduce((s, o) => s + Math.max(0, o.total_amount - (o.paid ?? 0)), 0);

  const itemColumns: TableColumnsType<Item> = [
    {
      title: '', key: 'drag', width: 32, align: 'center' as const, fixed: 'left' as const,
      className: 'no-print',
      onHeaderCell: () => ({ className: 'no-print' }),
      render: () => (searching ? null : <DragHandle />),
    },
    {
      title: '项目名称', dataIndex: 'name', width: 160, fixed: 'left' as const,
      render: (_, it: Item) => <EditableText value={it.name} onCommit={(v) => saveItem(it, { name: v })} placeholder="项目名" />,
    },
    {
      title: '规格 / 品牌', dataIndex: 'spec',
      render: (_, it: Item) => <EditableText value={it.spec} onCommit={(v) => saveItem(it, { spec: v })} placeholder="品牌型号" />,
    },
    {
      title: '单位', dataIndex: 'unit', width: 56,
      render: (_, it: Item) => <EditableText value={it.unit} onCommit={(v) => saveItem(it, { unit: v })} placeholder="项" />,
    },
    {
      title: '数量', dataIndex: 'quantity', width: 72, align: 'right' as const,
      render: (_, it: Item) => <EditableNum value={it.quantity} onCommit={(v) => saveItem(it, { quantity: v ?? 0 })} />,
    },
    {
      title: '单价', dataIndex: 'unit_price', width: 104, align: 'right' as const,
      render: (_, it: Item) => <EditableNum value={it.unit_price} onCommit={(v) => saveItem(it, { unit_price: v ?? 0 })} />,
    },
    {
      title: '总价', dataIndex: 'budget_amount', width: 110, align: 'right' as const,
      render: (v: number) => <Typography.Text strong className="tabular">{fmtMoney(v)}</Typography.Text>,
    },
    {
      title: '已买', dataIndex: 'bought', width: 56, align: 'center' as const,
      render: (_, it: Item) =>
        it.order_count > 0 ? (
          <Tooltip title="该项目通过订单记录付款，无需勾选">
            <Checkbox checked={!!it.bought} disabled />
          </Tooltip>
        ) : (
          <Checkbox
            checked={!!it.bought}
            onClick={(e) => e.stopPropagation()}
            onChange={() => setBuyTarget(it)}
          />
        ),
    },
    {
      title: '备注', dataIndex: 'note', width: 150, ellipsis: true,
      render: (_, it: Item) => <EditableText value={it.note} onCommit={(v) => saveItem(it, { note: v })} placeholder="" />,
    },
    {
      title: '操作', width: 96, className: 'no-print',
      onHeaderCell: () => ({ className: 'no-print' }),
      render: (_, it: Item) => (
        <Space size={0}>
          {it.order_count > 0
            ? <Button type="link" size="small" onClick={() => nav(`/orders?item_id=${it.id}`)}>{it.order_count} 订单</Button>
            : <Button type="link" size="small" style={{ color: 'var(--ink-3)' }} onClick={() => nav(`/orders?item_id=${it.id}&new=1`)}>+订单</Button>}
          <Button type="link" size="small" danger onClick={() => deleteItem(it)}>删</Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* ===== 主卡：预算健康 + 三小卡 ===== */}
      <Row gutter={16}>
        <Col xs={24} md={16}>
          <Card>
            <div className="label-caption" style={{ marginBottom: 4 }}>预算健康 · 清单总计</div>
            <AnimatedMoney value={plan!.plan_total} style={{ fontSize: 34, color: 'var(--ink)', display: 'block' }} />
            <div style={{ margin: '12px 0 8px' }}>
              <WoodProgress value={plan!.plan_total} budget={plan!.total_budget} size="lg" />
            </div>
            <Space size={6} style={{ marginTop: 4 }}>
              <span className="label-caption">目标 {fmtMoney(plan!.total_budget)}</span>
              {plan!.total_budget > 0 && (
                <span className="tabular" style={{ fontWeight: 600, color: overBudget ? 'var(--clay)' : 'var(--sage)' }}>
                  {overBudget ? `超支 ${fmtMoney(diff)}` : `结余 ${fmtMoney(-diff)}`}
                </span>
              )}
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => { targetForm.setFieldsValue({ total_budget: plan!.total_budget }); setTargetOpen(true); }}>
                改目标
              </Button>
            </Space>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card style={{ height: '100%' }}>
            <div className="label-caption">实际已花</div>
            <AnimatedMoney value={plan!.actual_total} style={{ fontSize: 22, display: 'block', marginTop: 8 }} />
            <div className="label-caption" style={{ marginTop: 8 }}>已买项总价 + 订单付款</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card style={{ height: '100%' }}>
            <div className="label-caption">已落实</div>
            <div className="num-display" style={{ fontSize: 22, marginTop: 8 }}>{bought} <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>/ {allItems.length} 项</span></div>
            <div style={{ marginTop: 8 }}><WoodProgress value={bought} budget={allItems.length} size="sm" /></div>
          </Card>
        </Col>
      </Row>

      {/* ===== 工具栏：左搜索 / 右动作组 ===== */}
      <Card size="small" className="no-print">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input.Search
            style={{ width: 220 }}
            placeholder="搜项目 / 品牌 / 备注"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
          <span className="label-caption" style={{ flex: 1, minWidth: 200 }}>
            点单元格直接编辑；悬停行首 ⠿ 可拖动排序
          </span>
          <Space wrap style={{ marginLeft: 'auto' }}>
            <Button type="primary" ghost icon={<PlusOutlined />} onClick={() => setSectionModalOpen(true)}>
              新增板块
            </Button>
            <Upload accept=".xlsx,.xlsm" showUploadList={false} beforeUpload={(f) => { doImport(f); return false; }}>
              <Button icon={<UploadOutlined />}>导入</Button>
            </Upload>
            <Button icon={<DownloadOutlined />} href="/api/export/excel">导出</Button>
          </Space>
        </div>
      </Card>

      {/* ===== 待付尾款：单行摘要，点开展开 ===== */}
      {unpaid.length > 0 && (
        <Card
          size="small"
          className="no-print"
          styles={{ body: { padding: '8px 16px', cursor: 'pointer' } }}
          onClick={() => setUnpaidOpen((v) => !v)}
          title={null}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tag color="error" style={{ marginRight: 2 }}>待付尾款</Tag>
            <span style={{ fontWeight: 600 }} className="tabular">{fmtMoney(totalUnpaid)}</span>
            <span className="label-caption">{unpaid.length} 笔未结清 · 点击{unpaidOpen ? '收起' : '展开'}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}>{unpaidOpen ? '▲' : '▼'}</span>
          </div>
          {unpaidOpen && (
            <div style={{ marginTop: 10, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
              <Table<Order>
                rowKey="id"
                size="small"
                dataSource={unpaid}
                pagination={false}
                onRow={(r) => ({ onClick: () => nav(`/orders/${r.id}`), style: { cursor: 'pointer' } })}
                columns={[
                  {
                    title: '订单', dataIndex: 'title',
                    render: (_, o) => (
                      <div>
                        <span style={{ fontWeight: 500 }}>{o.title}</span>
                        {o.vendor && <span style={{ color: 'var(--ink-2)', fontSize: 12, marginLeft: 6 }}>{o.vendor}</span>}
                      </div>
                    ),
                  },
                  { title: '预算项目', dataIndex: 'item_name', width: 180, render: (v) => v || <span style={{ color: 'var(--ink-3)' }}>未关联</span> },
                  { title: '总额', dataIndex: 'total_amount', width: 110, align: 'right' as const, render: (v: number) => <span className="tabular">{fmtMoney(v)}</span> },
                  { title: '已付', dataIndex: 'paid', width: 110, align: 'right' as const, render: (v: number) => <span className="tabular">{fmtMoney(v ?? 0)}</span> },
                  {
                    title: '未付', width: 110, align: 'right' as const,
                    render: (_, o) => <span className="tabular" style={{ fontWeight: 600, color: 'var(--clay)' }}>{fmtMoney(o.total_amount - (o.paid ?? 0))}</span>,
                  },
                  {
                    title: '', width: 90,
                    render: (_, o) => (
                      <Button type="link" size="small" onClick={() => setPayTarget(o)}>记一笔</Button>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </Card>
      )}

      {/* ===== 板块 → 项目清单（可拖拽） ===== */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
        <SortableContext items={searching ? [] : plan!.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {visibleSections.map((sec, idx) => (
              <SortableSectionCard key={sec.id} section={sec} index={idx}>
                <Card
                  size="small"
                  title={
                    <Space size={8}>
                      <Button
                        type="text" size="small"
                        icon={collapsed.has(sec.id) ? <RightOutlined /> : <DownOutlined />}
                        onClick={() => toggleCollapse(sec.id)}
                        style={{ marginLeft: -6 }}
                      />
                      {!searching && <SectionDragHandle />}
                      <Typography.Text
                        strong
                        editable={{
                          onChange: async (v) => {
                            if (v.trim() && v.trim() !== sec.name) {
                              try { await api.updateSection(sec.id, { name: v.trim() }); load(); }
                              catch (e) { toast.error((e as Error).message); }
                            }
                          },
                          tooltip: '点击修改板块名',
                        }}
                        style={{ fontSize: 15 }}
                      >
                        {sec.name}
                      </Typography.Text>
                    </Space>
                  }
                  extra={
                    <Space>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => setItemModal({ sectionId: sec.id })}>
                        添加项目
                      </Button>
                      <Dropdown
                        menu={{
                          items: [
                            { key: 'delete', label: '删除板块', danger: true },
                          ],
                          onClick: ({ key }) => { if (key === 'delete') deleteSection(sec); },
                        }}
                        trigger={['click']}
                      >
                        <Button type="text" size="small" icon={<MoreOutlined />} />
                      </Dropdown>
                    </Space>
                  }
                >
                  {!collapsed.has(sec.id) && (<>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <WoodProgress value={sec.actual_subtotal ?? 0} budget={sec.budget_subtotal ?? 0} size="sm" />
                    </div>
                    <span className="label-caption tabular" style={{ whiteSpace: 'nowrap' }}>
                      预算 {fmtMoney(sec.budget_subtotal ?? 0)} · 实际 {fmtMoney(sec.actual_subtotal ?? 0)}
                    </span>
                  </div>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd(sec)}>
                    <SortableContext items={(sec.items ?? []).map((i) => i.id)} strategy={verticalListSortingStrategy}>
                      <Table<Item>
                        rowKey="id"
                        size="small"
                        dataSource={sec.items ?? []}
                        rowClassName={(it) => (it.bought ? 'row-bought' : '')}
                        pagination={false}
                        scroll={{ x: 960 }}
                        components={{ body: { row: SortableRow } }}
                        locale={{ emptyText: '该板块还没有项目，点右上角「添加项目」开始' }}
                        columns={itemColumns}
                        summary={() => {
                          if (searching) return null;
                          const items = sec.items ?? [];
                          if (!items.length) return null;
                          const secBought = items.filter((i) => i.bought || i.actual_amount > 0).length;
                          return (
                            <Table.Summary.Row style={{ fontWeight: 600, background: 'var(--surface-2)' }}>
                              <Table.Summary.Cell index={0} colSpan={6}>小计（{items.length} 项，已落实 {secBought}）</Table.Summary.Cell>
                              <Table.Summary.Cell index={6} align="right">{fmtMoney(sec.budget_subtotal ?? 0)}</Table.Summary.Cell>
                              <Table.Summary.Cell index={7} colSpan={3} />
                            </Table.Summary.Row>
                          );
                        }}
                      />
                    </SortableContext>
                  </DndContext>
                  </>)}
                </Card>
              </SortableSectionCard>
            ))}
          </Space>
        </SortableContext>
      </DndContext>

      {searching && visibleSections.length === 0 && (
        <Card><Empty description={`没有找到与「${search}」匹配的项目`} style={{ padding: 32 }} /></Card>
      )}

      {plan!.unassigned_paid > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`有 ${fmtMoney(plan!.unassigned_paid)} 的订单付款未挂到任何预算项目，不计入清单实际合计。可在订单页把订单关联到项目。`}
          action={<Button size="small" onClick={() => nav('/orders')}>去订单</Button>}
        />
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        买完的小件：把单价改成成交价、勾上「已买」；分定金/尾款的大件用「订单」挂在项目下。退货退款在订单付款里记负数自动冲抵。统计图表见「分析」页。
      </Typography.Text>

      {/* 目标编辑弹窗 */}
      <Modal title="设置预算目标" open={targetOpen} onCancel={() => setTargetOpen(false)} onOk={() => targetForm.submit()} destroyOnClose>
        <Form form={targetForm} layout="vertical" onFinish={saveTarget}>
          <Form.Item name="total_budget" label="预算目标（元）" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="160000" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 新增板块弹窗 */}
      <Modal
        title="新增板块"
        open={sectionModalOpen}
        onCancel={() => { setSectionModalOpen(false); setSectionName(''); }}
        onOk={async () => {
          const name = sectionName.trim();
          if (!name) return;
          try {
            await api.addSection(name);
            toast.success('板块已添加');
            setSectionModalOpen(false);
            setSectionName('');
            load();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        okText="添加"
        destroyOnClose
      >
        <Input
          placeholder="如：封窗、全屋定制"
          value={sectionName}
          onChange={(e) => setSectionName(e.target.value)}
          onPressEnter={() => document.querySelector<HTMLButtonElement>('.ant-modal .ant-btn-primary')?.click()}
          maxLength={20}
        />
      </Modal>

      <ItemFormModal
        open={itemModal != null}
        confirmLoading={savingItem}
        onCancel={() => setItemModal(null)}
        onOk={async (values) => {
          if (!itemModal) return;
          setSavingItem(true);
          try {
            await api.addItem(itemModal.sectionId, values);
            toast.success('项目已添加');
            setItemModal(null);
            load();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setSavingItem(false);
          }
        }}
      />

      {/* 购买登记：勾「已买」时确认成交价与日期 */}
      <BuyModal
        item={buyTarget}
        open={!!buyTarget}
        onClose={() => setBuyTarget(null)}
        onConfirm={confirmBuy}
        onUnmark={unmarkBought}
        confirmLoading={buySaving}
      />

      <QuickPayModal order={payTarget} onClose={() => setPayTarget(null)} onDone={load} />
    </Space>
  );
}

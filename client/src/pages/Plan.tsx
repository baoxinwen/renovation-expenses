import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Button, Card, Checkbox, Col, Form, Input, InputNumber, Modal, Popconfirm, Row,
  Space, Table, Tag, Typography, Upload, type TableColumnsType,
} from 'antd';
import {
  DownloadOutlined, EditOutlined, HolderOutlined, PlusOutlined, UploadOutlined,
} from '@ant-design/icons';
import { toast } from 'sonner';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api';
import type { Item, PlanData, Section } from '../api';
import { fmtMoney } from '../format';
import ItemFormModal from '../components/ItemFormModal';
import WoodProgress from '../components/WoodProgress';
import AnimatedMoney from '../components/AnimatedMoney';

// ---------- 行内编辑单元格：失焦提交，成功后背景闪光 ----------
function EditableText({ value, onCommit, placeholder }: {
  value: string; onCommit: (v: string) => Promise<boolean>; placeholder?: string;
}) {
  const [flash, setFlash] = useState(false);
  return (
    <div className={`editable-cell ${flash ? 'flash-saved' : ''}`}>
      <Input
        key={value}
        size="small"
        variant="borderless"
        defaultValue={value}
        placeholder={placeholder}
        onClick={(e) => e.stopPropagation()}
        onBlur={async (e) => {
          const v = e.target.value.trim();
          if (v === value) return;
          if (await onCommit(v)) {
            setFlash(true);
            setTimeout(() => setFlash(false), 650);
          }
        }}
      />
    </div>
  );
}

function EditableNum({ value, onCommit, nullable }: {
  value: number | null; onCommit: (v: number | null) => Promise<boolean>; nullable?: boolean;
}) {
  const [flash, setFlash] = useState(false);
  return (
    <div className={`editable-cell num ${flash ? 'flash-saved' : ''}`}>
      <InputNumber
        key={String(value)}
        size="small"
        variant="borderless"
        defaultValue={value ?? undefined}
        min={0}
        style={{ width: '100%' }}
        onClick={(e) => e.stopPropagation()}
        onBlur={async (e) => {
          const raw = e.target.value.trim().replace(/,/g, '');
          let next: number | null;
          if (raw === '') next = nullable ? null : 0;
          else {
            const n = Number(raw);
            if (!Number.isFinite(n)) return;
            next = n;
          }
          if (next === value) return;
          if (await onCommit(next)) {
            setFlash(true);
            setTimeout(() => setFlash(false), 650);
          }
        }}
      />
    </div>
  );
}

// ---------- dnd-kit：项目行拖拽（拖手柄列） ----------
const RowListenersContext = createContext<{ listeners?: Record<string, Function> }>({});

function SortableRow(props: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: number }) {
  const id = props['data-row-key'];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: id! });
  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 2, background: 'var(--surface)', boxShadow: 'var(--shadow-card)' } : {}),
  };
  return (
    <RowListenersContext.Provider value={{ listeners }}>
      <tr {...props} ref={setNodeRef} {...attributes} style={style} />
    </RowListenersContext.Provider>
  );
}

function DragHandle() {
  const { listeners } = useContext(RowListenersContext);
  return <HolderOutlined className="drag-handle" {...listeners} />;
}

// ---------- dnd-kit：板块卡片拖拽 ----------
const SectionHandleContext = createContext<{ listeners?: Record<string, Function> }>({});

function SectionDragHandle() {
  const { listeners } = useContext(SectionHandleContext);
  return <HolderOutlined className="drag-handle" {...listeners} />;
}

function SortableSectionCard({ section, index, children }: {
  section: Section; index: number; children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  return (
    <SectionHandleContext.Provider value={{ listeners }}>
      <div
        ref={setNodeRef}
        {...attributes}
        className="rise-in"
        style={{
          animationDelay: `${Math.min(index, 6) * 40}ms`,
          transform: CSS.Transform.toString(transform),
          transition,
          ...(isDragging ? { position: 'relative', zIndex: 3, opacity: 0.9 } : {}),
        }}
      >
        {children}
      </div>
    </SectionHandleContext.Provider>
  );
}

export default function Plan() {
  const nav = useNavigate();
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  const [newSection, setNewSection] = useState('');
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetForm] = Form.useForm();

  const [itemModal, setItemModal] = useState<{ sectionId: number } | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlan(await api.getPlan());
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
        await api.deleteItem(item.id);
        toast.success('已删除');
        load();
      },
    });

  // 板块拖拽排序
  const onSectionDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !plan) return;
    const oldIndex = plan.sections.findIndex((s) => s.id === active.id);
    const newIndex = plan.sections.findIndex((s) => s.id === over.id);
    const sections = arrayMove(plan.sections, oldIndex, newIndex);
    setPlan({ ...plan, sections });
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
      content: `板块下 ${(sec.items ?? []).length} 个项目将一并删除；项目下订单的付款保留但不再计入清单统计。`,
      okType: 'danger',
      okText: '删除',
      onOk: async () => {
        await api.deleteSection(sec.id);
        toast.success('已删除板块');
        load();
      },
    });

  const saveTarget = async (values: { total_budget: number }) => {
    await api.saveSettings(values.total_budget);
    toast.success('预算目标已保存');
    setTargetOpen(false);
    load();
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

  if (loading && !plan) return <Card style={{ textAlign: 'center', padding: 80 }}>加载中…</Card>;

  const diff = plan!.plan_total - plan!.total_budget;
  const overBudget = plan!.total_budget > 0 && diff > 0;
  const allItems = plan!.sections.flatMap((s) => s.items ?? []);
  const bought = allItems.filter((i) => i.bought || i.actual_amount > 0).length;

  const itemColumns: TableColumnsType<Item> = [
    {
      title: '', key: 'drag', width: 32, align: 'center' as const,
      render: () => <DragHandle />,
    },
    {
      title: '项目名称', dataIndex: 'name', width: 160,
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
      render: (_, it: Item) => (
        <Checkbox
          checked={!!it.bought}
          onClick={(e) => e.stopPropagation()}
          onChange={async (e) => {
            const updated = await api.updateItem(it.id, { bought: e.target.checked }).catch((err) => {
              toast.error((err as Error).message);
              return null;
            });
            if (updated) patchItem(updated);
          }}
        />
      ),
    },
    {
      title: '备注', dataIndex: 'note', width: 150, ellipsis: true,
      render: (_, it: Item) => <EditableText value={it.note} onCommit={(v) => saveItem(it, { note: v })} placeholder="" />,
    },
    {
      title: '操作', width: 96,
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
      {overBudget && (
        <Alert
          type="error"
          showIcon
          message={`清单总计已超预算目标：目标 ${fmtMoney(plan!.total_budget)}，清单 ${fmtMoney(plan!.plan_total)}，超出 ${fmtMoney(diff)}`}
        />
      )}
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

      {/* ===== 工具栏 ===== */}
      <Card size="small">
        <Space wrap>
          <Input.Search
            style={{ width: 200 }}
            placeholder="新增板块名称"
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            enterButton={<PlusOutlined />}
            onSearch={async (v) => {
              const name = v.trim();
              if (!name) return;
              try {
                await api.addSection(name);
                setNewSection('');
                toast.success('板块已添加');
                load();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          />
          <Upload accept=".xlsx" showUploadList={false} beforeUpload={(f) => { doImport(f); return false; }}>
            <Button icon={<UploadOutlined />}>从 Excel 导入</Button>
          </Upload>
          <Button icon={<DownloadOutlined />} href="/api/export/excel">导出 Excel</Button>
          <span className="label-caption">点击单元格直接编辑，失焦保存；⠿ 拖动行或板块排序</span>
        </Space>
      </Card>

      {/* ===== 板块 → 项目清单（可拖拽） ===== */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
        <SortableContext items={plan!.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {plan!.sections.map((sec, idx) => (
              <SortableSectionCard key={sec.id} section={sec} index={idx}>
                <Card
                  size="small"
                  title={
                    <Space size={10}>
                      <SectionDragHandle />
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
                      <Tag className="tabular">预算 {fmtMoney(sec.budget_subtotal)}</Tag>
                      <Tag color="green" className="tabular">实际 {fmtMoney(sec.actual_subtotal)}</Tag>
                    </Space>
                  }
                  extra={
                    <Space>
                      <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setItemModal({ sectionId: sec.id })}>
                        添加项目
                      </Button>
                      <Popconfirm title={`删除板块「${sec.name}」？`} description="板块下项目将一并删除" okText="删除" okType="danger" onConfirm={() => deleteSection(sec)}>
                        <Button type="text" size="small" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  }
                >
                  <div style={{ marginBottom: 10 }}>
                    <WoodProgress value={sec.actual_subtotal ?? 0} budget={sec.budget_subtotal ?? 0} size="sm" />
                  </div>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd(sec)}>
                    <SortableContext items={(sec.items ?? []).map((i) => i.id)} strategy={verticalListSortingStrategy}>
                      <Table<Item>
                        rowKey="id"
                        size="small"
                        dataSource={sec.items ?? []}
                        pagination={false}
                        scroll={{ x: 960 }}
                        components={{ body: { row: SortableRow } }}
                        locale={{ emptyText: '该板块还没有项目，点右上角「添加项目」开始' }}
                        columns={itemColumns}
                        summary={() => {
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
                </Card>
              </SortableSectionCard>
            ))}
          </Space>
        </SortableContext>
      </DndContext>

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
    </Space>
  );
}

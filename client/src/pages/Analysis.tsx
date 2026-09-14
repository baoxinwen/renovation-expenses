import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, Row, Skeleton, Space, Table, Tag, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import { toast } from 'sonner';
import { api } from '../api';
import type { Charts, Summary } from '../api';
import { fmtMoney } from '../format';

// 图表 Y 轴万元缩写（两处共用）
const fmtAxisWan = (v: number) => (v >= 10000 ? v / 10000 + '万' : String(v));
import { useThemeModeCtx } from '../App';
import { chartThemeName, chartColors } from '../utils/echartsTheme';
import AnimatedMoney from '../components/AnimatedMoney';

export default function Analysis() {
  const nav = useNavigate();
  const { isDark } = useThemeModeCtx();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [charts, setCharts] = useState<Charts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.getSummary(), api.getCharts()])
      .then(([s, c]) => { setSummary(s); setCharts(c); })
      .catch((e) => {
        setError((e as Error).message || '加载失败');
        toast.error('统计数据加载失败');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);


  // TOP10 拆分：前 5 详画，其余合并为「其他」，避免长尾压扁
  const chartable = useMemo(() => {
    const items = charts?.top_items ?? [];
    if (items.length <= 5) return items;
    const rest = items.slice(5);
    return [
      ...items.slice(0, 5),
      {
        id: -1,
        name: `其他 ${rest.length} 项`,
        budget: rest.reduce((n, i) => n + i.budget, 0),
        actual: rest.reduce((n, i) => n + i.actual, 0),
      },
    ];
  }, [charts]);

  const themeName = useMemo(() => chartThemeName(isDark), [isDark]);
  // paletteFor 每次渲染返回新对象，包 useMemo 才不会让下方 options 记忆化失效
  const colors = useMemo(() => chartColors(isDark), [isDark]);

  const monthOption = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtMoney(v) },
    grid: { left: 70, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: (charts?.by_month ?? []).map((m) => m.month) },
    yAxis: { type: 'value', axisLabel: { formatter: fmtAxisWan } },
    series: [{
      type: 'bar',
      data: (charts?.by_month ?? []).map((m) => m.amount),
      barMaxWidth: 42,
      itemStyle: { color: colors.actual, borderRadius: [4, 4, 0, 0] },
    }],
  }), [charts, colors]);

  const topOption = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtMoney(v) },
    legend: { top: 0 },
    grid: { left: 110, right: 40, top: 36, bottom: 30 },
    xAxis: { type: 'value', axisLabel: { formatter: fmtAxisWan } },
    yAxis: { type: 'category', inverse: true, data: chartable.map((i) => i.name) },
    series: [
      { name: '预算', type: 'bar', data: chartable.map((i) => i.budget), barMaxWidth: 14, itemStyle: { color: colors.budget, borderRadius: [0, 4, 4, 0] } },
      { name: '实际', type: 'bar', data: chartable.map((i) => i.actual), barMaxWidth: 14, itemStyle: { color: colors.actual, borderRadius: [0, 4, 4, 0] } },
    ],
  }), [chartable, colors]);

  // 错误/加载早退必须位于全部 useMemo 之后（React 不允许条件分支改变 hook 数量）
  if (error) {
    return (
      <Card>
        <Alert
          type="error"
          showIcon
          message="统计数据加载失败"
          description={`${error}。可能是账本服务没有启动——数据没有丢失，启动后重试即可。`}
          action={<Button size="small" onClick={load}>重试</Button>}
        />
      </Card>
    );
  }

  if (loading) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card><Skeleton active paragraph={{ rows: 1 }} /></Card>
        <Card><Skeleton active paragraph={{ rows: 6 }} title /></Card>
        <Card><Skeleton active paragraph={{ rows: 4 }} title /></Card>
      </Space>
    );
  }

  const diff = summary ? summary.plan_total - summary.total_budget : 0;


  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col xs={12} md={6}>
          <Card size="small">
            <div className="label-caption">预算目标</div>
            <AnimatedMoney value={summary?.total_budget ?? 0} style={{ fontSize: 22, display: 'block', marginTop: 8 }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <div className="label-caption">清单总计</div>
            <AnimatedMoney value={summary?.plan_total ?? 0} style={{ fontSize: 22, display: 'block', marginTop: 8 }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <div className="label-caption">超支 / 结余</div>
            <AnimatedMoney
              value={diff}
              style={{ fontSize: 22, display: 'block', marginTop: 8, color: diff > 0 ? 'var(--clay)' : 'var(--sage)' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <div className="label-caption">实际已花</div>
            <AnimatedMoney value={summary?.actual_total ?? 0} style={{ fontSize: 22, display: 'block', marginTop: 8 }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} lg={13}>
          <Card title="板块汇总：预算 vs 实际" size="small">
            <Table
              rowKey="id"
              size="small"
              dataSource={summary?.sections ?? []}
              pagination={false}
              columns={[
                { title: '板块', dataIndex: 'name', render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
                { title: '项目数', dataIndex: 'item_count', width: 60, align: 'right' },
                { title: '已落实', dataIndex: 'bought_count', width: 60, align: 'right' },
                { title: '预算小计', dataIndex: 'budget_subtotal', width: 110, align: 'right', render: (v: number) => <span className="tabular">{fmtMoney(v)}</span> },
                { title: '实际小计', dataIndex: 'actual_subtotal', width: 110, align: 'right', render: (v: number) => <span className="tabular">{fmtMoney(v)}</span> },
                {
                  title: '执行率', width: 90, align: 'right',
                  render: (_, s: Summary['sections'][number]) => {
                    if (!s.budget_subtotal) return <span style={{ color: 'var(--ink-3)' }}>—</span>;
                    const pct = s.actual_subtotal / s.budget_subtotal;
                    // 0% = 还没开始，中性灰；>=90% 预警橙；>100% 超支红
                    const color = pct === 0 ? undefined : pct > 1 ? 'error' : pct >= 0.9 ? 'warning' : 'success';
                    return <Tag color={color}>{Math.round(pct * 100)}%</Tag>;
                  },
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={11}>
          <Card title="月度付款趋势（含已买支出）" size="small">
            {charts?.by_month?.length
              ? <ReactECharts option={monthOption} theme={themeName} notMerge style={{ height: 300 }} />
              : <Empty description="还没有付款记录——到订单页记第一笔定金" style={{ padding: 32 }} />}
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} lg={13}>
          <Card title="花费 TOP10 项目（按预算）" size="small" styles={{ body: { paddingBottom: 0 } }}>
            {chartable.length
              ? <ReactECharts option={topOption} theme={themeName} notMerge style={{ height: 320 }} />
              : <Empty description="清单还没有项目" style={{ padding: 32 }} />}
          </Card>
        </Col>
        <Col xs={24} lg={11}>
          <Card title="项目排行" size="small" styles={{ body: { paddingTop: 8 } }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={charts?.top_items ?? []}
              pagination={false}
              onRow={(r) => ({ onClick: () => nav(`/orders?item_id=${r.id}`), style: { cursor: 'pointer' } })}
              columns={[
                { title: '项目', dataIndex: 'name', ellipsis: true },
                {
                  title: '预算/实际', key: 'ba', width: 150, align: 'right',
                  render: (_, it) => (
                    <span className="tabular" style={{ fontSize: 12 }}>
                      {fmtMoney(it.budget)}
                      <span style={{ color: 'var(--ink-3)', margin: '0 3px' }}>/</span>
                      <span style={{ color: it.actual > 0 ? 'var(--wood-600)' : 'var(--ink-3)', fontWeight: 600 }}>{fmtMoney(it.actual)}</span>
                    </span>
                  ),
                },
                {
                  title: '差', width: 70, align: 'right',
                  render: (_, it) => {
                    const d = it.actual - it.budget;
                    // 无支出或无预算基线（budget=0）时百分比无意义，不渲染 +Infinity%
                    if (it.actual === 0 || it.budget === 0) return <span style={{ color: 'var(--ink-3)' }}>—</span>;
                    return <span className="tabular" style={{ color: d > 0 ? 'var(--clay)' : 'var(--sage)' }}>{d > 0 ? '+' : ''}{Math.round((d / it.budget) * 100)}%</span>;
                  },
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近付款" size="small">
        <Table
          rowKey="id"
          size="small"
          dataSource={charts?.recent_payments ?? []}
          pagination={false}
          locale={{ emptyText: <Empty description="还没有付款记录——到订单页记第一笔定金" style={{ padding: 24 }} /> }}
          onRow={(r) => ({ onClick: () => nav(`/orders/${r.order_id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: '日期', dataIndex: 'pay_date', width: 100 },
            { title: '订单', dataIndex: 'order_title' },
            { title: '项目', dataIndex: 'item_name', width: 130, render: (v) => v || '—' },
            { title: '板块', dataIndex: 'section_name', width: 110, render: (v) => (v ? <Tag bordered={false}>{v}</Tag> : '—') },
            {
              title: '金额', dataIndex: 'amount', width: 110, align: 'right',
              render: (v: number) => <span className="tabular" style={{ fontWeight: 600, color: v < 0 ? 'var(--sage)' : undefined }}>{fmtMoney(v)}</span>,
            },
            { title: '方式', dataIndex: 'method', width: 80, render: (v: string) => v || '—' },
            { title: '备注', dataIndex: 'note', ellipsis: true, render: (v: string) => v || '—' },
          ]}
        />
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        图表颜色与全站一致：浅木 = 预算，深木 = 实际；陶土 = 超支，鼠尾草 = 结余。
      </Typography.Text>
    </Space>
  );
}

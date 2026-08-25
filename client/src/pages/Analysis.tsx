import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Empty, Row, Space, Table, Tag, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../api';
import type { Charts, Summary } from '../api';
import { fmtMoney } from '../format';
import { useThemeModeCtx } from '../App';
import { chartThemeName, chartColors } from '../utils/echartsTheme';
import AnimatedMoney from '../components/AnimatedMoney';

export default function Analysis() {
  const nav = useNavigate();
  const { isDark } = useThemeModeCtx();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [charts, setCharts] = useState<Charts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getSummary(), api.getCharts()])
      .then(([s, c]) => { setSummary(s); setCharts(c); })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const themeName = useMemo(() => chartThemeName(isDark), [isDark]);
  const colors = chartColors(isDark);

  const sectionOption = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtMoney(v) },
    legend: { top: 0 },
    grid: { left: 80, right: 30, top: 36, bottom: 30 },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => (v >= 10000 ? v / 10000 + '万' : v) } },
    yAxis: { type: 'category', inverse: true, data: (charts?.by_section ?? []).map((s) => s.name) },
    series: [
      { name: '预算', type: 'bar', data: (charts?.by_section ?? []).map((s) => s.budget), barMaxWidth: 16, itemStyle: { color: colors.budget, borderRadius: [0, 4, 4, 0] } },
      { name: '实际', type: 'bar', data: (charts?.by_section ?? []).map((s) => s.actual), barMaxWidth: 16, itemStyle: { color: colors.actual, borderRadius: [0, 4, 4, 0] } },
    ],
  }), [charts, colors]);

  const monthOption = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmtMoney(v) },
    grid: { left: 70, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: (charts?.by_month ?? []).map((m) => m.month) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => (v >= 10000 ? v / 10000 + '万' : v) } },
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
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => (v >= 10000 ? v / 10000 + '万' : v) } },
    yAxis: { type: 'category', inverse: true, data: (charts?.top_items ?? []).map((i) => i.name) },
    series: [
      { name: '预算', type: 'bar', data: (charts?.top_items ?? []).map((i) => i.budget), barMaxWidth: 14, itemStyle: { color: colors.budget, borderRadius: [0, 4, 4, 0] } },
      { name: '实际', type: 'bar', data: (charts?.top_items ?? []).map((i) => i.actual), barMaxWidth: 14, itemStyle: { color: colors.actual, borderRadius: [0, 4, 4, 0] } },
    ],
  }), [charts, colors]);

  if (loading) return <Card style={{ textAlign: 'center', padding: 80 }}>加载中…</Card>;

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

      <Card title="板块汇总：预算 vs 实际" size="small">
        <Table
          rowKey="id"
          size="small"
          dataSource={summary?.sections ?? []}
          pagination={false}
          columns={[
            { title: '板块', dataIndex: 'name' },
            { title: '项目数', dataIndex: 'item_count', width: 80, align: 'right' },
            { title: '已落实', dataIndex: 'bought_count', width: 80, align: 'right' },
            { title: '预算小计', dataIndex: 'budget_subtotal', width: 130, align: 'right', render: (v: number) => <span className="tabular">{fmtMoney(v)}</span> },
            { title: '实际小计', dataIndex: 'actual_subtotal', width: 130, align: 'right', render: (v: number) => <span className="tabular">{fmtMoney(v)}</span> },
            {
              title: '执行率', width: 110, align: 'right',
              render: (_, s: Summary['sections'][number]) => {
                if (!s.budget_subtotal) return <span style={{ color: 'var(--ink-3)' }}>—</span>;
                const pct = s.actual_subtotal / s.budget_subtotal;
                return <Tag color={pct > 1 ? 'error' : pct >= 0.9 ? 'warning' : 'success'}>{Math.round(pct * 100)}%</Tag>;
              },
            },
          ]}
        />
      </Card>

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card title="板块预算 vs 实际" size="small">
            {charts?.by_section?.length
              ? <ReactECharts option={sectionOption} theme={themeName} notMerge style={{ height: 260 }} />
              : <Empty description="清单还没有项目，去预算清单页添加或导入" style={{ padding: 32 }} />}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="月度付款趋势" size="small">
            {charts?.by_month?.length
              ? <ReactECharts option={monthOption} theme={themeName} notMerge style={{ height: 260 }} />
              : <Empty description="还没有付款记录——到订单页记第一笔定金" style={{ padding: 32 }} />}
          </Card>
        </Col>
      </Row>

      <Card title="花费 TOP10 项目（按预算）" size="small">
        {charts?.top_items?.length
          ? <ReactECharts option={topOption} theme={themeName} notMerge style={{ height: 360 }} />
          : <Empty description="清单还没有项目" style={{ padding: 32 }} />}
      </Card>

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

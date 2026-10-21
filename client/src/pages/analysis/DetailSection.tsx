import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Empty, Row, Table, Tag } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { Charts } from '../../api';
import { fmtMoney } from '../../format';
import { fmtAxisWan, useChartTheme } from './shared';

// 明细区：TOP10 条形图 + 项目排行表 + 最近付款（自原 Analysis 迁入，口径与交互不变）
export default function DetailSection({ charts }: { charts: Charts | null }) {
  const nav = useNavigate();
  const { themeName, colors } = useChartTheme();

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

  return (
    <>
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
    </>
  );
}

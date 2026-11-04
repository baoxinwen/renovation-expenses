import { useNavigate } from 'react-router-dom';
import { Card, Col, Empty, Row, Space, Table, Tag } from 'antd';
import type { Charts } from '../../api';
import { fmtMoney } from '../../format';
import { useIsMobile } from '../../hooks/useIsMobile';
import TypeReveal from '../../components/TypeReveal';

// 明细区：项目排行表 + 最近付款。TOP10 条形图已移除——与排行表同读 top_items，
// 同数据同指标双形态并排中图是纯装饰，差额/下钻等信息由表格严格更多。
// 根用 Space 而非 fragment：容器 Space 只把本组件当一个子项，fragment 内部拿不到页面级间距
export default function DetailSection({ charts }: { charts: Charts | null }) {
  const nav = useNavigate();
  const isMobile = useIsMobile();

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} lg={13}>
          <Card title={<TypeReveal text="项目排行（按预算 TOP10）" />} size="small" style={{ height: '100%' }} styles={{ body: { paddingTop: 8 } }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={charts?.top_items ?? []}
              pagination={false}
              scroll={{ x: 256 }}
              onRow={(r) => ({ onClick: () => nav(`/orders?item_id=${r.id}`), style: { cursor: 'pointer' } })}
              columns={isMobile ? [
                // 移动端固定布局三列 256px（<334px 可视宽度）：项目名截断、预算/
                // 实际上下两行小字——横排一行放不下会把数值列顶出卡片边框
                { title: '项目', dataIndex: 'name', width: 90, ellipsis: true },
                {
                  title: '预算 / 实际', key: 'ba', width: 110, align: 'right',
                  render: (_, it) => (
                    <div className="tabular" style={{ fontSize: 11, lineHeight: 1.4 }}>
                      <div>预算 {fmtMoney(it.budget)}</div>
                      <div style={{ color: it.actual > 0 ? 'var(--wood-600)' : 'var(--ink-3)', fontWeight: 600 }}>实际 {fmtMoney(it.actual)}</div>
                    </div>
                  ),
                },
                {
                  title: '差', width: 56, align: 'right',
                  render: (_, it) => {
                    const d = it.actual - it.budget;
                    if (it.actual === 0 || it.budget === 0) return <span style={{ color: 'var(--ink-3)' }}>—</span>;
                    return <span className="tabular" style={{ color: d > 0 ? 'var(--clay)' : 'var(--sage)' }}>{d > 0 ? '+' : ''}{Math.round((d / it.budget) * 100)}%</span>;
                  },
                },
              ] : [
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
        <Col xs={24} lg={11}>
          <Card title={<TypeReveal text="最近付款" />} size="small" style={{ height: '100%' }} styles={{ body: { paddingTop: 8 } }}>
            <Table
              rowKey="id"
              size="small"
              dataSource={charts?.recent_payments ?? []}
              pagination={false}
              scroll={isMobile ? { x: 270 } : { x: 760 }}
              locale={{ emptyText: <Empty description="还没有付款记录——到订单页记第一笔定金" style={{ padding: 24 }} /> }}
              onRow={(r) => ({ onClick: () => nav(`/orders/${r.order_id}`), style: { cursor: 'pointer' } })}
              columns={isMobile ? [
                // 移动端精简为三列（项目/板块/方式/备注在订单详情可查），一屏全见
                { title: '日期', dataIndex: 'pay_date', width: 88 },
                { title: '订单', dataIndex: 'order_title', ellipsis: true },
                {
                  title: '金额', dataIndex: 'amount', width: 92, align: 'right',
                  render: (v: number) => <span className="tabular" style={{ fontWeight: 600, color: v < 0 ? 'var(--sage)' : undefined }}>{fmtMoney(v)}</span>,
                },
              ] : [
                { title: '日期', dataIndex: 'pay_date', width: 100 },
                { title: '订单', dataIndex: 'order_title', ellipsis: true },
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
        </Col>
      </Row>
    </Space>
  );
}

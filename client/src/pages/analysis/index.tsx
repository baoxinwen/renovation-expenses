import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Row, Skeleton, Space, Table, Tag } from 'antd';
import { toast } from 'sonner';
import { api } from '../../api';
import type { Charts, PlanData, Summary } from '../../api';
import { fmtMoney } from '../../format';
import TypeReveal from '../../components/TypeReveal';
import OverviewCards from './OverviewCards';
import GapCard from './GapCard';
import SectionCompareChart from './SectionCompareChart';
import SectionPieChart from './SectionPieChart';
import ExecutionRankChart from './ExecutionRankChart';
import CumulativeChart from './CumulativeChart';
import SpendHeatmap from './SpendHeatmap';
import MonthlyChart from './MonthlyChart';
import DetailSection from './DetailSection';

// 分析页容器：一次拉取三份数据以 props 分发，组件不自行请求（spec 第 5 章数据流；
// getPlan 供 E 项目级排行取全量 items 的 budget_amount/actual_amount）
// 页面四分区：总览 → 板块 → 时间 → 明细（spec 第 5 章模块划分）
export default function Analysis() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [charts, setCharts] = useState<Charts | null>(null);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.getSummary(), api.getCharts(), api.getPlan()])
      .then(([s, c, p]) => { setSummary(s); setCharts(c); setPlan(p); })
      .catch((e) => {
        setError((e as Error).message || '加载失败');
        toast.error('统计数据加载失败');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // 错误/加载早退必须位于全部 hook 之后（React 不允许条件分支改变 hook 数量）
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* ===== 总览区 ===== */}
      <OverviewCards summary={summary} />
      <GapCard summary={summary} />

      {/* ===== 板块区 ===== */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={13}>
          <SectionCompareChart charts={charts} />
        </Col>
        <Col xs={24} lg={11}>
          <SectionPieChart charts={charts} />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card title={<TypeReveal text="板块汇总：预算 vs 实际" />} size="small">
            <Table
              rowKey="id"
              size="small"
              dataSource={summary?.sections ?? []}
              pagination={false}
              scroll={{ x: 600 }}
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
      </Row>
      {/* ExecutionRankChart（spec E，项目级执行率） */}
      <ExecutionRankChart plan={plan} />

      {/* ===== 时间区 ===== */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={13}>
          <CumulativeChart charts={charts} totalBudget={summary?.total_budget ?? 0} />
        </Col>
        <Col xs={24} lg={11}>
          <MonthlyChart charts={charts} />
        </Col>
      </Row>
      {/* SpendHeatmap（spec J，数据源 by_day） */}
      <SpendHeatmap charts={charts} />

      {/* ===== 明细区 ===== */}
      <DetailSection charts={charts} />
    </Space>
  );
}

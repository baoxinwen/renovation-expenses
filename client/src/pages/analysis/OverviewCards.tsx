import { Card, Col, Row } from 'antd';
import type { Summary } from '../../api';
import AnimatedMoney from '../../components/AnimatedMoney';

// 总览区第一行：预算目标 / 清单总计 / 超支结余 / 实际已花（自原 Analysis 迁入，口径与展示不变）
export default function OverviewCards({ summary }: { summary: Summary | null }) {
  const diff = summary ? summary.plan_total - summary.total_budget : 0;

  return (
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
  );
}

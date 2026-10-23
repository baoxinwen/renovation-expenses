import { Card, Col, Row } from 'antd';
import type { Summary } from '../../api';
import AnimatedMoney from '../../components/AnimatedMoney';
import TypeReveal from '../../components/TypeReveal';

// 总览区第一行：预算目标 / 清单总计 / 超支结余 / 实际已花（自原 Analysis 迁入，口径与展示不变；
// 标签走流式打字铁律 4，数字保留滚动动效 + tabular 防抖）
export default function OverviewCards({ summary }: { summary: Summary | null }) {
  const diff = summary ? summary.plan_total - summary.total_budget : 0;

  const cards: { label: string; node: React.ReactNode }[] = [
    { label: '预算目标', node: <AnimatedMoney value={summary?.total_budget ?? 0} style={{ fontSize: 22, display: 'block', marginTop: 8 }} /> },
    { label: '清单总计', node: <AnimatedMoney value={summary?.plan_total ?? 0} style={{ fontSize: 22, display: 'block', marginTop: 8 }} /> },
    {
      label: '超支 / 结余',
      node: (
        <AnimatedMoney
          value={diff}
          style={{ fontSize: 22, display: 'block', marginTop: 8, color: diff > 0 ? 'var(--clay)' : 'var(--sage)' }}
        />
      ),
    },
    { label: '实际已花', node: <AnimatedMoney value={summary?.actual_total ?? 0} style={{ fontSize: 22, display: 'block', marginTop: 8 }} /> },
  ];

  return (
    <Row gutter={16}>
      {cards.map((c) => (
        <Col xs={12} md={6} key={c.label}>
          <Card size="small">
            <div className="label-caption">
              <TypeReveal text={c.label} />
            </div>
            {c.node}
          </Card>
        </Col>
      ))}
    </Row>
  );
}

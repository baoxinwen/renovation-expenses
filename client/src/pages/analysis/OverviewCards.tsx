import { Card, Col, Row } from 'antd';
import type { Summary } from '../../api';
import AnimatedMoney from '../../components/AnimatedMoney';
import TypeReveal from '../../components/TypeReveal';
import { useIsMobile } from '../../hooks/useIsMobile';

// 总览区第一行：预算目标 / 清单总计 / 超支结余 / 实际已花（自原 Analysis 迁入，口径与展示不变；
// 标签走流式打字铁律 4，数字保留滚动动效 + tabular 防抖）。
// 移动端保持两列两行，但金额字号 22→17——160px 宽的小卡里塞「¥109,183.67」
// 会顶满边框（r2 后用户实测反馈）
export default function OverviewCards({ summary }: { summary: Summary | null }) {
  const isMobile = useIsMobile();
  const diff = summary ? summary.plan_total - summary.total_budget : 0;
  const moneySize = isMobile ? 17 : 22;
  const moneyStyle = { display: 'block', marginTop: isMobile ? 4 : 8 } as React.CSSProperties;

  const cards: { label: string; node: React.ReactNode }[] = [
    { label: '预算目标', node: <AnimatedMoney value={summary?.total_budget ?? 0} style={{ ...moneyStyle, fontSize: moneySize }} /> },
    { label: '清单总计', node: <AnimatedMoney value={summary?.plan_total ?? 0} style={{ ...moneyStyle, fontSize: moneySize }} /> },
    {
      label: '超支 / 结余',
      node: (
        <AnimatedMoney
          value={diff}
          style={{ ...moneyStyle, fontSize: moneySize, color: diff > 0 ? 'var(--clay)' : 'var(--sage)' }}
        />
      ),
    },
    { label: '实际已花', node: <AnimatedMoney value={summary?.actual_total ?? 0} style={{ ...moneyStyle, fontSize: moneySize }} /> },
  ];

  return (
    <Row gutter={[16, isMobile ? 12 : 16]}>
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

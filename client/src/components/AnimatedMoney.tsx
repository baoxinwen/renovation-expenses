import { useCountUp } from '../hooks/useCountUp';
import { fmtMoney } from '../format';

/** 金额数字滚动组件：滚动到目标值，格式规则与 fmtMoney 唯一出处 */
export default function AnimatedMoney({ value, className, style }: {
  value: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const v = useCountUp(value);
  return (
    <span className={`num-display ${className ?? ''}`} style={style}>
      {fmtMoney(v)}
    </span>
  );
}

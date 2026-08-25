import { useCountUp } from '../hooks/useCountUp';

/** 金额数字滚动组件：¥1,234.56，滚动 600ms */
export default function AnimatedMoney({ value, className, style }: {
  value: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const v = useCountUp(value);
  const neg = v < 0;
  const abs = Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span className={`num-display ${className ?? ''}`} style={style}>
      {neg ? '-' : ''}¥{abs}
    </span>
  );
}

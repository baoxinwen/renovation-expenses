/** 流式打字（大厂质感铁律 4）：单字 90ms 从 blur(6px) 浮现，相邻字错开 30ms。
 *  仅首屏进场播一次；外层 role="img" + aria-label 承载完整文本供读屏——裸 span
 *  是 ARIA generic 角色（名称计算 nameFrom: prohibited），aria-label 不生效，
 *  而字符 span 又被 aria-hidden 摘出可访问树，读屏会听到空标题；角色做法与
 *  ChartCard 对 canvas 的包装一致。 */
export default function TypeReveal({ text, className, style }: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className={className} style={style} role="img" aria-label={text}>
      {[...text].map((ch, i) => (
        <span
          key={`${ch}-${i}`}
          aria-hidden
          className="type-reveal-char"
          style={{ animationDelay: `${i * 30}ms` }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

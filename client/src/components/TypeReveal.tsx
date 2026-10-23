/** 流式打字（大厂质感铁律 4）：单字 90ms 从 blur(6px) 浮现，相邻字错开 30ms。
 *  仅首屏进场播一次；aria-label 保留完整文本供读屏，字符 span 置 aria-hidden。 */
export default function TypeReveal({ text, className, style }: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className={className} style={style} aria-label={text}>
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

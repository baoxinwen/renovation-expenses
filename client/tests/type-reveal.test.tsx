// TypeReveal 读屏可达性（2026-11-20 门禁桌面 I-1）：外层是无 role 的 span 时
// 属 ARIA generic 角色（可访问名称 nameFrom: prohibited），aria-label 不参与
// 名称计算，而字符 span 又全部 aria-hidden——读屏听到的标题是空的。
// 外层必须携带可命名角色 + 完整文本。
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TypeReveal from '../src/components/TypeReveal';

describe('TypeReveal 读屏可达性', () => {
  it('外层携带 role 与完整文本 aria-label，动画字符置 aria-hidden', () => {
    const html = renderToStaticMarkup(<TypeReveal text="预算总览" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="预算总览"');
    expect(html).toContain('aria-hidden');
  });

  it('文本中的特殊字符不破坏属性语义', () => {
    const html = renderToStaticMarkup(<TypeReveal text={`实付<90%"版`} />);
    expect(html).toContain('aria-label="实付&lt;90%&quot;版"');
  });
});

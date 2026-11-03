// 板块打印视图：独立于主布局的轻量页面，用浏览器打印另存 PDF。
// 微信内置浏览器不支持 window.print()，手机端请用系统浏览器打开后打印。
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Checkbox, Spin } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Item, Section } from '../api';
import '../styles/print-section.css';

export default function PrintSection() {
  const { id } = useParams();
  const sectionId = Number(id);
  const [section, setSection] = useState<Section | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [withPrice, setWithPrice] = useState(true);

  useEffect(() => {
    if (!Number.isInteger(sectionId) || sectionId <= 0) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    api.getPlan()
      .then((plan) => {
        const sec = plan.sections.find((s) => s.id === sectionId);
        if (!sec) { setNotFound(true); return; }
        setSection(sec);
        setItems(sec.items ?? []);
      })
      // 网络失败与「板块不存在」是两件事（M9）：把服务未启动显示成
      // 「板块不存在」会误导用户去检查清单
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [sectionId]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  if (loadError) return <div style={{ padding: 40, textAlign: 'center' }}>加载失败：请确认账本服务已启动后刷新重试</div>;
  if (notFound || !section) return <div style={{ padding: 40, textAlign: 'center' }}>板块不存在或已被删除</div>;

  const money = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // 实付口径与应用一致：actual_amount 由后端 itemActualSQL 预计算（已买成交 + 挂单付款），
  // 前端不复算；无成交内容（未买且无订单付款）的项不显示实付
  const paid = (it: Item) => (it.bought || it.order_count > 0 ? it.actual_amount : null);
  const budgetSubtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  const actualSubtotal = items.reduce((s, it) => s + it.actual_amount, 0);

  return (
    <div className="print-page">
      <div className="print-toolbar">
        <Checkbox checked={withPrice} onChange={(e) => setWithPrice(e.target.checked)}>包含价格</Checkbox>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>打印 / 另存 PDF</Button>
        <span style={{ color: '#888', fontSize: 12 }}>
          打印对话框中选择「另存为 PDF」；微信内置浏览器不支持打印，请用系统浏览器打开
        </span>
      </div>
      <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>{section.name} · 清单</h1>
      <div className="print-caption">生成时间：{new Date().toLocaleString('zh-CN')}</div>
      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>序号</th>
            <th>项目名称</th>
            <th>规格 / 品牌</th>
            <th style={{ width: 48 }}>单位</th>
            <th style={{ width: 56 }}>数量</th>
            {withPrice && (
              <>
                <th style={{ width: 84 }}>单价（元）</th>
                <th style={{ width: 92 }}>总价（元）</th>
                <th style={{ width: 92 }}>实付（元）</th>
                <th style={{ width: 44 }}>已买</th>
              </>
            )}
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id}>
              <td>{i + 1}</td>
              <td>{it.name}</td>
              <td>{it.spec}</td>
              <td>{it.unit}</td>
              <td className="num">{it.quantity}</td>
              {withPrice && (
                <>
                  <td className="num">{money(it.unit_price)}</td>
                  <td className="num">{money(it.quantity * it.unit_price)}</td>
                  <td className="num">{paid(it) == null ? '' : money(paid(it)!)}</td>
                  <td style={{ textAlign: 'center' }}>{it.bought ? '✓' : ''}</td>
                </>
              )}
              <td>{it.note}</td>
            </tr>
          ))}
          {withPrice && items.length > 0 && (
            <tr className="subtotal">
              <td colSpan={5}>小计</td>
              <td className="num" colSpan={2}>{money(budgetSubtotal)}</td>
              <td className="num">{money(actualSubtotal)}</td>
              <td />
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

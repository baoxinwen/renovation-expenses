// 金额统一格式化：¥1,234.56（负数显示 -¥xxx）
export function fmtMoney(n: number | null | undefined): string {
  const v = n ?? 0;
  const abs = Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}¥${abs}`;
}

export const PAY_METHODS = ['现金', '微信', '支付宝', '银行卡', '信用卡', '其他'];

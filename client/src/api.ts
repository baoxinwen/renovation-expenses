export interface Section {
  id: number;
  name: string;
  sort_order: number;
  budget_subtotal?: number;
  actual_subtotal?: number;
  items?: Item[];
}

export interface Item {
  id: number;
  section_id: number;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unit_price: number;
  bought: number;
  bought_date: string | null;
  init_unit_price: number | null;
  note: string;
  sort_order: number;
  budget_amount: number;
  actual_amount: number;
  order_count: number;
  order_paid: number;
}

export interface PlanData {
  total_budget: number;
  plan_total: number;
  actual_total: number;
  unassigned_paid: number;
  sections: Section[];
}

export interface Receipt {
  id: number;
  payment_id: number;
  filename: string;
  original_name: string;
  created_at?: string;
}

export interface Payment {
  id: number;
  order_id: number;
  amount: number;
  pay_date: string;
  method: string;
  note: string;
  created_at?: string;
  receipt_count?: number;
  receipts?: Receipt[];
}

export interface Order {
  id: number;
  title: string;
  vendor: string;
  item_id: number | null;
  total_amount: number;
  note: string;
  status: 'open' | 'closed';
  created_at: string;
  item_name?: string | null;
  section_id?: number | null;
  section_name?: string | null;
  paid?: number;
  receipt_count?: number;
  payments?: Payment[];
}

export interface Summary {
  total_budget: number;
  plan_total: number;
  init_plan_total: number;
  actual_total: number;
  unassigned_paid: number;
  sections: {
    id: number; name: string; budget_subtotal: number; actual_subtotal: number;
    item_count: number; bought_count: number;
  }[];
}

export interface Charts {
  by_section: { name: string; budget: number; actual: number }[];
  by_month: { month: string; amount: number }[];
  top_items: { id: number; name: string; budget: number; actual: number }[];
  recent_payments: {
    id: number; amount: number; pay_date: string; method: string; note: string;
    order_id: number; order_title: string; item_name: string | null; section_name: string | null;
  }[];
}

export interface ItemFormValues {
  name: string;
  spec?: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  note?: string;
}

export interface OrderFormValues {
  title: string;
  vendor?: string;
  item_id?: number | null;
  total_amount: number;
  note?: string;
  /** 一次付清：创建订单的同时记首笔付款，付足自动结清 */
  paid_now?: { amount: number; pay_date: string; method?: string; note?: string };
}

async function req<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: !isForm && body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('网络连接失败——账本服务可能没有启动，或手机与电脑不在同一 WiFi');
  }
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const data = await res.json();
      if (data?.message) message = data.message;
    } catch { /* 忽略解析失败 */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // 设置（预算目标）
  getSettings: () => req<{ total_budget: number }>('/api/settings', 'GET'),
  saveSettings: (total_budget: number) => req('/api/settings', 'PUT', { total_budget }),

  // 预算清单
  getPlan: () => req<PlanData>('/api/plan', 'GET'),
  addSection: (name: string) => req<Section>('/api/sections', 'POST', { name }),
  updateSection: (id: number, patch: { name?: string }) => req(`/api/sections/${id}`, 'PUT', patch),
  deleteSection: (id: number) => req<{ ok: boolean; deleted: boolean }>(`/api/sections/${id}`, 'DELETE'),
  restoreSection: (id: number) => req<Section>(`/api/sections/${id}/restore`, 'POST'),
  reorderSections: (ids: number[]) => req('/api/sections/reorder', 'PUT', { ids }),
  addItem: (sectionId: number, body: ItemFormValues) =>
    req<Item>(`/api/sections/${sectionId}/items`, 'POST', body),
  updateItem: (id: number, patch: Partial<{
    name: string; spec: string; unit: string; quantity: number;
    unit_price: number; bought: boolean; bought_date: string | null; note: string;
  }> & { force?: boolean }) => req<Item>(`/api/items/${id}`, 'PUT', patch),
  deleteItem: (id: number) => req<{ ok: boolean; deleted: boolean }>(`/api/items/${id}`, 'DELETE'),
  restoreItem: (id: number) => req<Item>(`/api/items/${id}/restore`, 'POST'),
  reorderItems: (ids: number[]) => req('/api/items/reorder', 'PUT', { ids }),
  importPlan: (file: File, mode: 'replace' | 'append') => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ ok: boolean; sections: number; items: number; target: number | null }>(
      `/api/plan/import?mode=${mode}`, 'POST', fd);
  },

  // 订单
  getOrders: (params: { item_id?: number; section_id?: number; status?: string; q?: string }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    const s = qs.toString();
    return req<Order[]>(`/api/orders${s ? '?' + s : ''}`, 'GET');
  },
  getOrder: (id: number) => req<Order>(`/api/orders/${id}`, 'GET'),
  addOrder: (body: OrderFormValues) => req<Order & { payments?: Payment[] }>('/api/orders', 'POST', body),
  updateOrder: (id: number, patch: Partial<OrderFormValues & { status: 'open' | 'closed' }>) =>
    req<Order>(`/api/orders/${id}`, 'PUT', patch),
  deleteOrder: (id: number) => req<{ ok: boolean; deleted: boolean }>(`/api/orders/${id}`, 'DELETE'),
  restoreOrder: (id: number) => req<Order>(`/api/orders/${id}/restore`, 'POST'),

  // 付款
  addPayment: (orderId: number, body: { amount: number; pay_date: string; method?: string; note?: string }) =>
    req<Payment>(`/api/orders/${orderId}/payments`, 'POST', body),
  updatePayment: (id: number, patch: { amount?: number; pay_date?: string; method?: string; note?: string }) =>
    req<Payment>(`/api/payments/${id}`, 'PUT', patch),
  deletePayment: (id: number) => req(`/api/payments/${id}`, 'DELETE'),

  // 票据
  uploadReceipt: (paymentId: number, file: File) => {
    const fd = new FormData();
    fd.append('files', file);
    return req<Receipt[]>(`/api/payments/${paymentId}/receipts`, 'POST', fd);
  },
  deleteReceipt: (id: number) => req(`/api/receipts/${id}`, 'DELETE'),

  // 统计
  getSummary: () => req<Summary>('/api/stats/summary', 'GET'),
  getCharts: () => req<Charts>('/api/stats/charts', 'GET'),
};

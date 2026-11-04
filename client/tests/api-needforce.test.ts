// api.ts req 封装的契约测试（I6）：服务端 409 双算守卫的结构化 needForce 标志
// 必须随错误抛出——前端「识别→确认→force 重试」链路的半边依赖它；
// 契约漂移时用户会看到裸 409 文案或守卫失效，此前全靠手工发现。
// node 环境 stub 全局 fetch，不触网。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../src/api';

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api.req 的 needForce 结构化透传（I6）', () => {
  it('409 + {needForce:true} → err.needForce === true，message 来自响应体', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes(409, { message: '「冰箱」已勾「已买」，再挂订单付款会重复计入实际合计', needForce: true }),
    ));
    const err = await api.updateItem(1, { bought: true }).then(
      () => null,
      (e: Error & { needForce?: boolean }) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err?.needForce).toBe(true);
    expect(err?.message).toContain('已买');
  });

  it('409 但响应体无 needForce → 标志不被设置（消费方 !err.needForce 判断成立）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(409, { message: '冲突但不是双算守卫' })));
    const err = await api.updateItem(1, { bought: true }).then(
      () => null,
      (e: Error & { needForce?: boolean }) => e,
    );
    expect(err?.message).toContain('冲突');
    expect(err?.needForce).not.toBe(true);
  });

  it('错误体非 JSON → 兜底文案含状态码', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('internal error', { status: 500 })));
    const err = await api.getSettings().then(() => null, (e: Error) => e);
    expect(err?.message).toContain('500');
  });

  it('fetch 直接拒绝（网络断）→ 中文网络文案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    const err = await api.getSettings().then(() => null, (e: Error) => e);
    expect(err?.message).toContain('网络连接失败');
  });

  it('2xx 正常透传 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, { total_budget: 160000 })));
    await expect(api.getSettings()).resolves.toEqual({ total_budget: 160000 });
  });

  it('PUT /settings 以 JSON body 提交（Content-Type 头在）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await api.saveSettings(160000);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ total_budget: 160000 });
  });
});

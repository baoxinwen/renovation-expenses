// api.ts req 封装的契约测试（I6）：服务端 409 双算守卫的结构化 needForce 标志
// 必须随错误抛出——前端「识别→确认→force 重试」链路的半边依赖它；
// 契约漂移时用户会看到裸 409 文案或守卫失效，此前全靠手工发现。
// 另含请求超时契约（I3）：弱网悬挂必须按上限中断并给中文文案——
// 否则提交按钮 loading 永久卡死，用户刷新重记可能造成双笔付款。
// node 环境 stub 全局 fetch，不触网。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../src/api';

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

describe('api.req 的请求超时（I3）', () => {
  it('JSON 请求 15s 无响应 → 中文超时错误（而非永久悬挂）', async () => {
    vi.useFakeTimers();
    // 模拟真实 fetch 的 abort 语义：连接已建立但响应停滞（自身永不 settle），
    // 仅在 signal 被 abort 时以 TimeoutError 拒绝
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('signal timed out', 'TimeoutError')));
      })));
    const p = api.getSettings().then(
      () => null,
      (e: Error) => e,
    );
    // 让 fetch 的 promise 链先行注册，再推进超时
    await vi.advanceTimersByTimeAsync(15_000);
    const err = await p;
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain('超时');
  });

  it('超时前正常返回 → 不受超时机制影响', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, { total_budget: 1 })));
    const p = api.getSettings();
    await vi.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toEqual({ total_budget: 1 });
  });

  it('网络立断（非悬挂）→ 仍是网络失败文案，不是超时文案', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fail')));
    const err = await api.getSettings().then(() => null, (e: Error) => e);
    expect(err?.message).toContain('网络连接失败');
  });

  it('FormData 上传 15s 时不中断（上传放宽到 60s）', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('signal timed out', 'TimeoutError')));
      })));
    const p = api.uploadReceipt(1, new File(['x'], 'a.png')).then(
      () => null,
      (e: Error) => e,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(p).toBeNull(); // 15s 时仍在等——未触发中断
    await vi.advanceTimersByTimeAsync(45_000); // 推进到 60s
    const err = await p;
    expect(err?.message).toContain('60 秒');
  });
});

// 服务端 409 双算守卫「提交→确认→force 重试」统一链路的单元测试（C3/I3）。
// 核心契约：force 只能由服务端 409 needForce 触发——首跳一律不带 force，
// 本地快照的 bought 判定不是仲裁（多端场景会过期）。
import { describe, it, expect, vi } from 'vitest';
import { submitWithForceGuard } from '../src/utils/domain';

const needForceErr = (msg = '重复计入') => Object.assign(new Error(msg), { needForce: true });

describe('submitWithForceGuard', () => {
  it('首跳成功：直接返回，不弹确认、不带 force', async () => {
    const submit = vi.fn().mockResolvedValue('ok');
    const confirm = vi.fn().mockResolvedValue(true);
    await expect(submitWithForceGuard(submit, confirm)).resolves.toBe('ok');
    expect(submit).toHaveBeenCalledExactlyOnceWith(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('409 needForce → 确认后带 force 重试', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(needForceErr())
      .mockResolvedValueOnce('forced');
    const confirm = vi.fn().mockResolvedValue(true);
    await expect(submitWithForceGuard(submit, confirm)).resolves.toBe('forced');
    expect(submit.mock.calls.map((c) => c[0])).toEqual([false, true]);
    expect(confirm).toHaveBeenCalledExactlyOnceWith();
  });

  it('确认被拒绝 → 返回 null，不重试', async () => {
    const submit = vi.fn().mockRejectedValue(needForceErr());
    const confirm = vi.fn().mockResolvedValue(false);
    await expect(submitWithForceGuard(submit, confirm)).resolves.toBeNull();
    expect(submit).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('非 needForce 错误原样抛出，不弹确认', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('网络连接失败'));
    const confirm = vi.fn().mockResolvedValue(true);
    await expect(submitWithForceGuard(submit, confirm)).rejects.toThrow('网络连接失败');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('force 重试再失败：错误原样抛出（不吞）', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(needForceErr())
      .mockRejectedValueOnce(new Error('重试失败'));
    const confirm = vi.fn().mockResolvedValue(true);
    await expect(submitWithForceGuard(submit, confirm)).rejects.toThrow('重试失败');
  });

  it('兜底：无 needForce 标志但文案含「重复计入」也走确认（契约漂移防护）', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error('已勾「已买」，会重复计入实际合计'))
      .mockResolvedValueOnce('ok');
    const confirm = vi.fn().mockResolvedValue(true);
    await expect(submitWithForceGuard(submit, confirm)).resolves.toBe('ok');
    expect(submit.mock.calls.map((c) => c[0])).toEqual([false, true]);
  });
});

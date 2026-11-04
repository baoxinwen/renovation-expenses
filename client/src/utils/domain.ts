import { toast } from 'sonner';
import { confirmAsync } from './confirm';
import type { Item, Order } from '../api';
import { fmtMoney } from '../format';

// ===== 订单领域函数（口径唯一出处） =====

/** 未结清：还有未付余额的订单 */
export const isUnsettled = (o: Order) => (o.paid ?? 0) < o.total_amount && o.total_amount > 0;

/** 未付金额（不为负） */
export const unpaidOf = (o: Order) => Math.max(0, o.total_amount - (o.paid ?? 0));

/** 双算风险：未勾已买但项目下已有订单付款，再勾「已买」会重复计入实际 */
export const doubleCountRisk = (it: Item) => !it.bought && it.order_paid > 0;

/** 勾「已买」前的双算确认（桌面/移动共用文案与逻辑）；返回是否继续 */
export async function confirmDoubleCount(item: Item): Promise<boolean> {
  return confirmAsync({
    title: '该项目已有订单付款，可能重复计入',
    content: `「${item.name}」下订单已付 ${fmtMoney(item.order_paid)}，再记为已买会重复计入实际。通常二选一即可，仍要记吗？`,
    okText: '仍要记',
  });
}

/** 订单挂到已勾「已买」项目前的双算确认（桌面/移动共用文案与逻辑）；返回是否继续 */
export async function confirmOrderOnBoughtItem(item: Pick<Item, 'name'>): Promise<boolean> {
  return confirmAsync({
    title: '该项目已勾选「已买」',
    content: `「${item.name}」的总价已计入实际，再把订单付款挂上去会重复计入。通常二选一即可，仍要关联吗？`,
    okText: '仍要关联',
  });
}

/** 服务端 409 双算守卫的统一出路（桌面/移动共用，C3/I3 收敛自 Plan/Orders/OrderDetail/移动两页）：
 *  首跳一律不带 force；收到 needForce 时经 confirm 确认，用户坚持才带 force 重试。
 *  force 只能由服务端 409 触发——本地快照的 bought 判定不是仲裁（多端场景会过期）。
 *  返回 null = 用户放弃；其余错误原样抛出由调用方 toast。
 *  「重复计入」文案匹配仅作契约漂移兜底（与 Plan.confirmBuy 既有做法一致）。 */
export async function submitWithForceGuard<T>(
  submit: (force: boolean) => Promise<T>,
  confirm: () => Promise<boolean>,
): Promise<T | null> {
  try {
    return await submit(false);
  } catch (e) {
    const err = e as Error & { needForce?: boolean };
    if (!err.needForce && !err.message.includes('重复计入')) throw e;
    if (!(await confirm())) return null;
    return submit(true);
  }
}

// ===== 软删除 + 撤销的通用流程 =====

interface UndoableOpts {
  /** 实体显示名（用于 toast 文案） */
  label: string;
  /** 软删除调用（抛错则中断并 toast，不弹撤销） */
  del: () => Promise<unknown>;
  /** 撤销时的恢复调用 */
  restore: () => Promise<unknown>;
  /** 删除与撤销成功后的界面刷新回调 */
  onChanged: () => void;
  /** 撤销后的跳转回调（详情页删除场景需要；不传则仅刷新） */
  afterRestore?: () => void;
}

/** 删除 → 8 秒内可撤销的 toast → 恢复。统一四处软删除流程 */
export async function undoableDelete(opts: UndoableOpts): Promise<void> {
  try {
    await opts.del();
  } catch (e) {
    toast.error((e as Error).message);
    return;
  }
  toast.success(`已删除「${opts.label}」`, {
    duration: 8000,
    action: {
      label: '撤销',
      onClick: () => {
        opts.restore()
          .then(() => opts.afterRestore?.())
          .then(() => opts.onChanged())
          .catch((e) => toast.error((e as Error).message));
      },
    },
  });
  opts.onChanged();
}

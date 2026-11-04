// 进程内串行锁：备份的异步快照（db.backup 线程）与恢复的「关库-换文件」替换链互斥
//（I7）。备份线程未结束时恢复的 db.close() 会 SQLITE_BUSY 落进回滚分支；单用户单进程，
// 一把无重入串行锁即可。后到者排队等待（秒级）而不是拒绝——设置页两个按钮相邻，
// 双标签并发时应顺序完成而不是互抛错误。
let chain = Promise.resolve();

export function withLock(fn) {
  const run = chain.then(fn, fn); // 前驱失败也继续，不毒化后续排队者
  chain = run.then(() => {}, () => {});
  return run;
}

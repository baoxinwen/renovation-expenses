// 回归测试：票据上传限制与落盘正确性。
// 限制 —— 张数/总量限制必须在流内生效（内存有界），超限请求被拒且不落任何文件；
// 同名 —— 两张同名不同内容的图片落盘后内容不得串写。
// 隔离运行：自带临时数据库，不触碰生产库。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer, cleanupTestServer } from './helpers/spawn-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5212;
const BASE = `http://127.0.0.1:${PORT}/api`;

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-receipt-test-'));
// 就绪判定凭就绪标记 + 子进程存活（端口被外部实例占用时快速失败，不误测外部实例）
const { child, ready } = await startTestServer({ port: PORT, dataDir: tmpDir });
const cleanup = () => cleanupTestServer(child, tmpDir);
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
if (!ready) { console.error('隔离测试服务启动失败（端口可能被占用）'); cleanup(); process.exit(1); }

const png = (byte) => new Blob([new Uint8Array([0x89, 0x50, byte, 0x4e, 0x47])], { type: 'image/png' });
const upload = async (paymentId, files) => {
  const fd = new FormData();
  files.forEach(([name, blob], i) => fd.append('files', blob, `${i}_${name}`));
  const res = await fetch(`${BASE}/payments/${paymentId}/receipts`, { method: 'POST', body: fd });
  return { status: res.status, json: await res.json().catch(() => null) };
};

try {
  console.log('== 票据上传限制 ==');
  // 造一个一次付清订单拿首笔付款
  const sec = await fetch(`${BASE}/sections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '测试板块' }) });
  const secId = (await sec.json()).id;
  const order = await fetch(`${BASE}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '测试订单', total_amount: 10, paid_now: { amount: 10, pay_date: '2026-09-01' } }),
  });
  const paymentId = (await order.json()).payments[0].id;
  const uploadsDir = path.join(tmpDir, 'uploads');
  const diskFiles = () => fs.readdirSync(uploadsDir).filter((f) => !f.startsWith('.'));

  // 1) 超张数（11 > 10）：拒绝且不落盘。防线必须在流内生效——修复前校验在全量缓冲之后，
  //    状态码同样 400，但内存随请求无上限；此断言守住「拒绝 + 零残留 + 服务存活」不变量。
  let r = await upload(paymentId, Array.from({ length: 11 }, () => ['a.png', png(1)]));
  check('11 张被拒绝', r.status === 400, `status=${r.status}`);
  check('超限请求零落盘', diskFiles().length === 0, `落盘=${diskFiles().length}`);
  check('服务仍存活', (await fetch(`${BASE}/settings`)).ok);

  // 2) 正常 2 张仍可用
  r = await upload(paymentId, [['x.png', png(2)], ['y.png', png(3)]]);
  check('正常 2 张上传成功', r.status === 200 && r.json.length === 2, JSON.stringify(r.json?.message ?? r.status));
  check('落盘 2 个文件', diskFiles().length === 2, `落盘=${diskFiles().length}`);

  console.log('== 同名票据不串写 ==');
  // 3) 两张同名不同内容：落盘内容必须与各自上传内容一致（修复前后者被写成前者的内容）
  const contentA = png(0xaa);
  const contentB = png(0xbb);
  const fd = new FormData();
  fd.append('files', contentA, 'same.png');
  fd.append('files', contentB, 'same.png');
  const res = await fetch(`${BASE}/payments/${paymentId}/receipts`, { method: 'POST', body: fd });
  r = { status: res.status, json: await res.json().catch(() => null) };
  check('同名两张上传成功', r.status === 200 && r.json.length === 2, JSON.stringify(r.json?.message ?? r.status));
  if (r.status === 200 && r.json.length === 2) {
    const disks = await Promise.all(r.json.map((rc) => fs.promises.readFile(path.join(uploadsDir, rc.filename))));
    const differs = Buffer.compare(disks[0], disks[1]) !== 0;
    check('同名不同内容落盘内容不同（不串写）', differs);
    const inputsDiffer = disks[0].length === 5 && disks[1].length === 5
      && (disks[0][2] === 0xaa || disks[0][2] === 0xbb);
    check('内容为上传的两份之一', inputsDiffer);
  }
  console.log('== 早退路径不悬挂（I1） ==');
  // 早退（格式/张数/字段名不符）时必须先消费当前 part 的流再回包：
  // 修复前 busboy 因默认 fileHwm(16KB) 反压暂停解析，请求悬挂到 requestTimeout(~300s)
  const blobOf = (bytes) => new Blob([Buffer.alloc(bytes, 0xff)], { type: 'image/png' });
  const timedUpload = async (fd) => {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/payments/${paymentId}/receipts`, {
      method: 'POST', body: fd, signal: AbortSignal.timeout(15000),
    });
    return { res, ms: Date.now() - t0 };
  };

  // 1) 不支持的格式（HEIC，>16KB）
  const fdHeic = new FormData();
  fdHeic.append('files', blobOf(64 * 1024), 'IMG_0001.HEIC');
  const heic = await timedUpload(fdHeic);
  check('不支持格式快速返回 400（不悬挂至超时）', heic.res.status === 400 && heic.ms < 10000, `status=${heic.res.status} ms=${heic.ms}`);
  check('返回设计的中文提示', ((await heic.res.json().catch(() => null))?.message ?? '').includes('不支持的图片格式'));

  // 2) 超张数（12 张大图）
  const fdMany = new FormData();
  for (let i = 0; i < 12; i++) fdMany.append('files', blobOf(64 * 1024), `${i}.png`);
  const many = await timedUpload(fdMany);
  check('超张数快速返回 400（不悬挂至超时）', many.res.status === 400 && many.ms < 10000, `status=${many.res.status} ms=${many.ms}`);
  check('超张数返回中文提示', ((await many.res.json().catch(() => null))?.message ?? '').includes('最多上传'));

  // 3) 文件字段名不符
  const fdWrong = new FormData();
  fdWrong.append('photo', blobOf(64 * 1024), 'x.png');
  const wrong = await timedUpload(fdWrong);
  check('字段名不符快速返回 400', wrong.res.status === 400 && wrong.ms < 10000, `status=${wrong.res.status} ms=${wrong.ms}`);

  check('服务仍存活', (await fetch(`${BASE}/settings`)).ok);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);

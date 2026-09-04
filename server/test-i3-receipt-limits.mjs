// I3/M2 回归测试：票据上传限制与落盘正确性。
// I3 —— 张数/总量限制必须在流内生效（内存有界），超限请求被拒且不落任何文件；
// M2 —— 两张同名不同内容的图片落盘后内容不得串写。
// 隔离运行：自带临时数据库，不触碰生产库。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5212;
const BASE = `http://127.0.0.1:${PORT}/api`;

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reno-i3-'));
const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT), RENO_DATA_DIR: tmpDir },
  stdio: 'ignore',
});
const cleanup = () => {
  try { child.kill(); } catch { /* 已退出 */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 文件占用时忽略 */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

let ready = false;
for (let i = 0; i < 30; i++) {
  try { if ((await fetch(`${BASE}/settings`)).ok) { ready = true; break; } } catch { /* 尚未启动 */ }
  await new Promise((r) => setTimeout(r, 300));
}
if (!ready) { console.error('隔离测试服务启动失败'); cleanup(); process.exit(1); }

const png = (byte) => new Blob([new Uint8Array([0x89, 0x50, byte, 0x4e, 0x47])], { type: 'image/png' });
const upload = async (paymentId, files) => {
  const fd = new FormData();
  files.forEach(([name, blob], i) => fd.append('files', blob, `${i}_${name}`));
  const res = await fetch(`${BASE}/payments/${paymentId}/receipts`, { method: 'POST', body: fd });
  return { status: res.status, json: await res.json().catch(() => null) };
};

try {
  console.log('== I3 票据上传限制 ==');
  // 造一个一次付清订单拿首笔付款
  const sec = await fetch(`${BASE}/sections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'I3板块' }) });
  const secId = (await sec.json()).id;
  const order = await fetch(`${BASE}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'I3订单', total_amount: 10, paid_now: { amount: 10, pay_date: '2026-09-01' } }),
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

  console.log('== M2 同名票据不串写 ==');
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
} finally {
  cleanup();
}

console.log(`\nI3/M2 结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);

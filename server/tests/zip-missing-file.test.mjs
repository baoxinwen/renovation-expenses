// 回归测试：票据 zip 导出对磁盘缺失的票据文件跳过而非产出残缺包。
// 注：HTTP 层先发头再流式打包，缺失文件时状态码仍是 200——可区分的是 zip 完整性
//（中央目录条目数）：修复前 archiver 读文件报错中断流，包残缺。
// 隔离运行：自带临时数据库，不触碰生产库。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5214;
const BASE = `http://127.0.0.1:${PORT}/api`;

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

/** 解析 zip 中央目录条目数（EOCD 尾块）；残缺包返回 -1 */
function zipEntryCount(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return buf.readUInt16LE(i + 10);
  }
  return -1;
}

/** 从 zip 中提取指定条目的内容（经中央目录取真实尺寸；deflate/store 均支持） */
function zipEntryText(buf, name) {
  const nameBytes = Buffer.from(name, 'utf8');
  for (let i = 0; i <= buf.length - 46; i++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue; // 中央目录头 PK\x01\x02
    if (!buf.subarray(i + 46, i + 46 + nameBytes.length).equals(nameBytes)) continue;
    const method = buf.readUInt16LE(i + 10);
    const compSize = buf.readUInt32LE(i + 20);
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    const localOffset = buf.readUInt32LE(i + 42);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    return method === 8 ? zlib.inflateRawSync(data).toString('utf8') : data.toString('utf8');
  }
  return null;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovation-zip-test-'));
const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), RENOVATION_DATA_DIR: tmpDir },
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

try {
  console.log('== 缺失票据跳过 ==');
  const order = await fetch(`${BASE}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '测试订单', total_amount: 10, paid_now: { amount: 10, pay_date: '2026-09-01' } }),
  });
  const paymentId = (await order.json()).payments[0].id;

  const fd = new FormData();
  fd.append('files', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'a.png');
  fd.append('files', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x48])], { type: 'image/png' }), 'b.png');
  const up = await fetch(`${BASE}/payments/${paymentId}/receipts`, { method: 'POST', body: fd });
  const receipts = await up.json();
  check('造数：2 张票据', up.status === 200 && receipts.length === 2);

  // 模拟磁盘丢失（备份部分恢复/手工清理）：删掉第一张的物理文件，库记录仍在
  const lostPath = path.join(tmpDir, 'uploads', receipts[0].filename);
  fs.unlinkSync(lostPath);
  check('造数：第 1 张物理文件已删除', !fs.existsSync(lostPath));

  const res = await fetch(`${BASE}/export/receipts`);
  check('缺失文件时导出仍成功（跳过而非整体失败）', res.status === 200, `status=${res.status}`);
  if (res.status === 200) {
    const buf = Buffer.from(await res.arrayBuffer());
    check('响应为合法 zip（PK 头）', buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b, `head=${buf.subarray(0, 4).toString('hex')}`);
    // 完整包应含 1 张幸存票据 + 1 份票据清单.txt；残缺包（流中断）中央目录条目缺失
    const entries = zipEntryCount(buf);
    check('zip 完整（条目 = 幸存票据 1 + 清单 1）', entries === 2, `entries=${entries}`);
    // 清单必须如实记录：实际打包 1 张并注明缺失，而不是照抄库里的 2 张
    const manifest = zipEntryText(buf, '票据清单.txt');
    check('清单如实标注打包 1 张', manifest !== null && manifest.includes('1 张'), `manifest=${manifest?.split('\n')[0]}`);
    check('清单注明缺失未打包', manifest !== null && manifest.includes('缺失未打包'), `manifest=${manifest?.split('\n')[0]}`);
  }

  const resAll = await fetch(`${BASE}/export/receipts?order_id=999999`);
  check('无票据可导出仍返回 404', resAll.status === 404, `status=${resAll.status}`);
} finally {
  cleanup();
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);

// 自研 store/deflate 双模式 zip 解析器（Node 内置 zlib，零新依赖）。
// 服务端恢复解包与测试共用同一实现——解析行为即备份格式契约的一部分。
// 不支持：加密条目、zip64（备份上限 300MB 远未触及 zip64 阈值）、分卷。
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CDR_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const STORE = 0;
const DEFLATE = 8;
// 单条目解压上限：与 db.js LIMITS.BACKUP_MAX_MB（300）对齐（模块保持独立不反向依赖）
const MAX_ENTRY_BYTES = 300 * 1024 * 1024;
// 条目累计上限（r3 I2）：单条目防线拦不住「各 <300MB 但累计任意大」的 store
// 型 zip 同步全量进内存——总量同样不超过备份文件本身的 300MB
const MAX_TOTAL_BYTES = MAX_ENTRY_BYTES;

/** 解析 zip（Buffer）为条目数组 [{ name, data }]。抛错于结构非法/不支持的方法。
 *  opts.maxTotalBytes 可选：条目累计上限（默认 300MB，测试注入小值用）。 */
export function parseZip(buf, opts = {}) {
  // 1) 从尾部扫描 EOCD（注释最长 65535，窗口按缓冲上限截断）
  const scanFrom = Math.max(0, buf.length - 22 - 65535);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件（未找到 EOCD）');

  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  // 2) 遍历 Central Directory
  const entries = [];
  const maxTotalBytes = Number.isFinite(opts.maxTotalBytes) ? opts.maxTotalBytes : MAX_TOTAL_BYTES;
  let totalBytes = 0;
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== CDR_SIG) throw new Error('zip 结构损坏（CDR 签名不符）');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // 3) Local Header：名字与额外字段长度可能与 CDR 不同，以 LFH 为准定位数据
    if (buf.readUInt32LE(localOffset) !== LFH_SIG) throw new Error(`zip 结构损坏（条目 ${name} 的 LFH 签名不符）`);
    const lfhNameLen = buf.readUInt16LE(localOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === STORE) data = Buffer.from(raw);
    else if (method === DEFLATE) {
      // zip 炸弹防线（I8）：恶意备份可用几百 KB 压缩包内藏任意倍率 deflate 流，
      // 同步解压全量进内存会 OOM。上限与 db.js 的 LIMITS.BACKUP_MAX_MB 对齐——
      // 合法备份任何条目解压后都不会超过备份文件本身的 300MB 上限
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch {
        throw new Error(`条目解压超过 ${MAX_ENTRY_BYTES / 1024 / 1024}MB 上限（疑似 zip 炸弹）：${name}`);
      }
    } else throw new Error(`不支持的压缩方法（${method}）：${name}`);

    // 累计防线（r3 I2）：单条目各自合法但合计任意大同样 OOM——收条目前累计校验
    totalBytes += data.length;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`条目累计解压超过 ${Math.floor(maxTotalBytes / 1024 / 1024)}MB 上限（疑似 zip 炸弹）：${name}`);
    }
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

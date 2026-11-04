import Database from 'better-sqlite3';
import db, { reopenDatabase, LIMITS, DATA_DIR, UPLOAD_DIR } from '../db.js';
import ExcelJS from 'exceljs';
import path from 'node:path';
import fs from 'node:fs';
import { parseZip } from '../zipParse.js';
import { withLock } from '../lock.js';

// 在工作表中定位表头行与关键列（项目名称/规格/单位/数量/单价/实际支付/备注）
function findHeader(ws) {
  let headerRow = -1;
  const col = {};
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (headerRow > 0) return;
    const texts = {};
    row.eachCell({ includeEmpty: false }, (c, cn) => {
      const t = cellText(c.value).trim();
      if (t) texts[cn] = t;
    });
    const has = (kw) => Object.values(texts).some((t) => t.includes(kw));
    if (has('项目名称') && has('单价')) {
      headerRow = rn;
      for (const [cn, t] of Object.entries(texts)) {
        if (t.includes('项目名称')) col.name = Number(cn);
        else if (t.includes('规格') || t.includes('品牌')) col.spec = Number(cn);
        else if (t.includes('单位')) col.unit = Number(cn);
        else if (t.includes('数量')) col.quantity = Number(cn);
        else if (t.includes('单价')) col.unitPrice = Number(cn);
        else if (t.includes('实际支付')) col.paidAmount = Number(cn);
        else if (t.includes('备注')) col.note = Number(cn);
        else if (t.includes('已买')) col.bought = Number(cn);
      }
    }
  });
  return { headerRow, col };
}

// 从标记行提取预算目标数字（约定：D 列起为值区，A/B 列是标签）
function extractTarget(row) {
  let target = null;
  row.eachCell({ includeEmpty: false }, (c, cn) => {
    if (target == null && cn > 3) {
      const n = cellNum(c.value);
      if (n != null && n >= 0) target = n;
    }
  });
  return target;
}

// 单元格取文本：兼容数字 / richText / 公式结果
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return String(v.result);
    if (v.text !== undefined) return String(v.text);
    if (v.hyperlink !== undefined && v.text) return String(v.text);
  }
  return String(v);
}

function cellNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if (typeof v.result === 'number') return v.result;
    if (v.richText) v = v.richText.map((t) => t.text).join('');
    else if (v.text !== undefined) v = v.text;
    else return null;
  }
  const str = String(v).trim();
  if (str === '') return null; // 空文本单元格 → 未填，不是 0
  const n = Number(str.replace(/[¥,，\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 从「家庭装修全案预算评估表」式的表格解析板块与项目
// 约定：表头行含「项目名称」「单价」；板块行以【开头；明细行首列为序号；
//       「预算目标」行取该行第一个数字。
function parseWorkbook(wb) {
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Excel 中没有工作表');

  // 1. 找表头行与列位置
  const { headerRow, col } = findHeader(ws);
  if (headerRow < 0 || !col.name || !col.unitPrice) {
    throw new Error('未找到表头（需要含「项目名称」和「单价」两列）');
  }

  // 2. 逐行解析
  const sections = [];
  let target = null;
  let seq = 0;
  ws.eachRow({ includeEmpty: true }, (row, rn) => {
    if (rn <= headerRow) return;
    // 前 3 列内扫描标记文本：板块行在 A 列（与评估表/本系统导出一致），标签行兼容 A/B 列
    const heads = [1, 2, 3].map((c) => cellText(row.getCell(c).value).trim()).filter(Boolean);
    const first = heads[0] ?? '';
    if (!first) return;

    const sectionMark = heads.find((t) => t.startsWith('【'));
    if (sectionMark) {
      // 两种格式：`【板块一】硬装施工类（注释）`（用户表）与 `【硬装施工类】`（本系统导出）
      let name = sectionMark.replace(/^【[^】]*】/, '').trim();
      if (!name) name = (sectionMark.match(/^【([^】]+)】/) || [])[1] ?? '';
      name = name.replace(/（[^）]*）$/, '').replace(/\([^)]*\)$/, '').trim();
      if (name) {
        // 文件内同名板块（含导出文件重复结构）合并到已有板块，避免 UNIQUE 冲突
        const existing = sections.find((s) => s.name === name);
        if (existing) return;
        sections.push({ name, items: [] });
      }
      return;
    }
    const targetMark = heads.find((t) => t.includes('预算目标') || t.includes('总预算'));
    if (targetMark) {
      if (target == null) target = extractTarget(row);
      return;
    }
    const name = cellText(row.getCell(col.name).value).trim();
    if (!name || name === '序号') return;
    if (/^(板块小计|全案|合计|总计|实际总价|超支|预算对比|清单总计|未关联)/.test(first)) return;
    const seqNum = Number(first);
    if (!Number.isFinite(seqNum)) return;

    seq = seqNum;
    const spec = cellText(col.spec ? row.getCell(col.spec).value : '').trim();
    const unit = cellText(col.unit ? row.getCell(col.unit).value : '').trim();
    const quantityRaw = col.quantity ? cellNum(row.getCell(col.quantity).value) : null;
    const priceRaw = col.unitPrice ? cellNum(row.getCell(col.unitPrice).value) : null;
    const note = cellText(col.note ? row.getCell(col.note).value : '').trim();
    if (!sections.length) sections.push({ name: '未分组', items: [] });
    // 「已买」还原：优先读导出文件的「已买」专列（✓），兼容旧表/手工表写在规格或备注文本的用法。
    // 只认 ✓/√ 勾选符，「还没买」这类文本不会误判；专列与本系统导出格式一一对应（导入导出契约）
    const boughtCell = col.bought ? cellText(row.getCell(col.bought).value).trim() : '';
    const bought = boughtCell.includes('✓') || boughtCell.includes('√')
      || note.includes('已买') || spec.includes('已买');
    // 数量/单价与非负校验对齐（plan.js 的 validNum 语义）：负数与异常值一律按 0 处理
    const safeNum = (x, fallback) => (x == null ? fallback : (Number.isFinite(x) && x >= 0 ? x : 0));
    const paidRaw = col.paidAmount ? cellNum(row.getCell(col.paidAmount).value) : null;
    sections[sections.length - 1].items.push({
      seq,
      name,
      spec,
      unit,
      quantity: safeNum(quantityRaw, 1),
      unit_price: safeNum(priceRaw, 0),
      // 实付金额仅随「已买」入库；未填/未买为 null（实际回退 数量×单价）
      paid_amount: bought && paidRaw != null && paidRaw >= 0 ? paidRaw : null,
      note,
      bought: bought ? 1 : 0,
    });
  });

  if (!sections.length || !sections.some((s) => s.items.length)) {
    throw new Error('没有解析到任何板块/项目，请确认表格格式');
  }
  return { sections, target };
}

export default async function (app) {
  app.post('/plan/import', async (req, reply) => {
    // mode 只认 append / replace（缺省 replace 兼容不带参调用）；显式拼错（如
    // appned）回 400 而不是静默按破坏性 replace 清空清单（M1）
    const rawMode = req.query.mode;
    if (rawMode !== undefined && rawMode !== '' && rawMode !== 'append' && rawMode !== 'replace') {
      return reply.status(400).send({ message: 'mode 仅支持 replace 或 append' });
    }
    const mode = rawMode === 'append' ? 'append' : 'replace';
    const file = await req.file({ limits: { fileSize: LIMITS.IMPORT_FILE_MB * 1024 * 1024 } });
    // 早退后必须排干 multipart 剩余部分再回包（M5，对照 orders.js 票据上传的
    // drainRest 标准）：大文件在途时不排干，客户端只见网络错误收不到中文提示
    const drainRest = async () => {
      try {
        for await (const _ of req.parts()) { void _; }
      } catch { /* 客户端已断开等情况，排干尽力而为 */ }
    };
    if (!file || file.fieldname !== 'file') {
      await drainRest();
      return reply.status(400).send({ message: '请上传 Excel 文件（字段名 file）' });
    }
    const ext = file.filename.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xlsm')) {
      await drainRest();
      return reply.status(400).send({ message: '只支持 .xlsx / .xlsm 文件' });
    }
    const buf = await file.toBuffer();
    if (file.truncated) {
      await drainRest();
      return reply.status(400).send({ message: `文件超过 ${LIMITS.IMPORT_FILE_MB}MB 限制，请检查是否传对了文件` });
    }
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf);
    } catch {
      return reply.status(400).send({ message: 'Excel 文件解析失败，请确认是有效的 .xlsx' });
    }

    if (wb.worksheets[0] && wb.worksheets[0].rowCount > LIMITS.IMPORT_MAX_ROWS) {
      return reply.status(400).send({ message: `工作表行数超过 ${LIMITS.IMPORT_MAX_ROWS}，请检查是否传对了文件` });
    }
    let parsed;
    try {
      parsed = parseWorkbook(wb);
    } catch (e) {
      return reply.status(400).send({ message: e.message });
    }

    const insertSection = db.prepare('INSERT INTO sections (name, sort_order) VALUES (?, ?)');
    const insertItem = db.prepare(`INSERT INTO items (section_id, name, spec, unit, quantity, unit_price, bought, paid_amount, note, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let itemCount = 0;

    try {
      db.transaction(() => {
        if (mode === 'replace') {
          // 清空清单；项目下订单的 item_id 由外键置空，付款/票据保留
          db.prepare('DELETE FROM sections').run();
        }
        const baseOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM sections').get().m + 1;
        parsed.sections.forEach((sec, si) => {
          // 追加模式下避免重名
          let name = sec.name;
          if (mode === 'append') {
            let n = 1;
            const exists = db.prepare('SELECT COUNT(*) AS c FROM sections WHERE name = ?');
            while (exists.get(name).c > 0) name = `${sec.name}(${++n})`;
          }
          const info = insertSection.run(name, baseOrder + si);
          sec.items.forEach((it, ii) => {
            insertItem.run(info.lastInsertRowid, it.name, it.spec, it.unit, it.quantity, it.unit_price, it.bought, it.paid_amount, it.note, ii);
            itemCount++;
          });
        });
        if (parsed.target != null) {
          db.prepare(`INSERT INTO settings (key, value) VALUES ('total_budget', ?)
                      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(parsed.target));
        }
      })();
    } catch (e) {
      if (String(e?.message || '').includes('UNIQUE constraint failed')) {
        return reply.status(400).send({ message: '文件中存在重复的板块名，请检查后重试' });
      }
      throw e;
    }

    return {
      ok: true,
      mode,
      sections: parsed.sections.length,
      items: itemCount,
      target: parsed.target,
    };
  });

  // ===== 恢复备份：上传 zip 全量替换当前数据（四步安全链，spec F2） =====
  app.post('/restore/backup', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: LIMITS.BACKUP_MAX_MB * 1024 * 1024 } });
    if (!file || file.fieldname !== 'file') {
      return reply.status(400).send({ message: '请上传备份文件（字段名 file）' });
    }
    if (file.truncated) {
      return reply.status(400).send({ message: `备份文件超过 ${LIMITS.BACKUP_MAX_MB}MB 上限` });
    }
    const buf = await file.toBuffer();

    // 第 1 步：解析与条目校验（只接受本系统备份格式；拒绝路径穿越条目）
    let entries;
    try {
      entries = parseZip(buf);
    } catch {
      return reply.status(400).send({ message: '备份文件解析失败，请确认是本系统导出的备份' });
    }
    if (entries.some((e) => e.name.includes('..') || path.isAbsolute(e.name))) {
      return reply.status(400).send({ message: '备份包含非法路径条目，已拒绝' });
    }
    const dbEntry = entries.find((e) => e.name === 'database.db');
    if (!dbEntry) {
      return reply.status(400).send({ message: '备份缺少 database.db，请确认是本系统导出的备份' });
    }
    const uploadEntries = entries.filter((e) => e.name.startsWith('uploads/') && !e.name.endsWith('/'));

    // 第 2 步：校验库完整性（临时文件打开 quick_check + 关键表存在）；校验文件
    // 写出纳入 try——磁盘满等写失败也走统一分支（M16），不留 .restore-check 残骸
    const checkPath = path.join(DATA_DIR, `.restore-check-${Date.now()}.db`);
    let checkDb;
    try {
      fs.writeFileSync(checkPath, dbEntry.data);
      checkDb = new Database(checkPath);
      const quick = checkDb.pragma('quick_check', { simple: true });
      if (quick !== 'ok') throw new Error('数据库完整性校验未通过');
      const tables = checkDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      for (const t of ['settings', 'sections', 'items', 'orders', 'payments', 'receipts']) {
        if (!tables.includes(t)) throw new Error(`缺少关键表：${t}`);
      }
    } catch (e) {
      try { checkDb?.close(); } catch { /* 已随写失败关闭 */ }
      fs.rmSync(checkPath, { force: true });
      return reply.status(400).send({ message: `备份校验失败：${e.message}` });
    }
    checkDb.close();

    // 第 3/4 步：可回滚替换链，全程与 /export/backup 的异步快照互斥（I7，见
    // server/lock.js：备份线程未结束时替换链的 db.close() 会 SQLITE_BUSY）。
    // 任一步失败库与票据都有完整还原路径，响应文案「原数据已还原」是真实承诺（C4/C5）：
    //   库：db.close() 之后拷贝主库+侧车三件套作回滚点——close 会把 WAL checkpoint
    //      进主库，三件套兜底侧车残留（对齐 db.js legacy 改名的侧车随迁语义），
    //      失败还原不再定格旧 checkpoint 时点、丢最近未 checkpoint 的写入（C5）
    //   票据：先写 staging（重名加序号 M21、Windows 保留名/非法字符清洗），再用
    //      两个同盘原子 rename 换目录——不再「删光再逐条写回」，失败可整体还原（C4）
    return withLock(async () => {
      const dbFile = path.join(DATA_DIR, 'renovation-expenses.db');
      const rollback = dbFile + '.pre-restore';
      const uploadsBackup = UPLOAD_DIR + '.pre-restore';
      const staging = UPLOAD_DIR + '.staging';
      const dbExts = ['', '-wal', '-shm'];
      // zip 条目名来自外部，恶意/损坏包可能携带 CON、冒号、尾点等——服务端正常生成的
      // 随机文件名不会命中，清洗只影响脏数据；重名（大小写不敏感，Windows 同盘）加序号
      const sanitizeBasename = (name) => {
        let s = path.basename(name).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '').trim();
        if (!s || s === '.' || s === '..') s = 'file';
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(s)) s = `_${s}`;
        return s;
      };
      try {
        fs.rmSync(staging, { recursive: true, force: true });
        fs.mkdirSync(staging, { recursive: true });
        const used = new Set();
        for (const e of uploadEntries) {
          const base = sanitizeBasename(e.name);
          let name = base;
          let n = 2;
          while (used.has(name.toLowerCase())) name = `${n++}_${base}`;
          used.add(name.toLowerCase());
          fs.writeFileSync(path.join(staging, name), e.data);
        }
      } catch (e) {
        req.log.error({ err: e }, '恢复暂存写入失败（库未动）');
        fs.rmSync(staging, { recursive: true, force: true });
        return reply.status(500).send({ message: '恢复失败：暂存写入出错，请检查磁盘空间后重试' });
      }

      // —— 以下 db 已关闭，按阶段推进（C2：进 catch ≠ 恢复失败——成功收尾的
      // 清理失败也会进 catch；「回滚点缺失」时绝不允许写/删主库）——
      db.close();
      // closed：原库未动，任何失败 reopen 即可，不存在「还原」问题
      // copied：回滚点完整（tmp 写入+原子改名，半截文件绝不出现）
      // swapped：主库已被替换——只有此阶段失败才允许用回滚点还原
      let phase = 'closed';
      let restored = false;
      const safeCleanup = (p, e) => {
        // 清理失败 = 留一个垃圾文件，绝不影响恢复结果（C2 变体 b：Windows
        // 杀软锁定时 rmSync EPERM 会抛，若让它进回滚分支会误删刚恢复的活库）
        try { fs.rmSync(p, { recursive: true, force: true }); } catch (err) {
          req.log.warn({ err, path: p }, '恢复清理残留（不影响数据）');
        }
      };
      try {
        // 回滚点：tmp 写入 + 原子改名——要么完整要么不存在（C2 变体 a：
        // copyFileSync 直接写目标会留下半截文件被误当回滚点盖回主库）
        for (const ext of dbExts) {
          const src = dbFile + ext;
          if (fs.existsSync(src)) {
            const tmp = rollback + ext + '.tmp';
            fs.copyFileSync(src, tmp);
            fs.renameSync(tmp, rollback + ext);
          }
        }
        if (!fs.existsSync(rollback)) {
          // 回滚点建不出来（磁盘满/杀软锁）：绝不换库、绝不碰主库，保留现场
          reopenDatabase();
          phase = 'done';
          safeCleanup(staging);
          req.log.error('回滚点创建失败，已放弃本次恢复（原数据未动）');
          return reply.status(500).send({ message: '恢复失败：无法创建安全回滚点（磁盘空间或文件占用），原数据未受影响' });
        }
        phase = 'copied';
        fs.renameSync(checkPath, dbFile);
        for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
        reopenDatabase();
        phase = 'swapped';

        // 票据目录替换：两个同盘原子 rename；第二个失败在 finally 里还原旧目录
        let uploadsSwapped = false;
        try {
          if (fs.existsSync(UPLOAD_DIR)) fs.renameSync(UPLOAD_DIR, uploadsBackup);
          fs.renameSync(staging, UPLOAD_DIR);
          uploadsSwapped = true;
        } finally {
          if (!uploadsSwapped && fs.existsSync(uploadsBackup)) {
            fs.renameSync(uploadsBackup, UPLOAD_DIR);
          }
        }
        // 成功收尾：回滚点与旧票据目录用毕即清（M17）——清理失败只留残骸
        for (const ext of dbExts) safeCleanup(rollback + ext);
        safeCleanup(uploadsBackup);
        safeCleanup(staging);
        phase = 'done';
        return { ok: true, restoredAt: new Date().toISOString() };
      } catch (e) {
        req.log.error({ err: e }, '恢复替换链失败');
        // 只有「已换库」才存在还原；回滚点主文件必须在（copied 阶段由 tmp→
        // rename 保证完整性）——缺失时绝不写/删主库（C2：那是活库或原库）
        const canRestore = phase === 'swapped' && fs.existsSync(rollback);
        if (canRestore) {
          try {
            try { db.close(); } catch { /* 已关闭或从未重开 */ }
            for (const ext of dbExts) {
              const dest = dbFile + ext;
              if (fs.existsSync(rollback + ext)) fs.copyFileSync(rollback + ext, dest);
              else fs.rmSync(dest, { force: true });
            }
            reopenDatabase();
            safeCleanup(staging);
            for (const ext of dbExts) safeCleanup(rollback + ext);
            restored = true;
          } catch (restoreErr) {
            req.log.error({ err: restoreErr }, '回滚点还原也失败，保留现场供人工排查');
            return reply.status(500).send({ message: '恢复失败且自动还原失败，请人工检查数据目录' });
          }
        } else {
          // 未换库（closed/copied）：主库仍是原库，重开连接即可
          try { reopenDatabase(); } catch (reopenErr) {
            req.log.error({ err: reopenErr }, '重开数据库失败，保留现场供人工排查');
            return reply.status(500).send({ message: '恢复失败，请人工检查数据目录后重启服务' });
          }
          safeCleanup(staging);
        }
        return reply.status(500).send({
          message: restored
            ? '恢复失败，原数据已还原，请重试或人工排查'
            : '恢复失败，原数据未受影响，请重试或人工排查',
        });
      }
    });
  });
}

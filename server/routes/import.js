import db from '../db.js';
import ExcelJS from 'exceljs';

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
        else if (t.includes('备注')) col.note = Number(cn);
      }
    }
  });
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
      // 取该行第一个非空数字
      row.eachCell({ includeEmpty: false }, (c, cn) => {
        if (target == null && cn > 3) {
          const n = cellNum(c.value);
          if (n != null && n >= 0) target = n;
        }
      });
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
    // 「已买」可能出现在规格或备注里（如"米家冰箱pro（已买）"），勾选已买
    const bought = note.includes('已买') || spec.includes('已买');
    // 数量/单价与非负校验对齐（plan.js 的 validNum 语义）：负数与异常值一律按 0 处理
    const safeNum = (x, fallback) => (x == null ? fallback : (Number.isFinite(x) && x >= 0 ? x : 0));
    sections[sections.length - 1].items.push({
      seq,
      name,
      spec,
      unit,
      quantity: safeNum(quantityRaw, 1),
      unit_price: safeNum(priceRaw, 0),
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
    const mode = (req.query.mode === 'append') ? 'append' : 'replace';
    const file = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!file || file.fieldname !== 'file') {
      return reply.status(400).send({ message: '请上传 Excel 文件（字段名 file）' });
    }
    const ext = file.filename.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xlsm')) {
      return reply.status(400).send({ message: '只支持 .xlsx / .xlsm 文件' });
    }
    const buf = await file.toBuffer();
    if (file.truncated) {
      return reply.status(400).send({ message: '文件超过 20MB 限制，请检查是否传对了文件' });
    }
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf);
    } catch {
      return reply.status(400).send({ message: 'Excel 文件解析失败，请确认是有效的 .xlsx' });
    }

    if (wb.worksheets[0] && wb.worksheets[0].rowCount > 3000) {
      return reply.status(400).send({ message: '工作表行数超过 3000，请检查是否传对了文件' });
    }
    let parsed;
    try {
      parsed = parseWorkbook(wb);
    } catch (e) {
      return reply.status(400).send({ message: e.message });
    }

    const insertSection = db.prepare('INSERT INTO sections (name, sort_order) VALUES (?, ?)');
    const insertItem = db.prepare(`INSERT INTO items (section_id, name, spec, unit, quantity, unit_price, bought, note, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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
            insertItem.run(info.lastInsertRowid, it.name, it.spec, it.unit, it.quantity, it.unit_price, it.bought, it.note, ii);
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
}

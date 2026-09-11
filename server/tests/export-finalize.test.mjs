// 单元回归：票据打包 archive.finalize() 的 Promise 拒绝必须被接住记日志，
// 不得以 unhandledRejection 终止整个进程（Node ≥15 默认 --unhandled-rejections=throw）。
// 场景：打包中 zip 模块读流出错（如 Windows 票据文件被占用/杀软锁定）→ finalize reject。
import { finalizeArchive } from '../routes/export.js';

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

const unhandled = [];
const onUnhandled = (err) => unhandled.push(err);
process.on('unhandledRejection', onUnhandled);

console.log('== finalize 拒绝不崩进程 ==');
const boom = new Error('zip 模块读流失败');
const logs = [];
const fakeLog = { error: (obj, msg) => logs.push({ obj, msg }) };

// 不 await：与路由内用法一致（fire-and-forget），拒绝必须被内部 catch
finalizeArchive({ finalize: () => Promise.reject(boom) }, fakeLog);
await new Promise((r) => setTimeout(r, 50));

check('finalize 拒绝被记日志', logs.length === 1 && logs[0].obj.err === boom, `logs=${JSON.stringify(logs)}`);
check('无 unhandledRejection（进程不会被击穿）', unhandled.length === 0, `unhandled=${unhandled.length}`);

process.off('unhandledRejection', onUnhandled);
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);

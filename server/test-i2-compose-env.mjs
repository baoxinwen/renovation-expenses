// I2 回归测试：docker-compose.yml 必须把 EXTRA_ALLOWED_HOSTS 显式透传进容器。
// compose 的 .env 只用于 compose 文件内 ${...} 插值；变量未在 environment 声明就不会进入容器，
// README 承诺的 NAS 主机名放行会静默失效。此测试守住「文档承诺 = compose 接线」契约。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

const compose = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');

console.log('== I2 compose 环境变量透传 ==');
check('.env.example 承诺 EXTRA_ALLOWED_HOSTS', envExample.includes('EXTRA_ALLOWED_HOSTS'));
check('compose environment 显式声明 EXTRA_ALLOWED_HOSTS（${EXTRA_ALLOWED_HOSTS:-} 形式）',
  /-\s*EXTRA_ALLOWED_HOSTS=\$\{EXTRA_ALLOWED_HOSTS:-\}/.test(compose),
  '未找到透传行');

console.log(`\nI2 结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);

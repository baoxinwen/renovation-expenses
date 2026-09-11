// 回归测试：entrypoint.sh / Dockerfile / .dockerignore 的部署契约（文本断言，风格同 compose-env.test.mjs）。
// 1) cron 备份作业必须声明含 /usr/local/bin 的 PATH：Debian cron 作业默认 PATH=/usr/bin:/bin，
//    官方 node 镜像的 node 在 /usr/local/bin——缺失时每晚备份必败且无归档产出（评审 C2）；
// 2) 应用必须经 gosu 降权为 node 运行（Dockerfile/entrypoint 注释承诺，gosu 随镜像安装）（评审 I7）；
// 3) .dockerignore 必须整行排除 .env，防本地敏感文件随构建上下文外发（评审 M12）；
// 4) Dockerfile 必须声明 VOLUME /app/backups，裸 docker run 升级不丢备份（评审 M13）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const entrypoint = fs.readFileSync(path.join(root, 'docker', 'entrypoint.sh'), 'utf8');
const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
};

console.log('== cron 备份环境（C2） ==');
const cronIdx = entrypoint.indexOf('0 3 * * * node /app/backup.sh');
check('注册每日 03:00 备份作业', cronIdx !== -1);
const pathIdx = entrypoint.indexOf('PATH=/usr/local/bin');
check('cron 文件声明含 /usr/local/bin 的 PATH', pathIdx !== -1);
check('PATH 声明在作业行之前（crontab 环境变量须先声明）', pathIdx !== -1 && cronIdx !== -1 && pathIdx < cronIdx);

console.log('== 降权运行（I7） ==');
check('root 分支经 gosu node 降权 exec 应用', /exec\s+gosu\s+node\s+"\$@"/.test(entrypoint));

console.log('== 构建上下文与数据卷 ==');
check('.dockerignore 整行排除 .env', /^\.env$/m.test(dockerignore));
check('Dockerfile 声明 VOLUME /app/backups', /VOLUME\s+\/app\/backups/.test(dockerfile));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);

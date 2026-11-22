# AGENTS.md — 装修账本项目协作约定

单用户个人装修记账工具。Fastify 5 + better-sqlite3（`server/`，ESM JavaScript）·
React 18 + TypeScript + Vite + Ant Design 5 + ECharts（`client/`）。Windows 裸机开发
（Git Bash），Docker 部署到群晖 DSM 反代（reno.baoxinwen.top）。优先级：会话内指示 >
本文件 > 全局 `~/.zcode/AGENTS.md`。

## 口径红线（改错就是资损）

- **金额口径单一出处，禁止复制公式**：实际支出 = 服务端 `server/db.js` 的
  `itemActualSQL`（已买总价 + 订单付款，退款负数冲抵）；前端可花池在
  `client/src/utils/budgetCalc.ts`，实付预填在 `client/src/utils/domain.ts` 的
  `paidPrefill`。改口径只改出处。
- **预算目标与单价是用户显式输入**，任何修复/重构不得擅自改写。
- **force 只由服务端 409 needForce 触发**：客户端双算确认一律走
  `domain.ts` 的 `submitWithForceGuard` / `submitPaymentWithGuard`（取消静默返回
  null，不走红色错误 toast），本地快照不仲裁——多端并发下它会过期。
- **UI 文案与 commit 信息同源红线**：不得暴露开发需求、实现机制、实体名、过程叙事。

## 技术暗礁（实测踩过，勿凭直觉改回去）

- `@fastify/multipart`：`throwFileSizeLimit` 是**顶层**选项，嵌进 `limits` 会被
  busboy 忽略、缺省回 true（超限变英文 413）；`truncated` 标志在 busboy 流上，读
  `part.file.truncated` 而非 `part.truncated`。
- 服务端上传早退必须排干（`drainRest`/消费流），否则 busboy 反压让请求悬挂到超时。
- antd：body margin 必须清零（tokens.css 已做，动了滚动锁补偿会错位横跳）；Drawer
  必须挂 `rootClassName`（底部抽屉用 `bottom-sheet-inset`）；Button 两汉字间自动插
  空格，测试按可访问名查询用正则（`/保\s*存/`）。
- `@fastify/static`：`setHeaders` 首参是 fastify **reply** 不是原生 res，用
  `reply.header()`；它设置的头优先于库默认值。
- better-sqlite3 全同步是有意利用：恢复替换链全程无 await 以消除并发窗口，勿随手
  引入异步。
- 打字机标题组件 TypeReveal：外层须 `role="img" + aria-label`（裸 span 的 generic
  角色不参与名称计算），字符 span `aria-hidden`。

## 测试与验证

- `server/tests/*.mjs` 自隔离（临时库 + 独立端口），可单文件直跑；`npm test` 全链
  （server 18 项 + vitest）；`npx tsc --noEmit -p client/tsconfig.json` 连 tests 一起
  类型检查。
- 修复必须配**先失败后通过**的测试；没有回归测试的修复视为未实证。
- 组件测试：`// @vitest-environment jsdom` + `@testing-library/react`；vitest 未开
  globals，须手动 `afterEach(cleanup)`；需为 matchMedia/ResizeObserver 打最小桩。
- 早退场景的请求走 node:http 独立新连接——被服务端截断的 socket 残留在 undici
  连接池，fetch 复用会误报 ECONNRESET。

## 流程

- worktree 开发（`.worktrees/`，gitignored）+ TDD + 约定式原子提交；失败 3 次停，
  转系统化调试定位根因，不盲目重试。
- 提交 body 只写为什么（不写实现清单/诊断数字/报障叙事）；推送走发版流程。
- CHANGELOG 随发版定版，平时改动记 `[未发布]` 节；`docs/`（PRD/spec/评审）在
  .gitignore 内，属本地文档不进提交。

## 环境与资产

- 端口：前端 dev 5173 / 后端 5174（vite 代理写死 5174）。端口被残留进程占用时换
  端口重起（`npx vite --port XXXX`），不杀进程、不改仓库配置。
- `client/public/` 下 `_` 前缀文件是图标草稿与预览工具页（`_preview.html` 对比页、
  `_render.html` 是 v2 定稿后导出 192/180 的导出工具）——保留在 public 以维持 5173
  预览工作流，构建由 vite 插件自动剔除、.gitignore 防误提交，勿删勿入库。
- 部署面无应用层鉴权，DSM 反代的访问控制是安全前提，改动 Host 白名单逻辑需谨慎。

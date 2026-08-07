# En Play

En Play 读取 Obsidian 中的词库表格，把学习状态存入 SQLite，通过本地 Web 应用或 macOS 桌面应用提供「新词学习 + 到期复习」两条独立工作流。

## 功能特性

- **词库导入**：解析 `english-words*.md` 表格，按来源位置生成稳定 ID，幂等 upsert，不修改原始 Markdown
- **固定复习周期**：每个词条按 D1 / D3 / D7 / D14 / D21 五轮复习，周末自动顺延，D21 后关闭生命周期
- **独立任务**：每日新词学习（默认 6 个）与到期复习是两个互不影响的会话
- **Markdown 归档**：每日报告与待复习快照写回 Obsidian，便于阅读、搜索和回顾
- **本地优先**：所有数据保存在本机 SQLite，无外部服务依赖

## 快速开始（浏览器开发模式）

```bash
pnpm install
pnpm dev
```

打开 http://127.0.0.1:5173 （前端）或 Obsidian 笔记 `en/study/en-play.md`。服务启动后点击 **同步词库** 导入词条，导入幂等。

也可以构建后以单服务方式运行：

```bash
pnpm build
pnpm start   # http://127.0.0.1:4173
```

## 桌面版（macOS）

```bash
pnpm release
```

一条命令完成：构建前端 → esbuild 打包服务端 → electron-builder 产出未签名 dmg（arm64 + x86_64），产物在 `apps/desktop/release/`。首次打开需右键 → 打开。

桌面版特点：

- Fastify 服务端在 Electron 主进程内运行，窗口通过 loopback 地址加载界面，业务代码零改动
- 数据库位于 `~/Library/Application Support/En Play/en-play.sqlite3`（与浏览器/开发模式的默认路径一致）
- 桌面壳开发调试：`pnpm dev:desktop`

### 发版

推送 `v*` tag 即可自动发版：

```bash
git tag v0.2.0 && git push origin v0.2.0
```

GitHub Actions 自动构建两个架构的 dmg 并上传到 Releases 草稿，确认后点 Publish 正式发布。发版前记得递增 `apps/desktop/package.json` 中的 `version`。

## 数据位置

| 数据 | 位置 |
| --- | --- |
| SQLite（浏览器/开发模式） | `~/Library/Application Support/En Play/en-play.sqlite3` |
| SQLite（桌面版） | `~/Library/Application Support/En Play/en-play.sqlite3` |
| 备份 | `backups/en-play-YYYY-MM-DD.sqlite3` |
| 原始词库 | `~/Library/Application Support/En Play/vault/english-words*.md` |
| 复习快照 | `~/Library/Application Support/En Play/vault/study/review-queue.md` |
| 每日报告 | `~/Library/Application Support/En Play/vault/study/reports/YYYY-MM-DD.md` |

以上路径均为默认值，可用 `EN_PLAY_VOCAB_DIR`、`EN_PLAY_DATABASE_PATH`、`EN_PLAY_REPORTS_DIR`、`EN_PLAY_REVIEW_QUEUE_PATH` 环境变量覆盖（见 `.env.example`）。

## 项目结构

```text
apps/
├── web/        # React + Vite 前端
├── server/     # Fastify 本地 API（托管前端静态文件）
└── desktop/    # Electron 桌面壳与 dmg 打包
packages/
├── core/             # 共享类型、配置、日期规则
├── database/         # SQLite schema 与访问层（node:sqlite）
├── vocabulary-import/ # Markdown 词库解析
├── scheduler/        # 学习与复习状态机
├── evaluation/       # 评测适配器（当前为确定性实现）
└── reporting/        # Markdown 报告与快照导出
```

## 验证

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## 技术栈

Node.js 22 · pnpm workspace · TypeScript strict · Fastify · React 19 + Vite · `node:sqlite` · Zod · Vitest · Biome · Electron + electron-builder

## 当前范围

MVP 已完成：Markdown 导入、稳定位置 ID、SQLite migrations、五轮复习调度、周末顺延、幂等会话、本地 API、响应式 UI、Markdown 快照、SQLite 备份、macOS 桌面打包与 CI 发版。

待做：语义选词与短文生成、开放式答案评测、工作日定时任务、拼写题等题型扩展（详见 `DEVELOPMENT_TODO.md`）。桌面端后续项：苹果签名公证、应用内设置页、自定义图标、自动更新。

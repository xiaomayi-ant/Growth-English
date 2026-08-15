# EnPet

EnPet 读取本机 vault（词库目录）中的 Markdown 词库表格，把学习状态存入 SQLite，通过本地 Web 应用或 macOS 桌面应用提供「新词学习 + 到期复习」两条独立工作流。

## 功能特性

- **词库导入**：解析 `english-words*.md` 表格，按来源位置生成稳定 ID，幂等 upsert（存在即更新、不存在则插入），不修改原始 Markdown
- **固定复习周期**：每个词条按 D1 / D3 / D7 / D14 / D21 五轮复习，每天都可学习和复习，D21 后关闭生命周期
- **独立任务**：每日新词学习（默认 6 个）与到期复习是两个互不影响的会话
- **开箱即用**：首次打开直接进主界面，词库为空时就地给出「导入词库」和「用 6 个示例词先试试」两个入口，不拦一道启动向导
- **应用内设置**：词库目录、每日新词数、复习上限、提醒时间可在设置页修改，写入 `settings.json`
- **Markdown 归档**：每日报告与待复习快照写入 vault，便于在 Obsidian 中阅读、搜索和回顾
- **本地优先**：所有数据保存在本机 SQLite，无外部服务依赖

## 快速开始（浏览器开发模式）

```bash
pnpm install
pnpm dev
```

打开 http://127.0.0.1:5173，或用嵌入该地址的 Obsidian 笔记打开同一界面。词库为空时主界面会给出导入入口；已有数据时点击 **同步词库** 导入词条，导入幂等。

也可以构建后以单服务方式运行：

```bash
pnpm build
pnpm start   # http://127.0.0.1:4173
```

## 桌面版（macOS）

```bash
pnpm release
```

一条命令完成：构建前端 → esbuild 打包服务端 → electron-builder 产出未签名 dmg（macOS 磁盘映像安装包，arm64 + x86_64），产物在 `apps/desktop/release/`。未签名未公证，首次打开需右键 → 打开。

桌面版特点：

- Fastify 服务端在 Electron 主进程内运行，窗口通过 loopback（本机回环地址）加载界面，业务代码零改动
- 数据目录与浏览器/开发模式完全一致，两种模式共用同一份数据
- 桌面壳开发调试：`pnpm dev:desktop`（一次性构建后启动，无热重载）

### 发版

推送 `v*` tag 即可自动发版：

```bash
git tag v0.2.0 && git push origin v0.2.0
```

GitHub Actions 自动构建两个架构的 dmg 并上传到 Releases 草稿，确认后点 Publish 正式发布。发版前记得递增 `apps/desktop/package.json` 中的 `version`。

## 数据位置

| 数据 | 默认位置 |
| --- | --- |
| SQLite | `~/Library/Application Support/EnPet/enpet.sqlite3` |
| 设置文件 | `~/Library/Application Support/EnPet/settings.json` |
| 原始词库 | `~/Library/Application Support/EnPet/vault/english-words*.md` |
| 复习快照 | `~/Library/Application Support/EnPet/vault/study/review-queue.md` |
| 每日报告 | `~/Library/Application Support/EnPet/vault/study/reports/YYYY-MM-DD.md` |
| 备份 | 数据目录同级的 `backups/enpet-YYYY-MM-DD.sqlite3` |
| 运行日志 | `~/Library/Application Support/EnPet/logs/enpet-YYYY-MM-DD.log`，保留 7 天 |

配置的优先级是：默认值 < `settings.json` < 环境变量。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ENPET_DATA_DIR` | `~/Library/Application Support/EnPet` | 数据目录，下面所有路径的默认值都从它派生 |
| `ENPET_HOST` | `127.0.0.1` | 本地 API 监听地址 |
| `ENPET_PORT` | `4173` | 浏览器模式 API 端口 |
| `ENPET_TIMEZONE` | `Asia/Shanghai` | 判断“今天”是哪一天 |
| `ENPET_VOCAB_DIR` | 数据目录下的 `vault` | `english-words*.md` 所在目录 |
| `ENPET_DATABASE_PATH` | 数据目录下的 `enpet.sqlite3` | SQLite 文件，同目录读写 `settings.json` |
| `ENPET_REPORTS_DIR` | `vault/study/reports` | 每日 Markdown 报告目录 |
| `ENPET_REVIEW_QUEUE_PATH` | `vault/study/review-queue.md` | 待复习快照文件 |
| `ENPET_NEW_WORDS_PER_DAY` | `6` | 每日新词上限，取值 1–20 |
| `ENPET_REVIEW_LIMIT` | `30` | 单次复习上限，取值 1–200 |
| `ENPET_REMINDER_TIME` | `09:00` | 每日提醒时间，`HH:MM` |

环境变量不会自动从 `.env` 载入，需要先注入当前 shell：

```bash
set -a && source .env && set +a
```

### 出问题时看什么

桌面版双击启动没有终端，stdout 会被系统丢掉，所以日志同时写进数据目录：

```bash
tail -f ~/Library/Application\ Support/EnPet/logs/enpet-$(date +%F).log
```

界面上报错时，日志里 `"level":50` 那几行带着完整的错误消息和堆栈。日志按天分文件，保留 7 天，启动时清理更早的。

从终端启动的话，日志同时也打在终端里：

```bash
/Applications/EnPet.app/Contents/MacOS/EnPet
```

### 以新用户身份试用

macOS 上卸载 `.app` 不会删除 `~/Library/Application Support/` 下的数据，所以重装安装包看到的仍然是老数据——这是所有 Mac 应用的行为，为的是升级不丢数据。想看新用户的第一屏，把数据目录整个挪到临时位置即可：

```bash
ENPET_DATA_DIR=/tmp/enpet-fresh open -a EnPet
```

`ENPET_DATA_DIR` 生效时会跳过 En Play 迁移和旧数据库搬运，否则隔离目录会被填成「老用户」，空词库的入口就不会出现。真实数据目录全程不受影响。

注意两点：Electron 自身的浏览器缓存仍写在真实的 userData 下（不影响词库判定）；单实例锁也在那里，所以隔离实例和正常实例不能同时运行。

要彻底回到「从未安装过」的状态（会删掉真实数据），用 `pnpm reset:local`，先看预演再加 `--yes`。

### 从 En Play 迁移

项目原名 En Play，改名为 EnPet 后：

- 旧的 `EN_PLAY_*` 环境变量仍作为回退保留，旧 `.env` 不改也能启动
- 首次启动会把 `~/Library/Application Support/En Play/` 下的数据库（含 `-wal`/`-shm`）、`settings.json` 和整个 `vault` 复制到 `EnPet/`，只搬一次，旧目录原样保留，便于回退到旧版本

## 项目结构

```text
apps/
├── web/        # React + Vite 前端（含导入预览与设置页）
├── server/     # Fastify 本地 API（托管前端静态文件）
└── desktop/    # Electron 桌面壳与 dmg 打包
packages/
├── core/             # 共享类型、配置、日期规则、vault 结构、任务调度
├── database/         # SQLite schema 与访问层（node:sqlite）
├── vocabulary-import/ # Markdown 词库解析
├── scheduler/        # 学习与复习状态机
├── evaluation/       # 评测适配器（确定性实现 + Codex 评测器）
└── reporting/        # Markdown 报告与快照导出
```

完整的系统边界与领域规则见 `ARCHITECTURE.md`，产品规划见 `docs/PRODUCT_PLAN_DRAFT.md`。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

改动桌面代码、资源路径、Electron 或发版配置时，追加 `pnpm release` 作为打包验证。

## 技术栈

Node.js 22 · pnpm workspace（工作区） · TypeScript strict · Fastify · React 19 + Vite · `node:sqlite` · Zod · Vitest · Biome · Electron + electron-builder

## 当前范围

MVP（最小可用版本）已完成：Markdown 导入、稳定位置 ID、SQLite migrations、五轮复习调度、幂等会话、本地 API、响应式 UI、空词库入口、设置页、Markdown 快照、SQLite 备份、macOS 桌面打包与 CI（持续集成）发版。

待做：语义选词与短文生成、开放式答案评测落地、定时任务、拼写题等题型扩展（详见 `DEVELOPMENT_TODO.md`）。桌面端后续项：苹果签名公证、自定义图标、自动更新。

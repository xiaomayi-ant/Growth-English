# GrowthEnglish(En Play)产品与技术规划草稿

> 状态:草稿,供讨论。涉及未决策处用「?」标注。
> 日期:2026-08-07

---

## 0. 当前已知问题:dmg 安装后「同步词库」报错

### 现象

下载安装 dmg 后,点击「同步词库」报错。

### 根因分析(已定位)

1. **配置默认值硬编码了开发者本机的绝对路径**(`packages/core/src/config.ts:22-27`):
   `vocabDir` / `reportsDir` / `reviewQueuePath` 默认指向 `/Users/linctex/Projects/obsidian/...`。任何其他人的机器上这些目录都不存在。
2. **导入器对缺失目录没有兜底**:`packages/vocabulary-import/src/index.ts:123` 的 `loadVocabulary` 直接 `readdir(config.vocabDir)`,目录不存在即抛错。
3. **错误信息被服务端统一吞掉**:`apps/server/src/app.ts:91-103` 把所有 500 都返回 "Internal server error",用户(和我们自己)在界面上看不到真实原因,首装排错体验极差。
4. 桌面版预留了 `userData/settings.json` 覆盖配置的扩展点(`apps/desktop/src/main.ts:53-78`),但**没有设置界面**,普通用户无法修复。

### 修复计划(短期)

- [ ] 服务端错误处理:开发模式返回完整错误;生产模式至少把「哪一步失败、缺哪个路径」作为可读 message 返回。
- [ ] `loadVocabulary` 对目录不存在返回结构化错误(如 `VOCAB_DIR_NOT_FOUND: <path>`),前端展示「词库目录不存在,请在设置中配置」。
- [ ] 桌面端做**首次启动向导**(见 §1),把路径配置从 settings.json 手改变成 GUI 流程,这个问题随之消失。
- [ ] 设置页(读取/修改 vocabDir 等配置)——本身就是桌面端 TODO 中的待办,提前做。

---

## 1. 分发:让任何人下载后开箱即用

### a. Obsidian 的携带方式

Obsidian 是闭源免费软件,**不能直接打包进我们的 dmg 再分发**(许可不允许,体积也不合适)。可行方案:

| 方案 | 说明 | 评价 |
|---|---|---|
| 1. 首启检测 + 引导安装 | 检测 `/Applications/Obsidian.app` 是否存在;不存在则弹引导:一键 `brew install --cask obsidian`(若有 brew)或跳转官网下载 | 推荐。简单、合规、维护成本低 |
| 2. 安装器内联网下载 | 首启时自动从官网下载 Obsidian dmg 并挂载安装 | 体验最好但实现复杂(下载、挂载、复制、权限),可作为 1 的增强 |
| 3. 摆脱 Obsidian 依赖 | 见 §4(d):Obsidian 降级为「格式化存储」,学习交互全部在我们自己的 App 内 | 长期方向。届时 Obsidian 变成**可选**组件,本问题自然消解 |

短期采用方案 1,长期由方案 3 兜底。

### b. 安装路径与 macOS 权限

原则:**全部落在用户可写目录,不申请特殊权限,避开系统保护路径**。

- Obsidian 本体:标准位置 `/Applications/Obsidian.app`(用户级安装也可 `~/Applications`,检测时两个都找)。
- Vault(词库 md 文件):**默认放 `~/Library/Application Support/En Play/vault/`(已定,2026-08-07)**。
  - 决策理由:`~/Documents` 的定位是「用户文档」,可能被清理工具/同步策略/用户本人批量清空,词库放那里有丢失风险;`Application Support` 是应用专属数据的标准位置,无权限弹窗、不会被误当文档清理。
  - 注意放在 `En Play/` 子目录下而不是 `Application Support/vault/`:`Application Support` 是所有应用共享的,裸名 `vault` 有与其他应用撞目录的风险。
  - 代价:该位置对用户不可见,想用 Obsidian 直接打开 vault 需要在向导/设置里提供「在 Obsidian 中打开」「在 Finder 中显示」按钮;位置本身做成可配置项,高级用户可改到 iCloud Drive 等位置自行同步。
- 我们自己的数据:保持现状 `~/Library/Application Support/En Play/`(SQLite、settings.json),规范且无权限问题。
- dmg 分发注意:当前 `electron-builder.yml` 是 `identity: null` **未签名**。**已定(2026-08-07):现阶段不购买苹果开发者账号、不做签名公证**(尝试期不投入额外本金)。因此分发文档必须写明 Gatekeeper 绕过方式:首次右键 →「打开」,或 `xattr -d com.apple.quarantine /Applications/En\ Play.app`。代价是安装门槛略高,等产品验证成立后再补签名。

### c. Hammerspoon 的安装与配置(必选组件)

**已定(2026-08-07):Hammerspoon 是必选组件**,收词链路完全依赖它,App 内不做自己的剪贴板监听。因此首启向导必须把 Hammerspoon 的安装与授权作为**必需步骤**来完成(跳过则产品无词条来源,不可用)。

- **安装**:首启向导检测 `/Applications/Hammerspoon.app`,缺失则引导 `brew install --cask hammerspoon` 或官网下载。
- **权限**:Hammerspoon 需要「辅助功能(Accessibility)」权限才能监听键盘/剪贴板。首次运行 Hammerspoon 会引导用户授权——我们只需要在向导里提示这一步,无法代劳(系统限制)。
- **配置自动化**:我们把收词 Lua 脚本作为应用资源打包,首启时写入 `~/.hammerspoon/en-play.lua`,并在 `init.lua` 里追加一行 `require("en-play")`(幂等,检测已存在则跳过)。脚本职责:监听 Cmd+C(或双击 Cmd+C)→ 读取剪贴板 → 判定为英文词条 → 按固定表格格式追加到 vault 的 `english-words(-NNN).md`。
- **注意**:`~/.hammerspoon` 目录若不存在需先创建;首次写入后提醒用户 Reload Config(或脚本里调用 `hs.reload()`)。
- 接口约定不变:Hammerspoon 只写 `english-words*.md`,En Play 只读(见 `ARCHITECTURE.md`)。

### d. 翻译/LLM 接口设计

**已定方向(2026-08-07):LLM 能力统一走 Codex CLI,不在项目内引入额外的 API 消耗**(见 §2)。本节的多 provider API key 方案降级为**备选**:仅当未来要服务「没有 Codex 环境的用户」时再启用。

调研结论(2026-08,官方文档):**DeepSeek、智谱 GLM、OpenAI 三家都提供 OpenAI 兼容的 Chat Completions 接口**,认证方式统一为 HTTP Header `Authorization: Bearer <api-key>`。也就是说,接入层只需要一个 OpenAI 兼容客户端,切换 provider = 换 `baseURL + apiKey + model` 三个字段,不需要为每家写适配器。

| Provider | Base URL | 模型示例 | 备注 |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | gpt-4o-mini 等 | 需海外网络/支付方式 |
| DeepSeek | `https://api.deepseek.com`(或 `/v1`) | deepseek-chat 等 | 国内直连,便宜 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | glm-4-flash(免费档)/ glm-4-plus 等 | 国内直连,有免费模型可做默认体验 |

设计要点(备选方案启用时适用):

- **配置结构**:`{ provider: "openai" | "deepseek" | "glm", apiKey: string, model?: string, baseURL?: string(高级覆盖) }`。provider 决定默认 baseURL 和模型清单,用户只需粘贴 key。
- **key 存储**:不落明文。Electron 主进程用 `safeStorage`(底层 macOS Keychain)加密后存 `settings.json`;浏览器/开发模式回退到环境变量 `EN_PLAY_LLM_API_KEY`。**绝不写进 Obsidian vault 或 SQLite 同步范围**。
- **代码落点**:已预留——`packages/evaluation/src/index.ts` 的 `ContentGenerator` / `AnswerEvaluator` 接口。新增 `OpenAICompatibleContentGenerator` / `OpenAICompatibleAnswerEvaluator` 实现,替换现在的 Deterministic 桩即可,scheduler 等上层不动。
- **设置页**:provider 下拉 + key 输入 + 「测试连接」按钮(发一个最小请求验证 key 可用),未配置时学习页给出引导而不是报错。
- 翻译场景(收词时释义)与学习场景(情景/短文生成、答案评测)可以**分别配置 provider**(收词用便宜/免费模型,生成用强模型)。

---

## 2. Codex 接入与学习体验(d)

### Obsidian 的定位转变

确认这个判断:**Obsidian 从「学习界面容器」降级为「格式化存储层」**。理由:

- Obsidian 的交互能力(内嵌 iframe)撑不起「有意思的学习产品」——游戏化、即时反馈、动画、语音都受限。
- 它真正的价值不变:纯文本、Markdown、用户可拥有、可被任何工具(包括 Codex)读写。

转变后的架构:

```
Hammerspoon ──写──> vault/english-words*.md ──读──> En Play (SQLite 唯一事实来源)
                                                       │
                        En Play App(自研交互学习界面)──┘
                                                       │
                          Codex / LLM(选词·情景生成·评测)
                                                       └──> 报告/队列写回 vault(可选)
```

- Electron 壳 + 内置 Web 界面成为**主学习界面**(现在 Obsidian 内嵌的那套 UI 直接独立出来用,代码零浪费)。
- Obsidian 本体变为可选项:vault 只是一组 md 文件(导入来源 + 报告归档地),用户可以不装 Obsidian 应用;但 **Hammerspoon 是必选组件**——收词链路(§1.c)依赖它,没有 Hammerspoon 就没有词条来源。

### Codex 的接入方式(已定:纯 Codex CLI)

**2026-08-07 决策:直接使用 Codex CLI,不走官方 API,不引入额外的按量计费消耗。** 项目本身不复杂,Codex 订阅额度足够覆盖选词、情景/短文生成、答案评测全部场景。

| 方案 | 结论 |
|---|---|
| A. 官方 LLM API 直连 | 放弃(额外计费、要用户配 key)。多 provider API key 设计保留为备选,见 §1.d |
| B. Codex CLI 自动化 | **采用**。App 唤起 `codex` CLI:读 vault/任务文件 → 产出按约定格式落盘(md)→ En Play 导入 SQLite |
| C. 混合 | 不需要(无 A 了) |

纯 CLI 方案的设计要点:

- **预生成为主**:课程内容(情景、短文、题目)全部闲时批量生成、落盘成 md、导入 SQLite。学习时读本地数据,**零等待、零当日模型调用**——这正好契合 §3「穿针引线」的低能耗设计。
- **评测节奏(已定:准实时等待)**:客观题(拼写、选择)本地确定性评测即时反馈;开放式答案(释义、翻译)提交后**当场调 Codex CLI 出评测**,UI 呈现「评测中」等待态。需实测 CLI 延迟来确定等待体验设计(进度提示、可中断离开稍后查看结果);若实测延迟过长(分钟级),允许用户在等待页选择「先看下一题,结果稍后出」。
- **任务协议**:定义 Codex 的输入(哪张 md、哪些词、要什么产出)和输出(课程包 md 的格式约定),落在 `packages/evaluation` 的 `ContentGenerator` / `AnswerEvaluator` 接口后面,替换现有确定性桩;上层 scheduler 不动。
- **健壮性**:Codex CLI 不存在/未登录/执行失败时,学习流程必须可降级(沿用已有课程、确定性评测兜底),不能阻塞学习。

---

## 3. 产品定位(e)——讨论稿

### 一句话定位

> **把日常工作中随手复制的英文单词,自动沉淀成一个「情境化、可持续」的轻量学习闭环。**

### 问题陈述(为什么成立)

- 日常场景里遇到生词 → 复制去翻译 → 看完就忘。偶发、无上下文,形不成记忆。
- 一个个孤立单词很难学:没有上下文,记忆阻力大。
- 传统背单词产品要求「刻意安排时间」,和「偶发遇到」的真实场景脱节。

### 当前版本(MVP)范围

1. **收词**:Hammerspoon 监听 Cmd+C → 按固定格式写入 vault md(自动化、零负担)。
2. **沉淀**:En Play 导入 SQLite,形成稳定词库(已完成)。
3. **情境化学习**(核心差异化):LLM/Codex 分析每张 md(每天的词)之间的关系,把孤立的词编进同一个情景——
   - 层次:单词 → 短语 → 句子 → 短文,逐级包裹;
   - 每个学习单元是一个「有故事的小场景」,不是词表。
4. **复习调度**:D0/D1/D3/D7/D14/D21 五轮(已完成,调度器在 `packages/scheduler`)。
5. **自研交互界面**:Electron App 内完成学习全流程,Obsidian 只做存储。
6. **学习参数可配置(已定,2026-08-07)**:每日新词量、复习上限、提醒时间等产品参数不做死,设置页提供「默认模式 + 自定义模式」——默认模式给一套开箱值(如每日 6 新词),自定义模式允许逐项调整。落点:`packages/core` 的 Zod 配置 + 桌面端设置页(§0 修复计划里本就要做)。

当前版本到此为止。**不做**:听力/语音(等 Codex voice 成熟再规划)、社区、多端同步。

### 后续规划(f)

1. **学习提醒与动力**
   - 工作日定时提醒(launchd 或 App 内通知,M9 待定);
   - **自适应难度**:根据答题评测结果,LLM 自动调整下一天的情景复杂度、新词密度、复习占比;
   - 趣味延伸(远期,?):把学习内容匹配到合适视频、甚至换脸/配音做成「你的情景剧」——实现重,先记账。
2. **「穿针引线」——低能耗坚持设计**(针对「累、没时间、每天 6 个词都嫌多」)
   - 课程**预生成**:Codex/LLM 闲时把未来几天的课备好落盘,学习时打开即用,无等待、无当日决策成本;
   - **弹性剂量**:每天最小单元可调(6 词 → 3 词 → 甚至 1 个情景复习),状态机支持顺延而不「断签惩罚」;
   - **串联复习**:新情景优先复用本周旧词编故事,新旧织在一起,单位时间记忆效率最大化;
   - 失败宽容:缺卡自动顺延(周末顺延已有),报告里强调「累计覆盖」而非「连续打卡」,降低心理负担。

---

## 4. 决策记录

已定(2026-08-07):

1. **Codex 接入 = 纯 Codex CLI**,不引入额外 API 消耗(§2);多 provider API key 方案留作备选(§1.d)。
2. **Hammerspoon = 必选组件**,App 不做自己的剪贴板监听(§1.c)。
3. **评测节奏 = 准实时等待**:开放式答案提交后当场等 CLI 出评测,等待体验细节待实测延迟后定(§2)。
4. **Vault 默认位置 = `~/Library/Application Support/En Play/vault/`**,避开 `~/Documents` 被清空的风险;位置可配置(§1.b)。
5. **暂不购买苹果开发者账号**,dmg 未签名分发 + 文档写明 Gatekeeper 绕过方式(§1.b)。
6. **学习参数做成「默认模式 + 自定义模式」**,可在设置页调整(§3)。

仍开放(?):

- 自适应难度的具体规则(§3 后续规划,属于下一阶段)。
- Codex voice/听力、视频换脸等趣味延伸(远期记账项,§3)。

---

## 5. 版本号约定

采用 [SemVer](https://semver.org/lang/zh-CN/)(`MAJOR.MINOR.PATCH`),当前处于**开发测试阶段**:

- **当前版本:`0.0.1`**。`0.0.x` = 开发测试期,接口和存储格式随时可能破坏式变更,不保证数据迁移。
- 版本推进节奏:
  - `0.0.x`:开发测试迭代,每次可分发(dmg)的构建递增 PATCH;
  - `0.1.0`:MVP 功能完整(§3 范围全部落地:首启向导、Hammerspoon 配置自动化、Codex CLI 课程生成、自研学习界面),开始小范围试用;此后 `0.x` 期间 MINOR 表示新功能、PATCH 表示修复,破坏性变更允许但需在 release notes 声明;
  - `1.0.0`:第一个公开稳定版——签名公证完成、数据迁移有保障、安装无需手动绕过 Gatekeeper。
- **统一版本(fixed versioning)**:monorepo 内所有包(根 `package.json`、`apps/*`、`packages/*`)版本号始终保持一致,以根 package.json 为准;内部包不独立发版。
- **发版**:打 `v<version>` 标签(如 `v0.0.1`)推送即触发 CI(`.github/workflows/release.yml` 监听 `v*`)构建 arm64 + x64 dmg 并生成 GitHub Releases 草稿。标签版本必须与 package.json 中的 `version` 一致。

---

## 附:当前架构事实(2026-08-07 快照)

- Electron 43 + Fastify(127.0.0.1)+ React 19,SQLite(`node:sqlite`)是唯一事实来源。
- 「同步词库」实为从 vault 的 `english-words*.md` 单向导入 SQLite,纯本地,无远程同步。
- 桌面版数据:`~/Library/Application Support/En Play/`;配置覆盖走 `userData/settings.json`(无 UI)。
- LLM 接入预留点:`packages/evaluation` 的 `ContentGenerator` / `AnswerEvaluator`,现为确定性桩。
- 已导入真实词条 260;dmg 未签名、无自动更新。

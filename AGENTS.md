<!-- superpowers-zh:begin (do not edit between these markers) -->
# Superpowers-ZH 中文增强版

本项目已安装 superpowers-zh 技能框架（20 个 skills）。

## 核心规则

0. **每个新会话开工第一步：读第十四节 robocopy 铁律**（两次误删事故教训；工作区根有 ROBOCOPY-GUARD.txt 哨兵文件）
1. **收到任务时，先检查是否有匹配的 skill** — 哪怕只有 1% 的可能性也要检查
2. **设计先于编码** — 收到功能需求时，先用 brainstorming skill 做需求分析
3. **测试先于实现** — 写代码前先写测试（TDD）
4. **验证先于完成** — 声称完成前必须运行验证命令

## 可用 Skills

Skills 位于 `.Codex/skills/` 目录，每个 skill 有独立的 `SKILL.md` 文件。

- **brainstorming**: 在任何创造性工作之前必须使用此技能——创建功能、构建组件、添加功能或修改行为。在实现之前先探索用户意图、需求和设计。
- **chinese-code-review**: 中文代码审查规范——在保持专业严谨的同时，用符合国内团队文化的方式给出有效反馈
- **chinese-commit-conventions**: 中文 Git 提交规范 — 适配国内团队的 commit message 规范和 changelog 自动化
- **chinese-documentation**: 中文技术文档写作规范——排版、术语、结构一步到位，告别机翻味
- **chinese-git-workflow**: 适配国内 Git 平台和团队习惯的工作流规范——Gitee、Coding、极狐 GitLab、CNB 全覆盖
- **dispatching-parallel-agents**: 当面对 2 个以上可以独立进行、无共享状态或顺序依赖的任务时使用
- **executing-plans**: 当你有一份书面实现计划需要在单独的会话中执行，并设有审查检查点时使用
- **finishing-a-development-branch**: 当实现完成、所有测试通过、需要决定如何集成工作时使用——通过提供合并、PR 或清理等结构化选项来引导开发工作的收尾
- **mcp-builder**: MCP 服务器构建方法论 — 系统化构建生产级 MCP 工具，让 AI 助手连接外部能力
- **receiving-code-review**: 收到代码审查反馈后、实施建议之前使用，尤其当反馈不明确或技术上有疑问时——需要技术严谨性和验证，而非敷衍附和或盲目执行
- **requesting-code-review**: 完成任务、实现重要功能或合并前使用，用于验证工作成果是否符合要求
- **subagent-driven-development**: 当在当前会话中执行包含独立任务的实现计划时使用
- **systematic-debugging**: 遇到任何 bug、测试失败或异常行为时使用，在提出修复方案之前执行
- **test-driven-development**: 在实现任何功能或修复 bug 时使用，在编写实现代码之前
- **using-git-worktrees**: 当需要开始与当前工作区隔离的功能开发或执行实现计划之前使用——创建具有智能目录选择和安全验证的隔离 git 工作树
- **using-superpowers**: 在开始任何对话时使用——确立如何查找和使用技能，要求在任何响应（包括澄清性问题）之前调用 Skill 工具
- **verification-before-completion**: 在宣称工作完成、已修复或测试通过之前使用，在提交或创建 PR 之前——必须运行验证命令并确认输出后才能声称成功；始终用证据支撑断言
- **workflow-runner**: 在 Codex / OpenClaw / Cursor 中直接运行 agency-orchestrator YAML 工作流——无需 API key，使用当前会话的 LLM 作为执行引擎。当用户提供 .yaml 工作流文件或要求多角色协作完成任务时触发。
- **writing-plans**: 当你有规格说明或需求用于多步骤任务时使用，在动手写代码之前
- **writing-skills**: 当创建新技能、编辑现有技能或在部署前验证技能是否有效时使用

## 如何使用

当任务匹配某个 skill 时，使用 `Skill` 工具加载对应 skill 并严格遵循其流程。绝不要用 Read 工具读取 SKILL.md 文件。

如果你认为哪怕只有 1% 的可能性某个 skill 适用于你正在做的事情，你必须调用该 skill 检查。
<!-- superpowers-zh:end -->

## 十二、Obsidian 知识库管理

Vault 路径：`E:\投资体系\`

### 目录规则
- `raw/`：原始素材，Codex 只读不写
- `wiki/`：Codex 维护的知识库，每个主题一个 .md，用 [[双链]] 互连

### 触发命令
- "整合到Wiki" → 扫描 raw/ 新增内容，创建/更新 wiki 条目，建立双链
- "知识库问答 {问题}" → 先搜本地 wiki，不足再外部搜索，结果存回 wiki
- "知识库健康检查" → 找矛盾观点、填知识空白、更新孤儿节点列表

### 工作流
1. 用户通过 Web Clipper / 手动放入 raw/ 新素材
2. 用户说"整合到Wiki" → Codex 分析、提取要点、写入 wiki、添加 [[链接]]
3. 用户提问 → Codex 先查 wiki/，答案存回相关条目
4. 定期健康检查 → 发现矛盾标记 ⚠️、空白标记 🔍、孤儿节点

## 十三、图片/截图读取能力（GLM-4V-Flash 视觉模型）

当用户发送图片（image.png、截图等）而当前模型不支持图像输入时，**必须使用视觉脚本读取**，不要拒绝。

### 脚本
- 路径：`E:\CC-HAHA\workspace\024_永久VPN\vision.py`
- API Key：已配置在 `E:\CC-HAHA\workspace\024_永久VPN\.env`（ZHIPU_API_KEY）
- 模型：`glm-4v-flash`（智谱开放平台）

### 用法
```bash
cd "E:/CC-HAHA/workspace/024_永久VPN" && python vision.py "<图片绝对路径>" "请完整描述截图内容，特别是报错信息/红色文字/弹窗内容，原文逐字摘录"
```

### 规则
1. 用户发图但本模型无法直接读取 → 先用此脚本读图，再回答
2. 找不到图片路径时，先查 `C:/Users/Administrator/Pictures/Screenshots/`（Windows 截图目录）最近文件
3. 图片可能粘贴为 image.png 附件 → 在 Temp/会话目录搜索
4. 读取后如涉及项目报错，结合代码定位修复

## 十四、⚠️ robocopy 事故教训与代码真源纪律（2026-08-15 事故后强制生效）

### 事故经过
2026-08-15 执行 `robocopy <源码目录> <工作区根> /MIR` 想"同步代码"，但 `/MIR` 是**镜像**语义：
会**删除目标中所有源里没有的内容**。工作区根是源码目录的父目录，导致：
1. 工作区根 010-021 等 12 个未跟踪工作目录被**永久删除**（robocopy 删除不进回收站）
2. `022_股票监控项目\stock-monitor-v9.9\stock-monitor` 源码目录被递归清空（v9.146/v9.147 未提交改动一度丢失，靠本会话上下文重建）
3. 回收站 8/11 的 12 个 010-021 目录项证明：**此错误 8/11 已发生过一次**

### 铁律（违反即事故）
1. **永远不要对工作区根（E:\CC-HAHA\workspace）执行 `robocopy ... /MIR` 或任何镜像/清空类操作**。`/MIR`、`/PURGE`、`/MOVE` 一律禁用。
2. **git 仓库根（工作区根）= 唯一代码真源**。开发直接在 `E:\CC-HAHA\workspace` 的 server/src/docs 上改，改完 `git add/commit/push` 一步到位。
3. **废除"源码目录双轨制"**：`022_股票监控项目\stock-monitor-v9.9\stock-monitor` 不再是开发副本（本次事故后已空置），不得再往里面写代码、不得再从它同步。
4. 同步/部署一律走 git：`git push origin arena/019fb619-stock-monitor` 后，需要时在目标机 `git pull`。
5. 提交前必须验证：`npx vitest run --dir src` + `npx vitest run --dir server/lib/__tests__`（注意：vitest 默认扫整个工作区，会误跑 027 等项目，必须 --dir 限定）+ `npx tsc --noEmit` + `npm run build` + pm2 重启 + curl 实测 + **版本三件套**（`src/lib/version.ts` 的 APP_VERSION、`index.html`/`docs/index.html` 的 `<title>`、`CHANGELOG.md` 顶部条目三者同步，v9.148.1 起强制）。
6. pm2 服务入口：`E:\CC-HAHA\workspace\server\index.js`（`npx pm2 start server/index.js --name stock-monitor --cwd E:\CC-HAHA\workspace\server`）。MCP server 入口：`E:\CC-HAHA\workspace\server\mcp\index.js`。

### 本次事故恢复要点（如再遇删库/删代码）
- git 基线（v9.145.0 之前）完好：`git checkout -- <path>` 可恢复被删跟踪文件
- 数据库（PostgreSQL）独立于文件系统，kline_daily/信号/决策表不受影响
- 未提交改动只能靠会话上下文重建——教训：**每次会话结束前必须 commit + push**

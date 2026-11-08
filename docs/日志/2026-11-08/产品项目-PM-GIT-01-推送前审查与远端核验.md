# 产品项目 / PM-GIT-01 / 推送前审查与远端核验

日期：2026-11-08（Asia/Shanghai）
状态：待验收（推送、远端核验和对应 CI 均完成；未合并或部署）

## 范围与版本

用户授权将现有内容先独立审查、修复并复查，再推送到现有仓库的同名工作分支；不合并 main、不强推、不部署。本轮只报告今后 review/hook/分支保护设置方案，不修改账号、权限、hooks 或保护规则。

起点为 `codex/workspace-foundation` 的 `5356f8828275aa7e34a259db03269ae3e8509fb6`，远端为 `louisvotton2-code/HD_Auto_Export`。推送前只读核验：远端目标分支尚不存在，main 仍为 `06b1c4a2731c4b0e0e4ce856de09c9584517c91a`，没有分歧。工作树只有原有 `.vscode/settings.json` 未跟踪，保持不提交。

## 独立审查与修复

- Reviewer `migration_review` 核对原迁移、工作区守卫和验证证据与 5356f88 一致；补审提交中迁移前已有的官网首页／外壳、车源与公开字段、目录详情、noindex、外部链接与聊天草稿、相关浏览器测试。
- 发现 1 项 P2：演示电话表单依赖 JS 阻止提交，保留 `name="phone"`，无 JS／hydration 前原生 GET 会将号码带入 URL、历史和访问日志。既有测试仅检查 POST，遗漏此路径；本轮决定修复后再推送。
- 原作者 `workspace_guard` 仅移除该无提交用途的 name；新增三语×按钮／Enter 的 6 项无 JS 回归及 3 项正常 JS 回归，并强化已有用例。测试使用合成号码，检查 URL、请求体与请求头；不向真实联系人发送消息。
- 283 个已提交文件的禁止路径与常见凭据标记扫描通过。初次辅助扫描因 Git 中文路径引用解析失败，改为 NUL 分隔后完整通过；这不是业务测试失败，也不是全面凭据审计。原有私有归档、真实环境、数据库与生成文件均未入提交。

## 本地验证

- 环境：Node 24.22.1、pnpm 11.25.0、本机 Chrome，预览 127.0.0.1:3317。
- 先在旧 out 上执行新增 9 项测试：6 项无 JS 测试如预期失败，真实捕获 GET 与 Referer 中的测试号码；3 项 JS 测试通过，证明测试能区分缺陷。
- 修复源码后执行根 `pnpm check`：27 工作区夹具、6 模块夹具、类型检查、真实边界扫描和 634 单元全部通过。
- 重新 `pnpm build` 构建 96 页通过；对新成品运行 home-vehicles 全文件，19 项通过，其中 6 项此前失败的无 JS 回归全部通过。没有在本地重复无关的全部浏览器矩阵；最终提交的远端 CI 已运行完整矩阵，结果见下节。
- 修复与测试保存为 `dd0230914d40b8b35a2763b553d7268778c97b3b`，父提交为 5356f88，仅包含两个已审代码／测试文件；独立 Reviewer `migration_review` 已核对最终提交与已审 diff 一致，P2 关闭，本次范围无剩余确认问题。操作日志与进度摘要在本地单独记录，未混入待推送代码提交。

## 推送和 CI

已执行普通 `git push --set-upstream origin` 的显式同名分支推送，退出 0，远端创建新分支并建立 tracking；没有强推、合并或部署。随后独立 `git ls-remote` 核对：

- `refs/heads/codex/workspace-foundation` = `dd0230914d40b8b35a2763b553d7268778c97b3b`。
- `refs/heads/main` 仍为 `06b1c4a2731c4b0e0e4ce856de09c9584517c91a`。
- 新提交包含共同基线 5356f88 和此次隐私修复。操作日志与进度摘要是推送后的本地记录，未追加提交／推送；`.vscode` 保持未跟踪。

[对应 CI 运行](https://github.com/louisvotton2-code/HD_Auto_Export/actions/runs/42393426089) 的 head_sha 与 dd02309 一致，event=push，最终 completed / success。运行中的 `verify` 检查来源为 `github-actions`；27 工作区夹具、6 模块夹具、634 单元、96 页构建和 153 Chrome 浏览器测试全部通过（浏览器 3.0 分钟）。当前唯一 `quality.yml` 只跑检查、构建和浏览器回归，没有部署步骤；推送不改变服务器。

## 后续审查设置建议（未实施）

实际查询：没有 core.hooksPath，.git/hooks 只有样例；main 的 protected 为 false，仓库规则集与对 main 生效的规则均为空。现有 CI 在 push／PR 后执行测试，并非独立审查审批。

建议本地先按完整 SHA 记录独立 review、相关检查、修复和复查，再推送；pre-push 可检查实际待推送 refs、SHA 与证据匹配、运行快速检查，用于防止误操作。hook 可被跳过或修改，作者自行写出的通过标记不证明独立审查。[Git hooks](https://git-scm.com/docs/githooks#_pre_push)、[Git push --no-verify](https://git-scm.com/docs/git-push#Documentation/git-push.txt---no-verify)。

远端建议保护 main：要求 PR、已核验名称的 CI 检查、独立审批，新改动使旧审批失效，限制绕过、强推与删除；落实前确认独立审批身份，作者不能批准自己的 PR。PR 检查在分支首次上传后发生，主分支保护不能保证所有分支上传前已审。当前不引入持有唯一推送权限的发布服务。[工作流事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)、[分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)、[审批限制](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)。

## 交接

此轮源码推送与业务／视觉验收分别记录。未核验 Safari、人工视觉、真实消息送达、素材对外授权和服务器环境；未实现后台或 API。部署须另按授权与实际环境执行。51 份公开 Markdown、381 条本地链接／锚点、可达性与空白检查通过；操作后记录保留在本地，未改变已审查并推送的源码 SHA。

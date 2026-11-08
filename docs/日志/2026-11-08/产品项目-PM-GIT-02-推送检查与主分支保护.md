# 产品项目 / PM-GIT-02 / 推送检查与主分支保护

日期：2026-11-08（Asia/Shanghai）
状态：进行中（保护已配置、本地工具与审查通过；正在验证最终交付版本）

## 范围与版本

用户要求实际配置本地 pre-push、远端 main 保护，并写入所有 Agent 的公共入口。用户随后明确不安排其他 GitHub 审核账号，由专门 Agent 在本地独立审查后交付。因此 main 保留 PR 与 CI 要求，GitHub 正式批准数为 0，不创建／邀请账号，不把子 Agent 报告当 GitHub 用户审批。

起点为 `codex/workspace-foundation` 的 `dd0230914d40b8b35a2763b553d7268778c97b3b`。保留上一轮未提交的 PM-GIT-01 操作日志与进度摘要，本轮将其与规则实现一并整理为新的交接版本；`.vscode` 本机设置继续排除。用户未授权合并 main 或部署，本轮不做这些操作。

## 实际变更

- 根 AGENTS、接手导航、README、贡献规范与项目 Skill 统一要求：开工核验 hook、实现者自测、独立 Reviewer、修复复查、最终 SHA 核对、绑定测试／报告后推送。详细操作只在 [测试与审查](../../协作/测试与审查.md#推送前检查) 维护。
- 仓库版本化 pre-push loader 和 Git workflow 工具，安装到 Git common-dir 的持久入口；不覆盖其他自定义 hooks，新 clone 显式安装，linked worktree 共用配置，旧分支缺检查脚本时拒绝推送。
- 验证命令通过实际检查生成测试记录；独立报告登记绑定完整提交、基线、内容哈希。记录放 Git 私有目录，避免报告与其自身 commit 的循环。逐 ref 检查实际目标 SHA，不能用 HEAD 证据代替另一提交。
- 不自动调用收费 AI review 服务，不引入凭据或新依赖；本地报告不是身份认证，hook 可被拥有本机控制权的人绕过，公共规则禁止 Agent 自行绕过。

## 远端 main 保护

通过现有 GitHub API 查询确认只有 owner 协作者、原 main 无保护，成功 CI 的 verify 来自 GitHub Actions（app_id 15368）。参数版本化为 [.github/main-protection.json](../../../.github/main-protection.json)，实际写入后再次 GET 并逐项断言：

- required PR 对象存在；正式批准数 0，require_last_push_approval=false；按用户决定无需第二账号。
- strict=true，必需检查 verify，来源限定 GitHub Actions app_id 15368。
- enforce_admins=true；必须解决审查对话。
- 禁止 force push 和 deletion；未锁为只读，未增加 bypass allowance。

首次 PUT 同时包含旧 contexts 与新 checks 字段，被 GitHub API 以 422 参数互斥校验拒绝；随后 GET 仍为 404 Branch not protected，确认未执行。根据该新证据移除 contexts，仅保留 checks，重试一次成功，读回核验通过。这不是自动批准审查拒绝，也没有通过降低保护规避错误。

没有尝试向真实 main 写入、强推或删除来测试限制；远端结论来自 API 配置读回。主分支保护不能认证本地 Agent 报告，也不能拦截任何功能分支首次上传前的所有遗漏。

## 本地验证与审查

- 原作者 workspace_guard 完成 31 项临时 Git 仓库夹具；worktree stdin 测试随后补强并定向 2/2 通过。实现仅新增守卫、loader、测试与根脚本，没有业务源码或运行依赖变更。
- 独立审查 migration_review 发现并复测关闭两项 P2：新分支必须核对实际 push URL，不能借另一个远端的基线；worktree 测试不能依赖 git hook run 隐式转发 stdin（它实际丢弃了输入），已改为真实 loader 输入及负例。
- Reviewer 另建本地 bare 仓库，用真实 git push --dry-run 验证缺证据、直推 main、多 ref 中混入未验证提交的拒绝，以及已验证新分支／非 HEAD 的允许；bare 仓库未变化。另以确定性假 pnpm 测真实 CLI：子命令失败不写通过，全部实际返回 0 才记录。以上只是工具夹具，不冒充官网业务检查。
- 本仓库实际执行 hooks:install 和 hooks:check 成功；安装位置为 Git common-dir/hd-auto-hooks，并启用本地 hooksPath。读取实际安装入口、传入待推 ref 后，缺记录与直推 main 均退出 1，错误原因正确。最初尝试 git hook run --to-stdin 被本机 Git 以不支持参数拒绝，未当作拦截成功；改用安装入口直接注入 stdin，并结合 Reviewer 的真实 Git dry-run 验证。
- 原作者的测试中曾出现 Node 启动延迟，单独探针随后自行恢复；未终止其他任务进程，最终夹具通过。使用 Node 24.22.1 与 pnpm 11.25.0。
- 维护文档本地链接／锚点、围栏与空白检查、Skill 元数据检查通过。实际最终 SHA、真实 verify:push、推送和对应 CI 结果在操作后登记；不会把上轮数量复制为本轮检查。

文档接手审查由 handoff_docs 完成，已修正“每个提交”与“每个待更新 ref 目标 SHA”的区别，补充非 HEAD 验证应在对应 worktree／检出版本执行。OpenAI 官方文档确认 AGENTS 在启动时构建指令链；旧会话需要重新读取，不能承诺文件变更会自动广播到所有既有对话。

## 交接

新 Agent 从包含本轮工具的共同工作分支开始，开工核验 hooks；主分支尚未合并当前多应用基础。阶段业务与视觉验收仍按原任务推进。Git 保存、推送、实际远端保护与生产部署分别记录；不会自动合并、部署或监控全部对话。

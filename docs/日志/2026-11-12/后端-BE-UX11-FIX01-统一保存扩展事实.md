# 后端 / BE-UX11-FIX01 / 统一保存扩展事实

日期：2026-11-12（Asia/Shanghai）
状态：实现、自测及独立复查通过，交付补丁供组合联调；未切运行环境。

## 问题与范围

AD独立审查发现：后台统一工作区允许编辑代系和驱动，但`0540d6bcc40ec26048a31e2eb9cdac6becd37132`的bundle保存额外强制facts与旧值相同，合法编辑固定409。原BE回归覆盖译文原子保存但没有覆盖facts编辑，不能以旧测试通过否认该缺陷。PM确认作为组合验收阻塞P2修复。

沿`codex/be-ux11`、`docs/private/be-ux11-worktree`从0540d6b实现；开工工作树干净、hooks检查通过，根dirty及旧树保留。生产代码只移除错误的facts相等门槛，保留车辆版本、展示revision、权限和来源绑定校验，复用现有`applyLocalizationInput`处理facts与翻译；没有新增字段、迁移或外部调用。

## 正式行为

现有`PUT /api/v1/admin/vehicles/:id/translation-bundle`同事务保存`localization.facts.generation/drivetrain`、正文与展示译文。客户端保留最新GET字段的源身份，不自行创建新generation ref。新增代系由服务器返回中文原文和缺失英俄；改名或身份改变保留旧人改文本但标stale；清空代系使该ref退役。只改驱动不重译代系。成功响应是权威工作区，200只表示保存完成，不表示可发布。

版本冲突、伪造来源绑定或额外ref仍409；未知facts字段400。错误请求和末尾SQL／审计故障都不半保存。代系事实和文字使旧预览失效；旧公开快照直到新译文就绪、重新预览确认并发布才改变。无需拆成两次保存或将事实改成只读。唯一契约补充在[车辆接口第18节](../../开发/车辆接口.md#18-be-ux11-配置多语工作区与真实历史)。

## 验证

- 修改前新增真实HTTP/SQL回归重现409：合法facts编辑在末尾故障注入前即被错误拒绝。该失败轮单独保留。
- 修复后完整`translation-workspace.test.ts`及`publication-preview.test.ts`：**29/29通过，0跳过／0取消**。覆盖正文+facts同事务、末尾审计失败整体回滚、未知facts拒绝、旧ref伪造拒绝、新ref返回、旧计划失效、驱动不重译、代系变更stale／删除退役、两个并发请求仅一个成功、三语旧快照保留及真实图片/确认/发布后的新事实投影。
- `pnpm --filter @hd/api check`：类型检查及**188/188单元通过**；`pnpm --filter @hd/api build`通过；`git diff --check`通过。
- 本补丁未改contracts源码、迁移、鉴权入口、FE或AD代码。没有重跑无关前端或整套15文件DB；0540d6b的167/167记录仍只属于原候选，本补丁以实际29项受影响回归验收，不能把两者加总。
- 两个测试文件各建独立随机本机库，使用已有Unix socket，finally清理库／媒体；翻译为模拟提供器，报告/供应商网络禁止。未改真实20+200、3363或Ali配置。

独立Reviewer `catalog_cache_audit`对六个文件的本轮delta审查PASS，独立纯函数边界5/5通过；数据库29项及完整API188项由实现者执行，Reviewer核对证据，不冒称其本人重跑。

私有证据位于工作树`docs/private/be-ux11/facts-fix/`，包含修复前失败输出、修复后专项、API检查与构建输出。独立报告为`docs/private/be-ux11/facts-fix-review.md`，绑定精确补丁SHA交AD/PM/OPS。未推送或部署。

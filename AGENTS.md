# 项目协作说明

## 开始工作

1. 先读 `docs/开发进度.md`，以其确定当前阶段和真实可用能力。
2. 再读 `README.md`、`docs/模块与维护指南.md`、`docs/技术架构.md`、`docs/开发交接规划.md`、`docs/计算器参考规则研究.md`。
3. 遵循当前用户的分期要求，不因为长期规划存在就一次实现所有模块。

## 工作边界

- 页面消费计算模块的公共接口，不在 React 组件中复制税率和公式。
- 计算核心不得依赖 React、网络、系统当前时间或翻译；日期与汇率显式传入。
- 未核验公式只能作明确标记的参考预览；缺失规则/费用不得当 0 或宣称完整落地价。
- 三种语言必须使用同一套语义 key；语言、交易币种、目的国互相独立。
- 不引入未经授权的外部车源接口、支付、账号、生产部署或后台。
- 本目录是 HD Auto Export 独立仓库；不要在父目录的其他项目仓库中提交本站文件。
- Git 推送不等于服务器部署。密钥、真实环境文件、数据库、服务器备份和 `docs/private/` 运维账册不得提交；按 `CONTRIBUTING.md` 和实际部署记录维护。

## 持续交接

更新功能时同步更新 `docs/开发进度.md` 的阶段、任务状态、验证结果和下一步。改变关键技术方案时记录原因。完成回合前检查文档与代码一致；不要把未执行的检查写成通过。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

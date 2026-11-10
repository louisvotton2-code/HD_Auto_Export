# 独立审查 / FE-UX-02 / 正式车辆文案

日期：2026-11-08（Asia/Shanghai）。Reviewer：`/root/fe_ux02_perf_baseline`。实现作者为另一Agent，本Reviewer没有修改这8个应用文件；只读审查、运行隔离纯单元及写入本报告。

结论：**限定源码范围未发现新的可确认P0／P1／P2，可进入新成品验证**。不是全站、真实内容或用户视觉验收，也不绑定未来Git提交。

## 版本与独立范围

共同HEAD为 `61dc7414b20a395d1d09e906a49d974763b3cce7`，待审内容在未提交工作树。快照 `/private/tmp/hd-fe-ux02-formal-copy-review-source.json`，SHA-256为 `0e5bbc658411796c2b131343634e5cec54b0f852880c9db90281624a3991f57a`。

| 文件（相对 apps/web/） | SHA-256 |
| --- | --- |
| src/modules/vehicles/public-messages.ts | `cab533014c2f96fdc648f2d050561e21c7522ed697a72dcced39ab75c80ed70f` |
| src/modules/vehicles/public-presentation.ts | `a0493fb73f461cf6bc291005d08188f00fe91fe196fc4855de3121f0527a124f` |
| src/modules/vehicles/detail-content.ts | `dbc578e9c21430dd82aee4766d26ed7eedf369c3fafd30e86983b0ae061754f5` |
| src/modules/vehicles/ui/public-vehicle-card.tsx | `7f63cf8b56f6d03a7bfa2664ae21626387a1c04aa172a1f45ead2b6176cc24b3` |
| src/modules/vehicles/ui/public-vehicle-detail.tsx | `86dad6f994bf235c66b4bf030b3f6a37b44f9b2118f733a429ea98d1eab4a412` |
| src/modules/vehicles/ui/public-vehicles.module.css | `f8607ec0b3ed776b159e3cc68b95023cc805ca37faedf02cb0479f7b85754937` |
| src/modules/vehicles/ui/public-detail.module.css | `debce65c9d97cc293f281ab9dc173d76d89d7b27c0ac959a965e0512baea3b87` |
| src/shared/lib/vehicle-contact.ts | `450a85f21ccf14890a2c8a1049a61550d5a88df66d3fc59e6bdf2baf87663d81` |

本Reviewer编写／迁移的fixture、freshness和rate-limit浏览器测试不在本次独立审查范围，另交root／其他Reviewer。导航数据层、429冷却和首页服务区也不由此8文件结论代签。

## 核对结果

- **库存语义**：三语 `availability.unknown` 都为空字符串，展示函数直接按真实availability取值，不通过source推导可售。卡片／详情仅在fresh且状态文字非空时渲染状态；unknown没有库存提示，也没有替换成Available／可售／В продаже。reserved、sold保持独立；真实已售仍显示已售并引导类似车辆。
- **来源与品牌**：固有demo／external说明、来源板块和来源信息tile已移除，不把它们换成“HD自有库存”“已核验”或认证声明。HD侧栏称出口／车辆咨询，与业务联系身份一致。详情tile现为咨询编号与里程两格，CSS同步两列，没有保留空来源格。
- **客户草稿**：两种builder的固有演示标签已移除；当前公共DTO草稿不输出source平台／原始挂牌／治理说明。unknown时直接省略库存行，真实available／reserved／sold仍来自DTO本身，已售使用类似车辆请求。两个聊天平台继续使用配置账号，包含正确车号、稳定ID及对应locale详情路径，只预填，不发送。
- **价格与事实**：asking／reference／on_request三类语义仍在，原币金额保留，未硬转USD或造汇率。待询价不变0；缺失制造日期、里程等显示“—”，没有用modelYear补制造日期。明确的0里程仍为0公里／0 km／0 км，和缺失值区分。参考费用计算说明仍要求补充缺失参数，不制造完整落地价。
- **三语与安全**：中英俄key受同一类型约束，库存空值、真实已售、咨询、参考价等语义一致。详情标题／描述由React按文本输出；联系草稿百分号编码，公共detailPath必须匹配locale和稳定ID，未引入后台信息、任意站点咨询链接或新请求。
- **内容边界**：这批源码移除的是固定UI和草稿治理标签。API提供的title、description、image alt、price inclusions及车号仍按实际公开字段显示，不以正则篡改车辆事实。本报告没有读取真实API，不能证明PM／PA已清理全部公开正文或两条demo已下架；须以其真实数据读回记录另验。

## 实际检查

1. `pnpm hooks:check`：通过。
2. `pnpm --filter @hd/web exec vitest run src/modules/vehicles/public-presentation.test.ts src/shared/lib/public-vehicle-contact.test.ts src/shared/lib/vehicle-contact.test.ts`：3文件21／21通过。
3. 独立临时矩阵 `/private/tmp/hd-fe-ux02-formal-copy-review.test.ts`，命令 `pnpm --filter @hd/web exec vitest run --config /private/tmp/hd-fe-ux02-formal-copy-review.config.mjs`：修正Reviewer测试预期后9／9通过。覆盖三语external unknown不产生可售／库存行或平台标签、真实sold保留类似车辆和CNY参考价格、null事实与明确0值区分。
4. 首次矩阵7／9：Reviewer把三语明确0里程均误写成英文 `0 km`，而产品正确返回中文公里和俄文км；仅改临时测试预期后重跑9／9，没有修改应用，不将此测试错误登记为产品缺陷。
5. TypeScript内存AST语法解析6文件、PostCSS解析2文件：通过。不emit、不写Next类型、不build；语法检查不冒充完整类型或运行成品验证。

没有HTTP／浏览器／真实服务读取，没有安装、修改数据库、启停服务、真实发送消息、Git提交、推送或部署。当前14项新浏览器测试的加载发现是另一作者切片记录，不作为本报告独立运行的成功证据。

## 后续验收

root提供新成品后核对三语卡片／详情／草稿及手机布局，PM／PA核对真实正文与demo下架；Back／Forward最新数据、激活静默和429透传冷却由其负责的独立审查与隔离浏览器验证覆盖。首页新版服务FAQ／WhatsApp预填／hover另有作者，ready后再追加审查，不能预先算入本报告。

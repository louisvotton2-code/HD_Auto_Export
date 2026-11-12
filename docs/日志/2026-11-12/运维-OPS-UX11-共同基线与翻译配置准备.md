# OPS-UX11 共同基线与翻译配置准备

日期：2026-11-12（Asia/Shanghai）。范围仅本地共同Git基线、依赖协调和非秘密配置诊断，不推送、部署或更改3363。

## 来源与整合

共同分支为 `codex/ux11-base`，持久工作区为 `docs/private/ux11-base-worktree`。最终完整SHA由OPS保存提交后回报；本文记录来源和实际检查，不以单端旧报告冒充新整合验收。

| 范围 | 精确来源与要求 |
| --- | --- |
| BE原始应用 | `7abc04c0bbd6623db54efb1c698a104770c7e9a5`；src与migrations保持 |
| BE证据/文档 | `33cc62d6228f6f7702e4a5ef4ac5f7b9e9324145` → `1bbe86c766ba15aed7ee1c7179ce94d9d0b6552a`；apps/api整树和contracts采用1bbe，与AD中的同补丁内容一致 |
| FE | `9099d70e713b43e30abbbf83f73f026b4ead16f1`，apps/web整树等于应用`123f7b91fa641b7944d96baa17345e15359e1146`，保留UX09祖先`0b8e56576ec43b850cef68043a482cc814ba8e68` |
| AD | 应用`6f49850ee72efebbd8d52030aa9c9090ecbb6589`、测试`5016e08882c239cdcb05f5f52ddaad0bc830dd6c`、文档`88e86a4da9c74b35fe2e3ca1ed6b8aa1252ce667`；src/package不变，仅下述test-only修正 |
| contracts | 三端原始整树均为`0f1a8d465e8393f46f535c0a5628187189f67277`，本基线保持其内容 |
| 根包/保护 | package/workspace/scripts/AGENTS/CI保持provider`0dc4fb94ebb0b9e2fcfb2c7719022676488d5a51`的已审版本；含3363单入口与hooks要求 |
| 锁文件 | 完整采用AD88e，唯一对BE/FE锁的差异为AD importer中的3行dayjs1.11.23，包/snapshot原已存在；未重新解析或修改锁 |

从AD88e开始真实merge原始BE1bbe，按BE职责解决两份后端文档冲突；中间合并`ec4c78f1fc084cca605e542b596355dc091e8186`经独立review后保存。再真实merge FE9099；三份共享后端文档及早期API适配按BE完整实现保留。未重复cherry-pick四组已存在的BE合同/API补丁。各角色最终日志和文档合并保留；仅按PM明确允许复制一份PM-UX11日志，并在本工作区当前进度加本轮入口，未打包根dirty资料。

## 基线额外test-only修正

首次`pnpm check:workspace`在旧AD `tests/live-rate-window.test.mjs`的data URL动态import处失败。没有放宽扫描器。仅将该测试已转译的无依赖辅助函数改为CommonJS输出并由Node内置VM在内存加载；保留全部断言、原TS辅助函数、Node20可用API和运行应用源码。实际测试运行使用当前Node24.22.1，未声称另跑Node20。PM已明确允许此一项测试加载修正；AD与其他来源的唯一额外代码差异限于该测试文件。

## 已执行检查

- 新工作区`pnpm hooks:check`通过；根Git工作流保护未替换或关闭。
- `pnpm install --offline --frozen-lockfile`成功，0下载，锁文件保持AD来源原字节。依赖和生成目录留在独立工作区，不覆盖运行产物。
- 首次workspace边界失败原日志保留；修正后28检查及471代码文件静态边界通过。原检查规则未改。
- `pnpm check:git-workflow`31项通过。
- 根`pnpm typecheck`通过：contracts构建、API/admin类型和web typegen/类型均通过。
- `node --test apps/admin/tests/live-rate-window.test.mjs`3项通过，无原断言删除或语义放宽。
- 各应用/契约/锁文件来源逐路径核对，AD仅上述测试文件例外。最终差异、独立review和完整SHA由OPS私有证据记录绑定。

本轮未构建新应用产物、未运行DB/浏览器/业务全量、未发真实翻译/供应商请求；原3363和运行数据保持不变。原三端R3六项+R4一项是既有运行组合证据，不算本次重新执行。

## 交接方式与边界

BE唯一维护apps/api、contracts与车辆接口；AD维护apps/admin；FE维护apps/web。锁文件/根脚本由OPS唯一协调，不并发安装或自行重解析锁。BE新工作区已由OPS按其现1bbe锁串行完成离线冻结依赖准备，无源码或锁改动；合共同基线后如需依赖更新再串行协调。

各端先保存自有改动，再合入完整共同SHA；保留原分支与工作树，不对dirty工作区硬reset，不再次挑拣本轮已具祖先的BE合同。新UX11合同须从共同基线集成，不能只拿三端某个旧HEAD当完整组合。源码基线不是新3363运行版本，也不授予推送/生产或真实调用。

## 翻译配置准备

私有诊断和恢复方案位于忽略目录`docs/private/ops-ux11/翻译配置只读诊断.{json,md}`。既有文件正规、0600，AK字段只记存在布尔值；当前region仍ap-southeast-1，无可靠site/endpoint显式metadata，账号站点/有效性/剩余额度未知。旧国际通用记录与本轮中国站意向分开，不凭密钥、region或历史成功推断当前免费权益。

当前wrapper不加载该env，provider显式disabled、无env继承、Fetch全拒绝；synthetic目录模式还禁止真实翻译，不能仅加入key就启用。BE需提供明确受审的本机翻译模式/费用计划与持久预算守门，AD一次费用确认、新组合替身验收后，由PM同组切换再加载既有私配并限选定阿里主机。不能为启翻译而自动改成供应商同步模式。

真实调用本轮为0，未验证供应商、余额或免费可用量。配置可恢复与实际调用成功是不同状态，现3363继续disabled。

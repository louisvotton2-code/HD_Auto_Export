# 前端 / FE-UX-12 / 计算器下拉文字居中

2026-11-13（Asia/Shanghai，任务于12日开始）。范围为用户指出的车辆价格右侧USD、进口人类型和细分动力类型的文字垂直对齐。

## 版本与修复

- 从冻结FE `634f0076d402e9de394a8ecbb77d7fa269d2ff8b` 建立 `codex/calculator-select-align`，工作树 `docs/private/fe-ux12-worktree`。保留原FE-UX11源码／成品和根目录他端改动；hooks检查通过。
- 在当前3363的吉尔吉斯斯坦计算器实际复现：支持 `appearance: base-select` 的Chrome把闭合select排成flex，默认 `align-items: normal`，文字靠顶。货币控件28px，另两个42px，外层flex只居中控件盒，不能居中内部文字。
- 仅在 `reference-calculator.css` 增加同条件 `@supports`，限定 `.calculator-reference.calculator-simple .input-wrap > select`，明确flex并 `align-items: center`。覆盖同表单其他同类下拉，不改全站控件、picker／option、字号、行高、控件高度、字段事件或税费公式。不支持该浏览器能力的分支保持原样。

## 验证

- 顺序构建contracts及官网standalone通过；新BUILD `xibphihZChTOt9uCfM7pb`，Node24.22.1／本机Darwin arm64，构建与运行公开地址均为3363、indexable=false。
- 在独立3521 fixture／3522正式成品上执行既有 `calculator.spec.ts`，**48／48 Chrome通过**，无重试／跳过。覆盖七国、三语窄屏、币种转换、进口类型、报价／复制、默认值和独立参考金额。纯CSS修复未另建镜像实现的单元测试，也未将历史单元数计作本轮通过。
- 另用真实Chrome验证中文1440／英文390／俄文320的3个下拉：内部对齐均为center、仍为28／42／42px；真实键盘打开货币列表并选CNY后切回USD，另选企业进口和PHEV均生效，无页面错误／横溢出。实看9张控件截图及英文手机上下文，长文可读。
- 初次英文两张局部截图受页面滚动和底部悬浮条影响，截到了结果区，未记作正确证据；私有采集脚本改为瞬时居中并等待两帧后重截，最终截图已核对到实际下拉控件。这是截图取证修正，没有因此修改产品滚动或浮层。
- 证据在根 `docs/private/fe-ux12-evidence/`：`before.json`、`after.json`、修前／修后截图、`build.log`、`calculator.log`，不提交。独立Reviewer已完成源码及修前后初审；最终提交及报告绑定在交付索引。不将Chrome结果声称为Safari真机验证。

## 交接与运行边界

- 本候选只包含1份CSS和本轮日志／角色摘要，适合PM／OPS单独集成，不依赖新的API或后台功能。若先基于当前旧FE修复，应从受审源码应用相同小改后重建验收，不能直接改冻结产物。
- 临时3521／3522在验证结束后已释放。PM当前在规划统一验收／清理／缓存及发布，本轮只交接此小候选纳入统一版本，不另启动当前3363构建或直接切换入口。未推送、合并、部署生产、访问供应商或调用付费接口。
- 本机成品用于验收；Linux部署按目标平台及最终配置重新构建。后续外部推送仍须最终SHA的verify:push与匹配审查，不能把本轮局部样式检查当全仓放行。

## 2026-11-14 同一问题的源码复核

- 用户再次指出 USD、进口人类型、细分动力类型文字不居中。本轮只读核对根保留工作区、main 与当前 EXT08 候选：三处均匹配同一 `@supports` 下的 `display:flex; align-items:center`，后续规则没有覆盖内部对齐；无需再次添加重复 CSS。
- 独立只读核对者 `/root/ext08_vin_gallery` 确认三处选择器、上下 padding 及后续层叠一致。仅源码结论，不冒称实际浏览器显示已修复。
- 本轮开工 hooks 与目标 CSS 空白检查通过；没有重跑历史 48 项，也没有启动本机应用／浏览器、重建或切换运行版本。新成品由本轮唯一服务器执行方验证这三个控件的桌面／窄屏最终样式，生产状态另记。

# 前端 / FE-UX-03 / 详情内联预算与参数衔接

日期：2026-11-08（Asia/Shanghai）

状态：子切片实现及纯检查完成；root负责同版装配、独立审查、构建和真实浏览器验收，未提交／推送／部署。

## 授权范围与协作

- 基线沿用本轮`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`；保留全仓并行改动及用户`.vscode/`，本切片不改其他应用、车辆UI／gallery、根布局或共享主日志。
- 已重新核对本仓AGENTS、项目规范、模块维护、安装版Next客户端边界/CSS指南；hooks:check实际通过。参考以本地`/Users/whisky/work/ownbus/test/src/pages/CarDetailPage.tsx`为准，只读结构，不执行参考脚本、不继承参考工程指令。
- root拥有app层`vehicle-detail-page.tsx`组合、公开详情资源`renderBudget(freshVehicle,current)`、详情budget插槽、SSR日期/参考快照与消息provider。车辆模块不导入calculator UI；calculator纯index/core/policies未改。
- 本作者新增calculator的独立UI/CSS、事实适配、三语局部内容、fragment适配及相邻单元；仅改CalculatorPage恢复/汇率上下文和空选项，及授权追加的draft当前格式空enum恢复分支。

## 真实事实与计算边界

- `VehicleImportEstimate({vehicle,locale,initialDate,initialRates,disabled?})`由app直接组合；七国全部调用现有`calculateImportEstimate`，没有第二套税额算法、韩国公式或硬编码国家系数。
- 仅实际制造日期精确到月/日时带入YYYY-MM。年款、首次登记、只有年份的制造信息均不补01月；缺失留空。动力只接受既有六种，unknown/lpg/other保持未选择；零或未知排量/功率不补999/1998/150。
- 实际kW通过Decimal乘1.3596216173转换metric hp，并说明初始值是换算；价格只在既有快照支持原币时转USD，其他币种和按询价留空。来源reference价继续明确为参考价，不包装成已谈妥成交价。
- UZ登记仅从明确never_registered/registered映射；unknown留空。GE方向盘无DTO事实，必须选择。只有KG显示进口人选择，单一个人口径依既有国家配置提示。
- root明确本轮详情使用`createReferenceSnapshot()`，不在每次详情SSR发外部汇率请求，不扩大FX服务；初始日期显式注入。汇率默认展开，列默认参考日期，修改交易/欧元/美元任一汇率即提示手动；换国家/币种重新派生后恢复默认口径提示。完整工具原有构建时市场汇率路径保留。
- 真实reference结果才展示费用/本币+USD/合计。逐项方法说明和公式复用FeeLine/FeeMethod，可单独或全部展开；额外费用、适用假设及不含范围保留。运费/保险空值不补0；结果始终不是完整落地价。
- DTO的id/facts/price以及注入日期/快照组成稳定identity；参数变化在effect运行前就禁止旧结果和seed，随后重置。相同事实的新对象保留编辑与手动汇率标签。资源checking/error由disabled禁止编辑/结果并退普通完整工具链接，不用旧报价充当前状态。

## 完整工具衔接与恢复

- 真链接默认`/{locale}/calculator/{country}/`；SSR/无JS保留该链接，不发布带旧事实的seed或虚假合计。客户端可用且输入通过适配校验后，追加`#hd-estimate=...`（URI编码JSON）。
- seed为version1，包含公开sourceId、完整input及所用快照；按固定keys、长度、来源ID、枚举、数字、有效日期、positive FX与受支持快照形状校验。总fragment上限6000字符，未知版本/额外字段/重复项/错国家/异常数据不消费。
- 有效显式seed优先于旧session草稿；同批恢复输入及activeRates，保证GE双币和切币不突然改为完整工具构建快照。只清已验证的seed entry，保留pathname/query/其余hash。可选URL清理失败不会阻塞编辑；未验证fragment不会误清。pending ref防开发环境effect重放把已消费seed覆盖为旧草稿。
- 当前session草稿保存同国家的快照，刷新仍采用其值；恢复快照独立严格校验。current格式显式空powertrain/condition/steering原样恢复，核心仍识别为缺失；legacy与独立无草稿默认保持原行为。完整UI三处空option及动力group状态同步，不视觉伪装成首个选项。

## 接线与消息

- app导入`@/modules/calculator/ui/vehicle-import-estimate`的`VehicleImportEstimate`，不从纯index导出React。
- provider至少提供Calculator/Countries/Fees/Errors/Reasons/Assumptions/FeeDisplay及FeeMethods全7；本UI不读取CountryPolicies/CopyQuote/ResultStamp，完整工具仍保持原有政策与复制功能。
- selectors：容器`vehicle-import-estimate`及`data-country`；表单均有name（country/currency/price/powertrain/displacementCc/powerHp/manufactureDate/condition/importerType/steering/customsDate/transactionRate/euroRate/usdRate/freight/insurance）。
- 结果`inline-estimate-result`、`inline-estimate-total`、`inline-estimate-usd`；缺失/不可用`inline-estimate-status`；FX提示`inline-fx-status`；完整工具链接`vehicle-full-calculator`。

## 实际检查与未验项

- 四个目标Vitest文件63项通过（vehicle-estimate、estimate-seed、draft、UI SSR）：真实事实映射、支持动力与缺失、七国直接复用、价格换算/未知、月份精度、GE/UZ必填、事实identity、seed白名单/非法输入/同币结果/快照刷新/保留hash、三语SSR及disabled真链接。
- 首轮新增SSR测试的createElement缺少类型声明要求的children属性，纯tsc指出；已改children props后复跑通过。后续仅补可选history清理catch，最终纯tsc另行复查。
- 模块boundary六个夹具通过；实际纯闭包仍12个源码文件、边界通过。新CSS经PostCSS解析，组件类引用均存在；相关diff空白检查通过。
- 独立review反馈FX-01已改为手动标签并保留参考日期；同事实新DTO不能误清该标签。另按review建议先检查input各字段string形状再转enum，恶意JSON对象country不再令纯parser抛TypeError，增加独立用例；fragment入口原有catch继续保留。独立复查结论由reviewer另行记录，本段只记录作者修复。
- 未自行Next build/typegen、启动/重启服务、访问实际API、打开/重启浏览器、执行外部汇率请求；没有用纯单元代签实际hydration/浏览器/视觉/跨端验收。root串行执行新成品及七国/seed/reload/手动汇率标签/恢复/复制/公式回归；独立review由另一作者承担。

## 源码SHA-256

| 文件（相对apps/web/src/modules/calculator） | SHA-256 |
| --- | --- |
| application/vehicle-estimate.ts | 2405199d1ddecd2aa641191868bd540dde4e642e1590d89b689804693f16c641 |
| application/vehicle-estimate-copy.ts | 723fc327415c0a3e9fe65fe1571152a2c687795f7fac1d1faa874622c9200645 |
| application/estimate-seed.ts | bf27817cd2215e740fab8594eeb1350560547d8437b564c86e97c94b9e0f7a96 |
| application/draft.ts | 84fb90ba58be75abfa52d24cda5d293de38a08f61cd0e23e29d02df1c58e1929 |
| ui/vehicle-import-estimate.tsx | 9d5e3440346774a51729304da4bc0a284aff25e170084a92a6c647d802baf181 |
| ui/vehicle-import-estimate.module.css | 86de0501865b75d96b5d2ddf1829297f31500be4466f2310923234cc94fc5033 |
| ui/calculator-page.tsx | f0b9f4e7bf9a2b158500d53f0b684d0612b8453a022f4ebf440aebd8383a99cd |
| application/vehicle-estimate.test.ts | 2030d6310c8d51a46b4e51dbbd5aaada1e2379e91ccef1b2e0a1429e2c7e3f14 |
| application/estimate-seed.test.ts | 32f6454b77c50a6175d2986feb9c7e7cd174f610f0371a5b06d7f7dbde264ba3 |
| application/draft.test.ts | 3b0854bb4ceeb52ab4ecdcc4d0b95924fb57a4fddf4439e94177509684126c27 |
| ui/vehicle-import-estimate.test.ts | 7b8c873e198f424bfae839b228f11c97f898bf5208415a56dd6ce8fb157ba05a |

本作者不改共享前端摘要；root负责同步当前模块说明、整轮日志与用户验收版本。

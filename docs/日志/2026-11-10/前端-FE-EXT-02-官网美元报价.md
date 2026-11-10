# 前端 / FE-EXT-02 / 官网美元报价

日期 2026-11-10（Asia/Shanghai）。状态为隔离验证及真实样本联调通过，待用户本机验收。

## 范围与版本

- 二期独立工作区 `/private/tmp/hd-external-catalog-scale`，开工 HEAD `7ea9556634e0314c58dc3d5c7dfc4ec3b7677fe1`。同期 BE、OPS 变更和 PM 已移入的图库补丁保留。本轮修改只在官网应用、前端维护文档与验证记录。
- 列表、筛选、首页、详情与收藏通过 `view=localized&priceView=usd` 请求后端美元报价。无显式价格投影的原公开查询仍保持既有响应。车辆原始 `price` 保留，预算测算按原交易数据及自己的汇率快照运行。

## 实际变更

- 首页、列表、详情、收藏和两个询价草稿共用后端的 `displayPrice`。原美元沿用售价或参考价性质，换算价是参考价。缺价和无法换算均显示待询价。两位小数按语言呈现，金额运算与舍入在后端完成。
- 价格筛选表单明确 USD。列表与筛选字典共享同一关键词及区间，上下界以美元报价的两位小数匹配。旧书签若传有效非 USD 价格区间，则清除旧价格条件并保留其余筛选。原币 API 客户端沿用原请求。
- 使用换算价的页面在该区块说明汇率日期。手机详情在首个价格旁显示。实际 ExchangeRate-API 使用官方署名链接，合成来源只用于隔离验证。前端消费报价和日期。[ExchangeRate-API 官方署名要求](https://www.exchangerate-api.com/docs/free#attribution)

## 验证与交接

- `pnpm hooks:check` 和 `git diff --check -- apps/web` 通过。最终 BUILD `LnJdOSEUa4ncNg13C28aa` 类型、768 项单元、7 项边界、42 页 standalone 构建通过。早期成品 84 项 Chrome 通过。审查后的首轮类型检查漏导入 scope 所需契约类型，修正后通过。最终浏览器首轮未开始执行，既有限流测试限定 3100／3327，复跑使用其原配置，88 项全部通过。
- 最终成品独立副本 `/private/tmp/hd-fe-ext02-release-LnJdOSEUa4ncNg13C28aa` 含 1760 项，29 个链接均解析在内部，内容指纹 `66b8597494fc7e058a5ed07b4c70331dadc95c18c1a0fabe4bf686b22a020a48`。
- FE `3361` 与 BE `3360` 的同版隔离 PostgreSQL 联调通过 17 组。A 7 组含三语全链路，B 和 expired 各 5 组。员工人民币报价 A／B 为 8157.14／7137.50 USD，自动导入报价为 5717.00／5002.38 USD。原生 12345.67 USD 保持原值。B 的新边界命中，旧区间不再命中。过期后两种人民币记录均待询且不匹配 USD 金额范围，原生美元及原币旧 API 仍可用。前端在同一进程读取后端变化，浏览器拦截站外资源及图片失败上报。证据 `/private/tmp/hd-fe-ext02-live-evidence/{a,b,expired}.json`。
- 两份独立审查已闭合，涵盖模式校验、原币兼容、同区间筛选、手机署名、日期和草稿。[美元接口与筛选](审查-FE-EXT-02-美元接口与筛选.md) · [美元展示与询价](审查-FE-EXT-02-美元展示与询价.md)

## 真实样本验收

- 最终本机入口为 [俄文车源](http://127.0.0.1:3363/ru/cars/)、[中文车源](http://127.0.0.1:3363/zh/cars/) 和 [英文车源](http://127.0.0.1:3363/en/cars/)。独立 FE `3363` 连接 BE 的真实样本 API `3362`。后端 API 指纹为 `fb7bca8eb7efae24f0df1c168d49a988578e13cfd882e731da1a5cdb7394073c`。实际公开汇率时点 `2026-11-09T00:02:31.000Z`，来源 `exchange_rate_api`。
- 为让询价草稿里的详情地址使用 `3363`，以同一 32 个 FE 文件和一期图库两文件在独立目录重建。真实预览 BUILD `oPqS3RO1NtuXlTYkb59MX`。standalone 1793 项，29 个链接都解析到成品内，指纹 `f9875ce96b526ccaa9fda7cc4a5de33b8e3c9d96eed1449f625ee4e0ce796dd7`。源码清单 `/private/tmp/hd-fe-ext02-web-frozen-scope.json` SHA-256 `55bff2871f2ed141878d70432ff298362c8138b9f3858df37167c3bac0dc51eb`。
- 真实库 4 组浏览器／HTTP 检查通过，三语各 200 条，199 条美元参考报价与 1 条待询。抽查车源在三语显示相同的 6407.36 USD 和汇率日期，精确同值范围在列表与筛选均命中。两种询价草稿都使用该美元值及本机同源详情链接。俄语 320px、英语 390px 和中文桌面通过，手机首价格旁显示日期与官方链接。真实库只有外部挂牌，首页校验 200 的目录统计，首页车轨报价由有员工配置的隔离库验证。
- 真实检查拦截全部站外资源和图片失败上报，只核对源图 URL 与署名属性。报告链接和源图可达性留待核验。实测记录 `/private/tmp/hd-fe-ext02-real-usd-evidence/3363.json` SHA-256 `fcfc8e5ad7d0317039bc839eeedbc868d7c500ef2c5ef5148da5c0b21cbbfe00`。成品记录 `/private/tmp/hd-fe-ext02-real-standalone.json`。
- 合成 `3360／3361` 保留用于技术联调。FE 未提交、推送或部署。

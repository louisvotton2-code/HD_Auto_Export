# FE-UX-04 独立审查：本地化与公开查询接线

- 日期：2026-11-08，Asia/Shanghai；共同Git基线`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`。
- Reviewer：配件实施/既有性能子任务Agent；本次审查根实现的FE-UX-04接线，不审本人历史fixture/spec或parts，也不代签BE契约/API实现。
- 方式：只读源码、安装的现行契约与API投影上下文，独立运行全部fetch被stub的纯测试；仅新增本报告。未访问3320、真实服务、数据库，未build/typegen/启动停止服务、发送消息、修改实现或contracts。
- 开工`pnpm hooks:check`通过。当前共享工作树有其他端在制改动，未覆盖。
- 结论：下述最终指纹范围无未处置P0/P1/P2。初审提出的非空description语言校验已补，作者另加逐车detailPath约束；新增单元的null准备错误已由作者修正并复跑。生产构建、浏览器及真实BE联调仍由根/PM另外验证。

## 最终源码指纹

`/private/tmp/hd-fe-ux04-localized-review-scope.json`记录14个直接审查文件与12个只读上下文文件，最终SHA256为`fe3b828ffe87f9ca140f3c630f52a741452d98d2b7b8b739ffedd6576cf8db24`。直接审查范围如下；后续源码变化需增量复查，不继承旧指纹。末次复读绑定了作者修正的非空description反例及筛选上下文的十进制字符串格式化/保留既选model，不把这些上下文当作独立后端或视觉验收。

| 相对apps/web/src的文件 | SHA256 |
| --- | --- |
| `modules/vehicles/localized-projection.ts` | `d8206fc62a76e87bcfc38c7efe5fd570b5ccf38836c1af7ab6b378b566e30218` |
| `modules/vehicles/localized-projection.test.ts` | `694a76dff432b1ce9e529fd38e57a96f3a5180609fd4ae9f928bc7edb5f7524a` |
| `modules/vehicles/infrastructure/public-api.ts` | `76768c567a7d595e897c201c1d45cbb27e936a000e1de03d3e3f14248e7160b9` |
| `modules/vehicles/infrastructure/public-api.test.ts` | `b5bc892a8942158243232fe3ad97b40d20a1168ef7464f91211a005ba23dc4da` |
| `modules/vehicles/infrastructure/public-proxy.ts` | `6676e4d9f41444b61861f354cec0f2aa98ae7ac4038a530689d98f613b4b42a8` |
| `modules/vehicles/server.ts` | `d1446908e84f617c72cdef1ec70c3e8f05a051a47246139acd9e8e98117dd616` |
| `modules/vehicles/public-query.ts` | `419312be194bb6223485abc02471908c22ad05ba1ce6232d1d78f6ef77d9253a` |
| `modules/vehicles/public-query.test.ts` | `46b0ea43ba55a42f885a2e15a52345762d9f23b447b3178b0bfe449d4c797561` |
| `modules/vehicles/ui/public-vehicle-list.tsx` | `3658b816e090eab9670c121b085cbc362e0f78b28ee2d7150eb7984e8f05cf93` |
| `modules/vehicles/ui/public-detail-resource.tsx` | `e46f9a6f242434c694c22e2515ec565f00335c7efc201ad94a4cb48a8b0d9136` |
| `modules/home/ui/public-home.tsx` | `5fb0b6f5221119da22878d6ea030d43640467e9d91df8124837c902a424c0a5e` |
| `modules/vehicles/application/read-favorite-vehicle.ts` | `9421ed4a61bbe54b48991f06880a952a478e80cb3284fdb6c08fec0eb3a6d57a` |
| `modules/vehicles/application/read-favorite-vehicle.test.ts` | `77413361198129e87aff31dfeb08069f2b386fac40947b183710ff021b24bf97` |
| `modules/vehicles/index.ts` | `0c04d38cd42bef2a9d084dbfccea75b89bb7b4123ba3734cbf979a6d4bef76e4` |

## 接线与校验结论

### 本地化与兼容边界

- SSR的home/filters/catalog getter固定携带`view=localized`，catalog还会覆盖调用方传入的legacy；服务端缓存详情入口同样显式localized。
- 浏览器home、facets、list、detail资源URL以及收藏详情读取均携带localized；对应车辆响应使用localized schema。导航URL只保存业务筛选，不把view参数当用户可切换的语言模式。
- BFF旧请求不带view时仍按原公共schema处理；显式localized才选择严格projection schema。隔离stub确认同一legacy详情无view返回200，带localized被拒为503，没有静默退回旧DTO。
- localized逐车必须存在display，title和非空description的requestedLocale匹配；display全部标量、priceIncludes和mediaAlt值的requestedLocale都校验。逐车detailPath必须严格等于当前locale与该车ID构成的路径。display缺失/metadata错语言不会伪造空库存或接受旧中文响应。
- 字段为missing时保留契约中的null/未审核事实，不要求编造翻译；空列表可合法通过。PublicVehicle和DisplayText严格schema继续拒绝未声明字段，前端没有引入品牌词典或翻译网络调用。

### 查询与错误隔离

- allowlist增加trim/generation/drivetrain、原币价格上下界/显式币种、里程和年份范围；SSR、浏览器URL和BFF使用公共parser。价格保留十进制字符串，page/pageSize/里程/年份只接收规范非负整数字面量再转number，由契约校验上下界；指数、十六进制、负数、小数年份/里程、反向区间和无币种价格区间被拒。
- BFF先拒绝未知参数和任意重复参数，filters不接受分页；trim/generation所需make/model依赖保留。错误参数在upstream前返回400，错误响应保持通用文案。参数经URLSearchParams编码，没有新增任意origin/path或后台代理能力。
- 单车HTTP入口仍核对响应ID与请求ID、detailPath与locale；BFF详情复用该入口。串车和错误语言路径返回503；上游400/404仍映射缺失，库存缺失与临时失败分开。
- JSON/media大小限制、no-store、nosniff、redirect:error、超时和公共内容schema保留。Cookie/Authorization未随业务请求转发；仅既有受信网关IP边界按配置转发访问者身份。
- 429继续保留实际429与经过界限化的Retry-After；stub验证2秒原值可保留，无Set-Cookie、无内部主机/异常细节泄露。资源UI仍用原共享cooldown、data freshness与局部错误边界，本次没有重新引入focus/visibility请求或整页遮罩。

## 初审问题及修复复核

1. 最初localized validator只检查title和display，非空description的requestedLocale未校验。已向作者发送反例，作者增加description检查并同时绑定逐车locale/id路径；最终源码和隔离反例已复核。
2. 作者最初新增反例对默认fixture的null description使用非空断言后赋值，独立定向运行得到`Cannot set properties of null`，4文件33通过/1失败。已反馈，作者改为从title创建非空description再设置错误locale；23:33最终同组34/34通过，保留失败事实，不将其记为首次全过。
3. 最初临时观察脚本在作者同步加固后仍期待错误description被接受，出现5通过/1失败；这是观察断言落后于并行修复，更新为期待拒绝后6/6通过。它没有改变产品源码。

## flat字段的已确认信任边界

只读核对`apps/api/src/vehicles/localization.ts`的projectDisplay和service.toPublic：localized投影实际重写facts的品牌/车型/款型/代次/地点、price.includes、images.alt与外部platform名称，保留ID/数值/库存等事实；缺翻译按契约置空或使用后端统一占位。公开filters由同一localized车辆事实生成。因此现有UI继续消费flat字段，没有在前端复制BE投影或品牌映射。

临时纯反例可人为构造“display.make为英文Toyota但facts.make.name为中文”的不一致DTO；当前validator只校验metadata和形状，不检查所有flat文本与display逐值一致。该反例来自手造DTO，未调用正常API。根已确认此阶段信任BE统一投影；若后续要统一增强一致性，应交BE/contracts，而不是在页面重建一套后端映射。这一边界写明为限制，不宣称前端能自行识别自然语言或验证机器译文正确性。正常API的投影、发布快照和数据库迁移验收需引用BE/PM证据。

## 实际独立执行与限制

| 检查 | 实际结果 |
| --- | --- |
| `pnpm hooks:check` | 通过，未更改hooks |
| `pnpm --filter @hd/web exec vitest run src/modules/vehicles/localized-projection.test.ts src/modules/vehicles/public-query.test.ts src/modules/vehicles/infrastructure/public-api.test.ts src/modules/vehicles/application/read-favorite-vehicle.test.ts` | 23:33:05及末次23:35:32均为4文件34/34通过；此前null准备错误见上文 |
| `/private/tmp/hd-fe-ux04-localized-review/review.test.ts`，通过专属临时config运行 | 6/6通过：legacy/localized隔离、范围查询与坏参、详情身份/429头、SSR强制localized、description拒绝、flat信任边界观察；所有fetch被stub，origin为stub.invalid，没有真实HTTP |

根报告全官网763单元/7边界及首轮浏览器结果，属于实现者证据，本报告不代签；首轮浏览器早于上述description/path加固，新成品需重新构建/复跑。未验证真实3320、翻译质量、后台录入/发布、BE SQL/索引/分页性能、3D连续帧、生产部署或跨端最终验收。当前独立结论仅绑定上列最终源码和隔离检查。

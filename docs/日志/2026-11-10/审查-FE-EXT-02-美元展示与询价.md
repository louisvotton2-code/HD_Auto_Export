# FE-EXT-02 官网美元展示与询价独立审查

日期 2026-11-10。二期工作区 `/private/tmp/hd-external-catalog-scale`，共同基线 `7ea9556634e0314c58dc3d5c7dfc4ec3b7677fe1`，本次源码候选 `LnJdOSEUa4ncNg13C28aa`。范围为官网报价展示、目录金额筛选、联系方式草稿与原币预算边界。后台、数据库、汇率作业与图库修复另有审查记录。

## 发现与复查

| 编号 | 初审发现 | 复查结论 |
| --- | --- | --- |
| FILTER-01 | 目录列表请求使用已选的美元区间，实际首屏和交互筛选字典请求只有关键词。API 单独调用字典的测试无法发现官网没有把同一范围传过去。 | 已闭合。SSR 与动态请求复用 `publicUsdFilterQuery`，带当前关键词、美元范围和币种，品牌与车型仍按完整选项字典级联。首页使用无区间的同一入口。新增用例核对首屏的两个实际请求以及提交表单后字典的实际请求参数。见 [查询范围](../../../apps/web/src/modules/vehicles/public-query.ts#L4) 和 [用例](../../../apps/web/tests/usd-vehicle-pricing.spec.ts#L75)。 |
| MOBILE-01 | 手机和平板的首个价格块位于主列，汇率日期和来源只在下方侧栏价格区。 | 已闭合。详情在 `1023px` 断点与首个价格块同步切换汇率说明，一次仅一处可见。官方署名链接标注 `lang="en"`，中俄页面可按英文读出署名。三语用例缩到 390px 后检查唯一可见说明、UTC 日期和链接语言。见 [详情](../../../apps/web/src/modules/vehicles/ui/public-vehicle-detail.tsx#L109)、[样式](../../../apps/web/src/modules/vehicles/ui/public-detail.module.css#L390) 和 [用例](../../../apps/web/tests/usd-vehicle-pricing.spec.ts#L45)。 |

本次展示范围未发现其他需要修复的问题。

## 业务边界核对

- 首页、目录、详情和收藏均消费 `displayPrice`。`ready` 使用该字段的性质和 USD 金额。后端生成的原生 USD 保留原价性质，转换金额使用参考价标签。`on_request` 和 `unavailable` 都显示待询，金额缺失时不从原币补展示。既有价格包含项目继续作为详情范围说明。
- 中英俄金额通过本地化分组和小数点显示两位小数。整数部分用 `BigInt` 格式化，前端不转换汇率或再次舍入。Telegram 和 WhatsApp 共用同一询价文本及后端的美元十进制金额，缺价时使用待询文案。浏览器验证只读取链接参数，由访客自行发消息。
- 仅已换算的报价生成日期说明。使用 UTC 解析和格式化带日期的 `<time>`，相同日期去重。真实来源使用有键盘焦点的官方署名链接，合成来源没有该署名。无转换时没有汇率说明。
- 首屏、同源重取和收藏读回明确请求本地化 USD 投影。解析器按请求校验该投影有无，旧 API 调用仍可取原币。官网旧非 USD 价格区间只移除其原币金额条件，保留其他查询。预算测算继续读取 `vehicle.price` 与既有计算器汇率，单元测试用有意不同的 USD 展示值验证预算输入没有变化。

## 证据与限制

- 审查方实际执行 `pnpm hooks:check`、`git diff --check -- apps/web` 和文件 SHA-256 对比，均通过。复核源码、表单、测试断言和 CSS 断点。未启动服务、构建或执行浏览器。未独立运行真实汇率服务及 A／B／过期快照联调。
- 实现者初版 `4zca1A86OtUdZKb9ZU-nU` 已通过 768 项单元、7 项边界、42 页构建及 5 项美元 Chrome 用例。实现者报告最终候选也通过 768 项单元、7 项边界和 42 页构建。最终浏览器回归与隔离 API 结果按实现者同版本日志记录。见 [前端实施日志](前端-FE-EXT-02-官网美元报价.md)。
- 最新美元浏览器断言保留三语价格一致、原始金额兼容、相差一美分不匹配、原币书签、原生 USD 以及待询降级，并加入两项修复断言。手机测试使用 390px，实际窄屏交互和来源可见性取决于浏览器运行证据。

## 源码指纹

已逐项复核 `/private/tmp/hd-fe-ext02-usd-review-scope.json` 的 31 条，清单 SHA-256 为 `fbb32c39f9a77b1e2b4048d30a5e59fa943163acf1f6210d5d3f80631b8cabbb`。重点报价展示文件与测试另列如下。

```text
041b02b95e4d660300f3b9fcfde780a7779089fdf5f9d853f36ce8faf999f48c  apps/web/src/modules/home/ui/home-page.tsx
37240f2c529abb54cb666deaaf081f5ae7a7125875462bb8e027b1e86e5f5d94  apps/web/src/modules/home/ui/public-home.tsx
d7abaeb80c63aceb570bc6f99736e79b77b321f28c6c8517418bbc52d532d893  apps/web/src/modules/vehicles/ui/public-vehicle-card.tsx
707d4090ba5011df795ee19b62c1d10d0c196c281f234ae504376a1dfaef4f65  apps/web/src/modules/vehicles/ui/public-vehicle-detail.tsx
d2e35ffc6fe2c06244ca40f1f3abeb95cc6656a79ff8045d80372e9c4e4a14bb  apps/web/src/modules/vehicles/ui/vehicle-favorites.tsx
9afe02aa9f1a96f0e5119102f734477f1e47fd86dce3e24fcb1c8315dd924013  apps/web/src/modules/vehicles/ui/vehicle-rate-attribution.tsx
9a338d85f8cead9b7545b4e2f3cf438bee693bc65daea485eb3eaf038bb582fd  apps/web/src/modules/vehicles/ui/vehicle-rate-attribution.module.css
32d70c0e8af63f0bc48b547406a7e44f21846f04139d0bd920cfaa10cf902d69  apps/web/src/modules/vehicles/ui/public-detail.module.css
975cb68d43b31edbc64845407d29ed81ebf866928843b29cdf1c2f8c6e58bee5  apps/web/src/modules/vehicles/public-presentation.test.ts
c2bd106774a02a871d308b881ac912dd06e11327397c7e4dec6bbd51ba4e0f53  apps/web/src/shared/lib/public-vehicle-contact.test.ts
303d46e1efe1defefac7c71b5fca5709acac68e942fdafef024cc467c9c47422  apps/web/src/modules/calculator/application/vehicle-estimate.test.ts
16153248391b64ba37692749025c5034d51987de2c68c87831fea226d875c59c  apps/web/tests/usd-vehicle-pricing.spec.ts
```

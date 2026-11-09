# FE-EXT-02 美元接口与筛选独立审查

2026-11-10，Asia/Shanghai。二期工作区 `/private/tmp/hd-external-catalog-scale`，Git 基线 `7ea9556634e0314c58dc3d5c7dfc4ec3b7677fe1`。直接审查官网查询、传输、响应校验和回归测试。共享契约及 BE 汇率实现只作上下文。

两处接线问题均已完成修复复查。本报告指纹范围无未处置 P0/P1/P2。

## 模式与兼容

- 官网首页、目录、筛选、详情和收藏显式提交 `view=localized&priceView=usd`。SSR 与客户端资源使用相同参数。收藏按稳定 ID 请求对应语言的详情并复核 ID 和路径，沿用省略凭据和超时边界。
- 本地化车辆响应根据请求模式检查 `displayPrice` 的有无。USD 响应缺字段或原币响应误带字段均返回通用 503。legacy 校验继续排除导入对象及美元投影，sitemap 只请求 legacy。原币模式的金额筛选和车辆原 `price` 字段保持原语义。
- BFF 的 mode allowlist 覆盖列表、筛选、首页和详情。非法值、重复值、缺少 localized 配对及非 USD 价格条件均在上游前返回 400。公开模式判断沿用同一共享契约。

## 金额与书签

- 目录表单固定 USD，标签明确显示币种。JS 提交与原生 GET 均携带同一币种。金额校验和序列化保留十进制字符串。无精度损失地转发 `99999999999999.98` 至 `99999999999999.99` 的上下界。
- SSR 与客户端 facets 共用 `publicUsdFilterQuery`。同当前目录发送 q、USD 币种和现有金额上下界。其它筛选字段仍由目录列表应用，facets 保持原有广选项行为。合成浏览器用例检查 `1000.00` 的相等边界包含、`1000.01` 排除，实际 SSR 查询和浏览器应用新金额时的筛选请求都纳入断言。
- 旧书签先通过原币条件校验，再清除有效非 USD 金额及其币种。品牌、年份、关键词、分页等条件保留。错误范围及重复币种不能借剥离进入正常查询。后续导航链接省略传输 mode。

## 缺价、过期和原始事实

- `ready` 使用 API 的 USD 金额。原生 USD 沿用原价性质，换算值为参考价。`on_request` 和 `unavailable` 都显示待询价，询价草稿消费同一投影。测算仍以原 `price` 和自己的汇率快照为输入。前端只格式化金额和参考日期。
- BE 的只读上下文显示活跃快照查询要求 asOf 已生效且 expiresAt 晚于当前时间。美元缓存按可用汇率版本区分，TTL 截止在该快照过期前。过期或缺币种映射到 `unavailable`。官网隔离测试以该状态验证原生 USD 仍显示、换算价降为待询。实际快照 A/B 切换和超期以 BE 与联调运行证据登记。

## 发现和复核

1. 目录和 facets 初版解析会略过空字符串，把显式 `priceView=` 当成省略。首页和详情原本按严格枚举拒绝。作者保留该新参数的空字符串交给契约校验，四个 BFF 入口统一返回 400。独立 stub 验证无上游调用。
2. USD 区间初版已接入列表，facets 仍只发送 q。作者补齐服务器和浏览器的同价格区间接线。独立检查确认保留精确上下界及 q，并排除其它目录条件。新增浏览器用例覆盖 SSR 和交互查询。

## 独立执行

| 检查 | 结果 |
| --- | --- |
| `pnpm hooks:check` | 通过 |
| 官网定向 `localized-projection`、`public-query`、`public-api`、`read-favorite-vehicle` Vitest | 01:35:15 和 facets 修订后 01:38:31 各实际 4 文件 35 项通过 |
| `/private/tmp/hd-fe-ext02-usd-review/review.test.ts` 专属 Vitest 配置 | 01:36:13 实际 7 项通过，覆盖四入口拒绝错模式、双向响应模式隔离、原币和精确金额、书签、SSR 及收藏请求、同价区间 facets、待询降级。所有 fetch 使用 stub |
| `git diff --check -- apps/web` | 通过 |

作者冻结的最终候选为 BUILD `LnJdOSEUa4ncNg13C28aa`，768 单元、7 边界、42 页构建通过。作者报告前版 BUILD `4zca1A86OtUdZKb9ZU-nU` 的 84 项 Chrome 通过，最终候选 Chrome 尚在作者运行中。此次独立执行使用二期工作区现有 contracts dist 和纯 stub。最终成品浏览器与真实 API 3361→3360 的验证归联调记录。

## 源码指纹

`/private/tmp/hd-fe-ext02-usd-review-scope.json` 记录 20 个直接审查文件与 11 个只读上下文文件，SHA256 为 `fbb32c39f9a77b1e2b4048d30a5e59fa943163acf1f6210d5d3f80631b8cabbb`。定向与临时测试使用的 `packages/contracts/dist/public.js` 同列为上下文。收到最终候选冻结通知后逐项比对，31 个文件的内容指纹均一致。

| 关键接线 | SHA256 |
| --- | --- |
| `public-query.ts` | `39533fb9ff98f92d46fc0bce78925f54a31ef82ef6ed74632d9833a3e8f32293` |
| `infrastructure/public-api.ts` | `2754b1944a467e361d4a630b782a6cfc3c91a856d82fa937651a78ba261ddce5` |
| `infrastructure/public-proxy.ts` | `660d33564e93c537bae915f06634247b6331fc0b3e4f3ff69964d3ef98e537f6` |
| `localized-projection.ts` | `fe03f3851b387b4fc7f16cc45d681c67fa94625fe682c78b3328bd5fe474de15` |
| `ui/public-vehicle-list.tsx` | `9f24c1983d14b114d9882619ebfa4f5715bfed61ab888eb00dea3010594cb788` |
| `tests/usd-vehicle-pricing.spec.ts` | `16153248391b64ba37692749025c5034d51987de2c68c87831fea226d875c59c` |
| `packages/contracts/src/public.ts` | `b00b4cec0ba6e5ec28c7141d0e82b9e397421ecf729ccb2a26be437252aec739` |
| `packages/contracts/dist/public.js` | `cf5022b8d29f0f2130c0c75b6e7fbd34b446063547c8c33dad4a21b78eca3631` |

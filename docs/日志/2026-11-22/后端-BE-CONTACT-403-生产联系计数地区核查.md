# BE-CONTACT-403 生产联系计数地区核查

生产 v2.0.8 的匿名联系计数只接受可信网关判定为 RU、BY、KZ、KG、UZ、TJ 的请求。OPS 对照当前接流 API、实际网关对端、国家表和发布记录，确认名单一致且网关认证通过。缺少车和渠道字段的诊断请求在可信网关给出 KZ 时到达参数校验并返回 400，缺少国家时返回 403。网关与 API 无配置改动，诊断请求未写统计。

公网诊断以正确官网 Origin 配合不完整 JSON 收到 API `403`，响应为 `Anonymous contact measurement is unavailable.`。无效 Origin 的对照在网关返回 HTML `403`。真实 Chrome 的回环 HTTP 与 HTTPS 样例均确认官网现有请求带正确 Origin 且省略 Cookie 和 Referer。地区拒绝发生在请求体验证和计数写入之前。原始公网出口未在日志中留存，无法确认这条请求的具体地区。

Node 24.19.0 与隔离 PostgreSQL 18.6 的联系计数测试通过。获准 KZ 的合成公开车辆点击计数加一，未识别地区、名单外地区和伪造网关凭据拒绝。未改应用代码或生产配置。

## 用户确认后开放全地区

`codex/be-contact-all-regions` 从 `a935ea9f13aee23699d20672e51aa227f46cf7cb` 开工，冻结前快进至公开图片版已合入的 `7aef73637aa2b70919cdd02a5e698b39f005ddc7`。`POST /api/v1/analytics/contact-count` 删除地区判断及两个仅用于此门槛的旧后端参数，统计配置状态按官网 `ANALYTICS_ORIGINS` 判定。网关清除旧地区和认证头，历史国家表和密钥工具保留给旧版本回退。保留同源检查、请求体和限流、公开车辆判断、隐私字段清除及原计数表。独立访问量与需同意的会话统计沿用各自入口和校验。官网域名继续使用 `cars.hongdingauto.com`。

最终基线上的 Node 24.19.0 配置／HTTP 测试 19 项、隔离 PostgreSQL 18.6 联系／会话／访问量 4 项、真实本机 Nginx 与发布配置 22 项通过，类型检查、OpenAPI、构建及 hooks 均通过。另用本机 HTTPS Nginx 接入同版 API 和合成车辆。正常请求和注入旧地区头的请求分别返回 204，统计只增加 2。转发清除了地区、内部认证、Cookie、Authorization 和 Referer。跨域返回 403，正确官网来源的空 JSON 到达 API 并返回 `400 INVALID_REQUEST`，这些探针不计数。

本轮无新迁移和生产操作。发布先切新版 API 再停止网关透传，回退地区限制版时恢复与旧 API 配对的旧网关。沿用历史发布脚本时须将正规官网 Origin 的空 JSON 探针从地区 `403` 改为 API `400 INVALID_REQUEST`，避免错误触发回退。完整发布门禁由 PM 在集成提交上执行。

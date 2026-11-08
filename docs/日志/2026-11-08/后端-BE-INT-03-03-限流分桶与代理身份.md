# 后端 / BE-INT-03-03 / 限流分桶与代理身份

日期：2026-11-08（Asia/Shanghai）
状态：已在原生3320启用；FE／OPS实际代理链路待联调

## 范围与版本

- 起因：PM要求只读核对FE run2在18:03:17的4张媒体503及18:03:20的focus JSON503。核对后，PM／根QA确认BFF/SSR访客聚合和媒体挤占JSON额度的P1，并明确授权API最小分桶修正，FE/OPS各自补可信客户端身份链。
- 共同工作树 `codex/backend-foundation`，HEAD仍为 `61dc7414b20a395d1d09e906a49d974763b3cce7`；本轮未提交。承接[Retry-After增量](后端-BE-INT-03-02-限流重试提示.md)，修改前快照 `/private/tmp/hd-be-limit-buckets-before`，保留其他端改动。
- 不重启3320或修改实际运行配置、数据库；reference视觉及其他验收窗口按PM协调，最终与OPS备份窗口统一启用。

## 现有日志核对

只读本机现有 `docs/private/local-acceptance/api.log`，未产生服务请求。Asia/Shanghai 18:02:50–18:03:45共有62条完成记录：57条200、5条429，没有503或Request failed；独立Reviewer只读复核结果一致。

| 时间 | GET路由 | 状态 | requestId | 原日志行 |
| --- | --- | --- | --- | --- |
| 18:03:17.133 | /api/v1/media/:id | 429 | b2fe83cb-bffe-47ce-b542-3a3b9219dead | 2480 |
| 18:03:17.135 | /api/v1/media/:id | 429 | 02668b91-c1ad-4ed9-9276-03dd9f5241e0 | 2481 |
| 18:03:17.142 | /api/v1/media/:id | 429 | f4ee26cb-cd2f-4864-b998-d3e78c206995 | 2486 |
| 18:03:17.145 | /api/v1/media/:id | 429 | e7bde810-8127-4e26-bcfd-86203da7d2e6 | 2487 |
| 18:03:20.539 | /api/v1/home/vehicles | 429 | 285d89e7-ba23-4e2d-a98c-1966eb0a5839 | 2488 |

这些时间、数量与FE报告吻合，API侧不是存储／数据库503。仅API日志无法证明FE内部映射；随后获准只读源码分析，观察到FE当时将除400/404外的上游错误统一变为503，且没有转交Retry-After，符合该现象。具体运行成品由FE/根QA核对，不冒称BE已验证浏览器产物。

## 已确定的最小方案

- 公开JSON、公开媒体、管理业务、健康检查各120次／60秒；鉴权路由30次／60秒不变。各类按API校验后的IP计数，不以车辆ID、查询参数或调用者自选头划桶；原图／thumb／不同媒体ID及GET/HEAD共享媒体桶。健康检查仍有上限，但不消耗业务额度。
- 自定义key仍调用已安装限流组件的IP归一函数，保留IPv4映射与IPv6 /64归一；不通过轮换IP字串放大配额。错误保留真实Retry-After，缺失时才回退60秒。
- 来源身份只由Fastify的可信对端解析决定。API在业务／鉴权处理前拒绝畸形解析IP，不直接消费专用访客头；不关闭限流、不建立任意来源白名单。
- 可信链唯一约定：Nginx覆盖 `X-HD-Visitor-IP`；Web仅在服务端 `VEHICLE_API_TRUST_PROXY_IP=true` 且其入口封闭时校验该单IP，再向API构造全新单值 `X-Forwarded-For`。API的 `TRUST_PROXY=<proxyIP>/32,<webIP>/32` 仅信任两台固定代理地址。默认不启用Web转发，不传浏览器原始链、Cookie或Authorization。
- 缺少访客上下文不伪造IP或跳过额度，仍作为Web服务地址进入有界桶。OPS负责固定地址、仅入口暴露与清理外来头；FE负责SSR/BFF上下文、默认关闭、单值校验及429透传。BE注入测试不替代这条完整链路的运行验收。

## 验证与限制

- 开工hooks:check通过。前轮22项源码／测试及构建指纹在本轮修改前一致。
- 作者最终 API 非数据库测试73/73、类型检查通过；其中11项分桶／可信身份、3项Retry-After。日志 `/private/tmp/hd-be-buckets-media-selftest-final.log`；图片交付合并增量详见[BE-INT-03-04](后端-BE-INT-03-04-Nginx私有图片交付.md)。
- 独立初审发现原有鉴权早于route限流，导致401请求不占用额度、超额仍查会话。已将管理鉴权移动至preParsing，位于限流之后、上传解析之前；新回归覆盖120次401后429、超额停止会话与角色查询、上传401／403优先于413。[最终独立报告](审查-BE-INT-03-03-04-分桶与私有图片交付.md)确认P2关闭，无未处置的可确认阻塞。
- 最终 API build 与编译成品 direct／nginx 注入预检通过，无socket／DB。主审定向32项、媒体子审42项通过（6项重叠，不相加虚报）；审查方类型检查通过。全25项受审文件指纹再次核对一致。
- 不复跑全部36项数据库业务场景，不增加实际3320请求；未访问真实数据或实际代理服务。
- 分桶防止媒体堵塞JSON，但安全访客身份必须由FE/OPS共同接通；不会把单独开启API的TRUST_PROXY写成已解决SSR聚合。

## 交接

- 最终25文件清单 `/private/tmp/hd-be-int03-reviewed-files-buckets-media-final.json`，清单SHA256 `0cdffa98931dbb5aef9a37540abd2755bb44555bfe2a0e6ad59bd19ea2f78174`；当前 `dist/app.js` SHA256 `1a1857ef32dd87e9d75814e335cd7be105e0302b2c7080ed3aa461b22c3ce1f2`。15个编译JS的指纹及受审文件另存未提交 `docs/private/local-acceptance/int03-buckets-media-build.json`（600），`enabledOn3320=false`，取代前轮待启用构建。
- API已具备进入统一备份／切换窗口的条件，等待PM停机信号；当前没有停止或重启3320。后续原生服务按 `MEDIA_DELIVERY=direct` 启动；Nginx交付模式由OPS配置后另验。PM通知业务资料已冻结，本轮没有据此读写业务数据。FE/OPS联调和最终用户验收另记。
- 本轮未提交、推送、合并或生产部署。

## 后续运行记录

PM随后开启真实备份窗口，OPS完成采集后，BE于18:49:17用同一已审构建恢复原生3320（PID97911、direct模式）。少量就绪／数据版本读回通过，未作限流压测；完整停机与恢复证据见[BE-INT-03-05](后端-BE-INT-03-05-备份窗口与原生API恢复.md)。以上冻结交接描述保留为当时状态，当前启用标记见该运行记录。

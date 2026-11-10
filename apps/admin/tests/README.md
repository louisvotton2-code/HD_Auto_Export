# 后台隔离浏览器测试

测试写入仅由 `run-live.mjs` 启动：后台预览 3319、API 3322、随机 `hd_admin_test_` 数据库及临时媒体目录；退出时清理。禁止把测试指向保留试用环境 3318／3320。契约夹具测试不是真实提供者调用证明。

## 契约夹具证据

截图及品牌检查 JSON 随各用例保存在 Playwright 输出目录（默认 `apps/admin/test-results/`）。可通过 Playwright 的 `--output` 为每轮指定独立目录。设置 `ADMIN_CAPTURE_PUBLISH_CONFIRMATION=1` 可额外记录发布确认弹窗的桌面及手机截图。

## 翻译模式

- 默认 `ADMIN_LIVE_TRANSLATION_PROVIDER=disabled`，不调用翻译提供者，并从子进程清除阿里凭据及本机服务 API key。
- `libretranslate` 仅供显式合成评估，地址限制为 `127.0.0.1`／`localhost`／`[::1]` 的 3340 端口；不接受 userinfo、额外路径、query 或 hash，API key 为空，需记录真实模型版本。
- `aliyun` 仅在本轮负责人明确允许少量合成调用后启用。必须同时设置 `ADMIN_LIVE_ALIYUN_CONFIRM=synthetic-only`、`ALI_MT_REGION=ap-southeast-1`，并已私下配置 `ALI_MT_ACCESS_KEY_ID`／`ALI_MT_ACCESS_KEY_SECRET`。可选 STS token 只供对应鉴权使用。凭据由负责人通过私有环境加载，排查和报告不展示其内容，也不把凭据放入命令参数、日志、截图及测试输出。

阿里模式启动前核对全部门槛，仅允许下列唯一用例，固定单 worker、零重跑／重试；翻译预算强制为每小时 500 字符。用例原文不超过 200 字符，两目标累计原文少于 400 字符，生成只点击一次，未知结果直接报告失败。区域对应的官方域名由 API 固定，不提供任意 host／URL 配置，也不回退到其他提供者。

在仓库根目录、Node 24 环境执行；私有环境文件须已由负责人核对，不在聊天或公开日志展示内容：

```sh
ADMIN_LIVE_TRANSLATION_PROVIDER=aliyun ADMIN_LIVE_ALIYUN_CONFIRM=synthetic-only \
node --env-file=docs/private/translation-aliyun.env apps/admin/tests/run-live.mjs \
  --grep '(?:^| )real Aliyun international Chinese suggestion persistence$'
```

真实阿里输出仅保存本次合成中英俄文本、模型配置版本与耗时到 `/private/tmp/hd-ad-i18n-evidence/real-aliyun-international-synthetic-output.json`；截图名称也标为真实阿里合成样本。数字、字母与西里尔字母检查属于健全性验证，语义须另行目视复核，不能称为专业翻译质量认证。未配置／未授权时只做拒绝路径检查，不尝试真实调用。

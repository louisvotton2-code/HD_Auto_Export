# 本机免费翻译评估服务

AD-I18N-01 的独立 LibreTranslate 切片，只供服务端 API 调用。与 `deploy/runtime` 的网站、后台、数据库和媒体组合无关；不在已有生产／测试 Compose 中增删服务。这里只监听 `127.0.0.1:3340`，不配置域名、公网端口或浏览器直连。

这是无按字付费的本机评估方案，仍消耗主机、磁盘和维护资源。当前样本存在车型术语误译、核验语义合并和编号丢数字，且英俄模型许可未明确，**不得启用到真实业务或生产**。机器建议必须保持 `machine / pending`，先供员工核对再保存；品牌、型号、年份、里程、价格、事故否定和费用排除均需人工核查。不得据此改写结构化 ID、金额或库存事实。运行结果与质量限制见[本轮日志](../../docs/日志/2026-11-08/翻译自部署-AD-I18N-01.md)。

## 固定组件

- 官方镜像：`libretranslate/libretranslate:v1.9.6@sha256:1de2d7056bb8ad607a412f4563d9abe324ff632b43b5be9428bcc8e213aebb32`。摘要为多架构索引；2026-11-08 实测 Linux/arm64，Linux/amd64 尚未实测。
- 容器内：LibreTranslate 1.9.6、`argos-translate-lt` 1.12.1、CTranslate2 4.7.2、MiniSBD 0.9.5。
- 只装 `zh→en` 1.9 与 `en→ru` 1.9，中文到俄语由引擎经英语中转；不装反向模型。中文与英语分句模型固定 MiniSBD `v0.0.1`。来源和逐文件 SHA-256 在 [models.json](models.json)，摘要取自本轮首次官方下载，用于后续字节一致性校验，不冒称发布者签名；不跟随动态索引或 `latest` 自动升级。
- 独立卷 `hd-auto-translation-models-v1`（翻译模型／下载档案）与 `hd-auto-translation-sentence-models-v1`（分句模型）；不挂载业务数据或网站卷。
- 服务限制：2 CPU、2 GiB 内存及相同 swap 上限、128 进程、1 Gunicorn worker、Argos 1 inter / 2 intra threads、每次最多 5,000 字符与 2 段。日志最多 2×5 MiB；不自动重启以免下载或启动失败形成循环。

## 启动、核对与停止

需要 Docker Compose v2；从仓库根运行。首次只下载官方固定文件到专属卷，校验失败即停止。此步骤可联网，不接收业务文本：

```sh
docker compose -f deploy/translation/compose.yaml --profile setup run --rm models
docker compose -f deploy/translation/compose.yaml up -d libretranslate
docker compose -f deploy/translation/compose.yaml ps
curl --fail http://127.0.0.1:3340/health
curl --fail http://127.0.0.1:3340/languages
node deploy/translation/smoke.mjs
```

`node` 应使用仓库 `.nvmrc` 对应的 Node 24。下载较慢时等待 setup 实际完成；失败可重试，已完整且摘要正确的文件会复用。runtime 启动前再次校验固定引擎、两组模型元信息、下载档案和分句模型摘要，缺文件不尝试补下。runtime 使用独立 bridge 网络，固定模型完成安装后本地推理，不调用远端翻译 API；该网络本身不阻止容器出网。Docker Desktop 在本机 `internal: true` 网络不发布宿主端口，故未采用该选项。首次冷推理可较慢，API 启用前应在本机用合成样本预热中英／中俄两个方向。

如已通过官方地址下载同名文件，可把只读目录供 setup 使用，仍逐一校验固定摘要：

```sh
docker compose -f deploy/translation/compose.yaml --profile setup run --rm \
  -e MODEL_DOWNLOAD_DIR=/downloads -v /absolute/model-downloads:/downloads:ro models
```

停止保留模型；以下命令只针对本任务的 `hd-auto-translation` 项目：

```sh
docker compose -f deploy/translation/compose.yaml stop libretranslate
docker compose -f deploy/translation/compose.yaml down
```

常规停止不要添加 `--volumes`，无需停止其他容器。迁移时模型可从官方重下；若复制卷，使用同版本清单复核。模型不是业务备份。容器中的 loopback 无法连接宿主 `127.0.0.1:3340`；当前地址供 native API 使用。未来容器化 API 接入须由 OPS 显式协调专属网络与服务名，不能直接把端口改成公网监听。

## 服务端 HTTP 协议

GET `/languages` 是语言及可达目标列表，新版本中文代码为 `zh-Hans`；`source: "zh"` 也经官方别名转换兼容。POST `/translate` 接受 JSON，原生引擎支持数组；本项目适配器实际调用形式以 API 代码为准：

```json
{"q":"2021款 丰田 RAV4 2.0L","source":"zh","target":"ru","format":"text"}
```

响应：`{"translatedText":"…"}`；`q` 为数组时 `translatedText` 为同顺序数组。不传 `source:auto`，不使用 HTML 模式、不把字段拼成新指令、不直连非官方公共翻译 API。本机端口无 API key，只向宿主 loopback 暴露；员工认证、CSRF、限流、超时、保存行为由业务 API 处理。

本项目仅在合成评估环境使用：`TRANSLATION_PROVIDER=libretranslate`、`LIBRETRANSLATE_URL=http://127.0.0.1:3340`、`LIBRETRANSLATE_ENGINE_VERSION=1.9.6_argos-lt1.12.1_zh-en1.9_en-ru1.9`。版本值只用API允许的字符，不使用加号。当前英俄模型许可未明确，不得把此配置启用到真实业务或生产。API 当前每次 provider 12s／建议整轮25s，后台生成与当前状态核对合计35s等待上限；短样本实测不能保证5,000字符长文本通过，同步接口失败须保留中文和现有翻译，不能落库半份结果。

## 许可证与官方依据

代码许可、模型许可和译文质量分别核对，不能由“开源”推断所有用途均无限制：

| 对象 | 实际证据与边界 |
| --- | --- |
| LibreTranslate 1.9.6 | [官方 LICENSE](https://github.com/LibreTranslate/LibreTranslate/blob/v1.9.6/LICENSE)，GNU AGPL v3；保留来源、许可与适用的修改源码提供义务，当前使用未修改官方服务镜像 |
| Argos 引擎与模型索引 | 实装 `argos-translate-lt` 元数据标 MIT，CTranslate2 标 MIT；[Argos 官方代码](https://github.com/argosopentech/argos-translate)、[索引 README](https://github.com/argosopentech/argospm-index) 的 MIT／CC0声明不能替代每个模型本体的许可 |
| `zh_en` 1.9 | 下载包内 README 标记原 OPUS 模型 CC-BY 4.0；署名 Jörg Tiedemann、Santhosh Thottingal，论文 *OPUS-MT — Building open translation services for the World*（EAMT 2020） |
| `en_ru` 1.9 | 实包无LICENSE／COPYING／NOTICE，README列训练语料，其中QED段写研究用途；[上游 issue #507](https://github.com/argosopentech/argos-translate/issues/507)仍未解决模型许可缺失。不能把语料署名清单或索引声明当作明确模型授权，当前只合成评估 |
| MiniSBD | 实装软件元数据与[官方 LICENSE](https://github.com/LibreTranslate/MiniSBD/blob/main/LICENSE) 为 AGPL v3；[固定分句模型发布](https://github.com/LibreTranslate/MiniSBD/releases/tag/v0.0.1) 的 ONNX 无独立嵌入许可文本，保留模型来源，不将工具许可泛化为全部训练语料授权 |

官方运行与协议依据：[安装、参数](https://docs.libretranslate.com/guides/installation/)、[翻译 API](https://docs.libretranslate.com/api/operations/translate/)、[语言 API](https://docs.libretranslate.com/api/operations/languages/)、[固定入口脚本](https://github.com/LibreTranslate/LibreTranslate/blob/v1.9.6/scripts/entrypoint.sh)、[固定依赖](https://github.com/LibreTranslate/LibreTranslate/blob/v1.9.6/pyproject.toml)、[Argos 官方模型索引](https://github.com/argosopentech/argospm-index/blob/main/index.json)。仅以这些来源确定安装和模型，不采用第三方公共镜像接口。

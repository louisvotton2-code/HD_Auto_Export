# HD Auto Export 汽车出口官网

当前阶段：**P1.15 关于我们入口及俄语／USD默认值已发布**，包含已完成的独立仓库基线与 P1.9 费用详情折叠优化。七国三语页面构建为 HTML，计算和交互在浏览器完成；服务器仅托管 out/，不运行 Node 应用或计算 API。网站正式地址为 [中文购车指南](https://cars.hongdingauto.com/zh/buy/) 和 [中文计算器](https://cars.hongdingauto.com/zh/calculator/russia/)，最新版本的发布与公网验证以 [开发进度](docs/开发进度.md) 和 [域名HTTPS部署记录](docs/域名与HTTPS部署记录.md) 为准。

源码仓库：[louisvotton2-code/HD_Auto_Export](https://github.com/louisvotton2-code/HD_Auto_Export)。新维护者先读 [开发进度](docs/开发进度.md)，再按根目录 `AGENTS.md` 的顺序阅读本文件、[模块与维护指南](docs/模块与维护指南.md)及后续资料；日常提交遵循 [CONTRIBUTING](CONTRIBUTING.md)。

本地项目：Next.js App Router、TypeScript、next-intl、Decimal.js。中英俄三语、七个目的国、一套 PC/H5 页面。金额按参考站的 2026 快照独立实现，尚非官方核验税单或完整落地价。

## 启动

推荐 Node.js 24 LTS 和 pnpm 11.25.0；本轮在 Node.js 24.19.0 验证。`engines` 的 20.19 是历史技术下限，不是当前生产推荐版本。仓库使用 `pnpm-lock.yaml`，请不要生成其他包管理器的锁文件。

```sh
git clone https://github.com/louisvotton2-code/HD_Auto_Export.git
cd HD_Auto_Export
nvm use
pnpm install --frozen-lockfile
pnpm dev
```

`.nvmrc` 固定已验证的 Node 版本；不使用 nvm 时自行提供相应运行时。购车指南已合入 `main`，默认克隆即包含本轮页面；`codex/buying-guide` 保留开发记录。源码版本与服务器发布仍分别以 Git 和部署记录为准。

打开 [中文计算器](http://127.0.0.1:3000/zh/calculator/russia)。英文 `/en/calculator/russia`，俄文 `/ru/calculator/russia`。购车指南为 [中文如何购车](http://127.0.0.1:3000/zh/buy/)，英文 `/en/buy/`、俄文 `/ru/buy/`。根路径默认跳转俄文；各语言首页暂跳转计算器。

本地无需环境变量或数据库。需要配置时复制 `.env.example` 为 `.env.local`。`SITE_INDEXABLE=false` 默认禁止预览站索引；正式上线前必须设置真实站点 URL，并完成业务与规则审核。

本轮导航、消息分层与动效维护说明见[路由性能与动效](docs/路由性能与动效.md)。最终类型、边界、626单元及116浏览器场景通过，源码main远端质量通过；最终公网16项针对性复验通过。源码、实际部署及首轮报告目录冲突记录分别见开发进度和部署记录。

## 检查与构建

```sh
pnpm check
pnpm build
pnpm test:e2e
pnpm preview
```

`pnpm check` 包含类型、模块边界和单元测试。`pnpm build` 生成整个 `out/`，并清理上次构建的汇率 fetch 缓存以重新获取快照；网络不可用时用明确标记的演示值。构建后 `pnpm preview` 在本机3100端口仅托管这些静态文件，供检查使用，不是生产运行要求。

并行跑本机与公网Playwright时，给每个进程指定独立`--output`目录，避免报告清理互相影响；日常推荐串行执行。

浏览器测试使用已安装的 Google Chrome，默认启动或复用 `pnpm preview --port 3100`；CI不复用旧服务。也可用 `E2E_BASE_URL` 指向独立静态预览，不自动起Next开发服务。先构建再测试。当前验证覆盖Chromium，真实iOS/Android和Safari尚待验证。

P1.9 本机验证：类型检查、5 项模块边界防护、626 项单元测试、静态 export 构建及 101 项完整浏览器测试均通过。首次浏览器验收仅有一项 `innerText`／`textContent` 断言口径不一致，修正后重新执行完整 101 项通过；不把本机结果当成公网验收。

P1.11 本机验收：类型、5项边界防护、626单元、36路由静态构建、最终110项浏览器验收通过；另检查三语购车指南及共享导航在320～1440px共48个状态无溢出。最终截图与本轮新增9项场景见[开发进度](docs/开发进度.md)。

P1.12 已按用户授权发布到现有IP站点，采用实际origin重新构建、218新文件逐个SHA-256校验并原子切换；本轮待发布成品的110项本机浏览器验收再次通过。原Nginx／VPN进程、配置和防火墙保持，旧版可回滚；公网验收明细见[实际部署记录](docs/VPS-IP部署记录.md)。

**部署**：在开发电脑构建，将 `out/` 的全部内容上传到 Ubuntu 22 的 Nginx网站目录；不上传源码、node_modules、.next或.env，不需要服务器安装Node。纯静态资产可从Mac直接上传到Linux。完整安装／配置／HTTPS／更新／回滚，以及与现有s-ui／VPN的80/443冲突处理，见[服务器部署指南](docs/服务器部署.md)。不得为腾端口停止VPN或重置防火墙；先按指南检查真实监听。

## 当前可用能力

- 独立三语购车指南 `/zh|en|ru/buy/`：8步纵向时间线、500 USD定金、CIF／FOB海运对照、原生折叠FAQ及真实咨询／计算器入口；PC/H5共享导航可进入。金额统一来自 `modules/buying-guide/config.ts`，内容与样式独立于计算器。维护入口见[购车指南页面](docs/购车指南页面.md)。
- 七国路由、中英俄文案、会话内草稿、自动预填、恢复默认和复制结果；打开即有默认参考测算。
- 主界面保留车价、排量、功率、制造日期和三类动力；更多设置默认展开，也可收起。按参考站仅 KG 显示个人／企业切换，其余六国无此选项；固定个人口径与未区分身份的参考口径分别展示。
- 构建时获取市场参考汇率快照并标明数据日期；失败时明确标记演示参考值。更新快照需重新构建上传，静态主机不后台刷新。切换交易币种自动换算价格，手工汇率可在设置中修改。
- 费用明细和合计同时显示目的国货币与 USD 参考金额；手机底栏及复制摘要同步，USD 展示换算不改变本币税费。
- 每笔费用的“具体计算方式＋代入公式”默认收起，点击该费用行可单独展开，顶部可全部展开／收起，包含额外费用；本币与 USD 金额始终显示。已展开详情随输入即时重算，恢复默认或切换国家后收起。复制结果仍包含全部说明和公式，不受展开状态影响。
- 结果右上角圆形印章随税制、车龄、动力、KG 身份或豪车状态更新；输入缺失或错误时清除旧档位。顶部复用原始 Logo 作淡水印，不占用表单或金额空间。
- 七国结果卡下方提供中英俄政策与费用说明，按动力、车龄、GE 舵位和 KG 身份更新相关条目；未完整输入时仍可查看说明与本国参考来源。详见[复查记录](docs/参考站交互与政策说明.md)。
- PC 双栏与 H5 单栏，手机底部结果入口，精简 FAQ 与基础无障碍；整体与用户黑金 Logo 配色一致。
- 页眉/页脚真实 Logo、“关于我们”直达主站、Facebook/WhatsApp/电话链接，以及 Instagram/Telegram/微信号码复制。
- 首次访问根地址默认俄语，车辆演示价格为25000 USD；显式语言地址、有效会话草稿及主动切换继续保留，恢复默认切回USD。
- 独立参考内核 `src/modules/calculator/index.ts`，可供未来车辆模块直接调用；七国燃油、混动和纯电均已接通参考金额，KG 同时支持个人／企业分支。
- RU 完整回收费矩阵含纯电功率档；UZ 可选从未登记新车／二手车；AL 无需制造日期，KG 串联增程无需排量。
- 未填写运保时明确提示未加入计税基础，金额按已知成本作条件估算；填入报价后重算。KG 首登估算及 AL 年度豪车税单列、不加进进口费用总额。
- AM 纯电零税额是按 2026 优惠情景估算，配额和资格未核验；KG 电动按未使用配额优惠的标准税情景，均在结果中说明。
- 页面 metadata、canonical、hreflang、robots 与 sitemap 基础。
- 复制摘要附适用车辆参数、原始汇率、数据日期和规则版本，过滤隐藏字段，方便复现；草稿解析为独立纯函数。
- 公共计算入口有自动依赖边界检查，未来车辆／配件模块仅经该入口调用；可选后端适配器仍按流式字节限制请求并单测，但静态网站没有注册HTTP端点。
- 三语×七国静态HTML及SEO、无服务端Proxy的入口与路由、原始WebP图片、水印、访问当天日期初始化；无运行时计算／汇率网络请求。
- Nginx静态配置、Ubuntu22与现有VPN共存安装步骤；旧POST适配器只保留在源码中，`/api/health`和`/api/v1/calculations`不作为网站能力。已按用户授权部署 IP 试运行，保持 noindex，未配置域名／HTTPS；具体目录、备份及后续更新见 [VPS-IP部署记录](docs/VPS-IP部署记录.md)。

详细能力以 [规则覆盖表](docs/规则覆盖表.md) 为准。下一阶段需完成中国出口适用性、进口用途与资格、正式法规/计税汇率快照、非 KG 企业规则以及落地成本组合函数。

## 目录

```text
src/app/                         静态语言页面、入口、SEO、全局404
src/i18n/                        三语言路由与消息加载
src/messages/                    中英俄文案
src/modules/buying-guide/        独立购车指南配置、三语内容与页面／CSS Module
src/modules/calculator/config/   国家与字段能力
src/modules/calculator/ui/       页面和交互
src/modules/calculator/application/ 默认参数、换币、说明格式化、印章事实及消息合并
src/modules/calculator/infrastructure/ 参考汇率类型、转换与构建快照读取
src/modules/calculator/server/   可选后端请求适配器，不注册到静态站
src/modules/calculator/core/     纯函数、金额、日期、测试
src/modules/calculator/policies/ 七国独立参考规则、三语计算说明、费率事实与回归算例
src/shared/                     品牌配置、通用组件
tests/                          静态页面浏览器验收
scripts/                        模块边界检查、静态构建准备、本机静态预览
deploy/                         Nginx纯静态模板（需按实际端口／域名选择）
docs/                           规划、研究、进度、实际架构与覆盖表
.github/workflows/              代码检查和构建验收，不自动部署VPS
```

汽车、配件、物流尚未实现；没有为空模块建立假接口或假库存。

计算说明由各国 `method-messages.ts` 维护，印章、公式标签及复制参数文案位于应用层消息文件，统一由 `application/calculator-messages.ts` 合并到 next-intl。P1.9 在 `FeeDisplay` 中增加 4 个折叠操作 key，三语运行时各 420 个字符串 key；基础 JSON 仍各 248 个；P1.11 的 `buying-guide/messages.ts` 另提供各70个 `BuyingGuide` key，全站运行时各490个。不要把新增命名空间再复制进去。详见[实际技术架构](docs/技术架构.md)。

## 品牌与联系方式

集中配置在 `src/shared/config/site.ts`。Logo 位于 `public/brand/hd-auto-logo.webp`，原样复制用户附件。

Facebook 指向用户提供的 `https://www.facebook.com/HDAuto`。WhatsApp/电话按中国手机号使用 `+86 18215932610`。Instagram、Telegram、微信仅有号码，未提供已确认用户名，因此使用复制号码，不拼接虚构账号地址。

公网 IP 的 HTTP 页面已复现 `isSecureContext=false`、`navigator.clipboard` 不可用，这是测算摘要和号码复制失败的原因。用户明确选择之后自行部署 HTTPS，当前保留标准 Clipboard API 实现，不增加 HTTP 兼容回退、依赖或相关共享文件；本轮折叠优化不改变该限制。

市场汇率仅用于计算器最终用途；来源署名保留在页面。不得将其改为公开汇率下载/代理接口，详见 [技术架构](docs/技术架构.md)。

## 接手开发

先读 [开发进度](docs/开发进度.md)，再依次阅读本文件、[模块与维护指南](docs/模块与维护指南.md)、[实际技术架构](docs/技术架构.md)、长期 [开发交接规划](docs/开发交接规划.md) 与 [参考研究](docs/计算器参考规则研究.md)。修改税费前另核对 [规则覆盖表](docs/规则覆盖表.md)。遵循根目录 `AGENTS.md` 和 [CONTRIBUTING](CONTRIBUTING.md)，每回合同步更新进度文档。

源码、锁文件、测试、文档、品牌资产和通用部署模板进入版本控制；生成产物、依赖缓存、真实环境文件、凭据、数据库、私有运维记录和早期规划ZIP归档均忽略。交接以仓库当前文档和已保存提交为准，不依赖旧本机临时目录或压缩包。

P1.13已将最终eed6f8b静态成品发布到现有IP，增加本站文本gzip并保留VPN，源码main已同步。网页交互及导航保持无JS／减少动态效果兼容；本轮性能样本及测试口径见[维护说明](docs/路由性能与动效.md)，不保证所有网络都达到同一耗时。

正式域名、免费证书自动续期、VPN端口迁移边界与回滚见[域名HTTPS记录](docs/域名与HTTPS部署记录.md)。域名仍在阿里云解析；无需CDN或Cloudflare。

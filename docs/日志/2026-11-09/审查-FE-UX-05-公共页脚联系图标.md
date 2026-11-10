# FE-UX-05 公共页脚联系图标独立审查

日期：2026-11-09（Asia/Shanghai）

审查者：`/root/fe_ux02_reference_audit`。基线：`fd16e00e23db8b8956f0c398ab1c198e82a61bc2`。本轮审查六个公共页脚文件，前轮配件改动单独记录。

## 审查结论

本次快照未发现 P0 至 P3。电话两条、微信和五个社媒入口均有独立的左侧 SVG。公司地址使用位置针，原联系方式、微信复制和页脚导航保持可用的既有接线。

- 对照本地参考项目 `test/src/components/layout/Footer.tsx` 和 `test/src/components/Icon.tsx`，本次沿用联系块的图标位置及位置针语义。页脚仍从本站配置读取品牌、地址、号码与社媒账号。电话继续使用 `tel:`。五个社媒链接保留原 `href`、新标签页和 `noopener noreferrer`。`siteConfig` 相对基线没有改动。
- 微信仍为有名称的原生按钮，复制调用、成功／失败状态和三秒清理逻辑保留。可见名称和账号文本单独布局。图标外层及 SVG 的 `aria-hidden` 让辅助技术读链接名称或复制按钮的现有标签。地址针同样为装饰图标，地址文本保持原有语义。
- 联系名称改用显式 `.hd-contact-label` 选择器，替代旧的首个 `span` 假设。页脚 CSS 以 `.footerContacts` 限定图标、文字和间距规则。图标盒固定尺寸，移动断点缩到 28px，名称区域可收缩，账号按可用宽度换行。两列使用 `minmax(0, 1fr)`，每项至少 44px 高。地址针关闭 flex 收缩。
- `SocialIcon` 增加平台映射，现有 Telegram 和 WhatsApp 的 `path` 数据与 Telegram 的 `transform` 与基线逐字相同。SVG 仍使用原 `viewBox`、`currentColor`、尺寸参数和装饰语义。首页车卡、公开车源及配件等原调用路径可继续使用已有参数。
- `SiteFooter` 组件只替换了地址图标。语言化站内导航、主站链接、联系锚点和站点品牌链接均沿用原目标。

## 验证记录

- 本审查者执行 `pnpm hooks:check`、指定文件的 `git diff --check`、两份 CSS 的 PostCSS 语法解析、两条原 SVG 路径的文本比对及联系方式配置的 Git 差异核对，均通过。
- 本审查者只读查看实现者保存的 1440px 中文和 390px 俄文截图。截图中联系方式均在文字左侧显示清楚的图标，窄屏联系区两列可读，位置针与地址分开对齐。截图位置及哈希见下表。
- 实现者报告 763 项单元、7 项边界检查和 standalone 构建通过。本地 3353 成品 `Nawdb3bfTqIEb7yht4KM1` 的原联系方式和导航两项 Chrome 回归通过。实现者另在 320、390、768、1440 四种宽度和三种语言核对八个联系图标的几何位置。运行结果归实际执行的实现者。本审查的动态证据来自上述记录与截图。

## 审查快照

| 文件或截图 | SHA-256 |
| --- | --- |
| `apps/web/src/shared/ui/contact-links.tsx` | `de95de7e5ca38c37952c730adcd58c1d96b2886a50027b7760377b7330eb54aa` |
| `apps/web/src/shared/ui/social-icon.tsx` | `eb84a88e4f5b79bf6911b897fe42701756b6749d1b96d6cacbadf93ccbab7778` |
| `apps/web/src/shared/ui/icon.tsx` | `660e641f91d2fc129c526170342add9d7d6da2bf462438d8d49501a76dd37811` |
| `apps/web/src/shared/ui/site-footer.tsx` | `8507445d105fa6bbd25615bad266d03b3303040cf752b7ab1d6df6cf4d0ab476` |
| `apps/web/src/shared/ui/brand.css` | `62406cd79edec9e03cb03d37dcc8274a064c72de53c1651fb1591c5a8ffa15fb` |
| `apps/web/src/shared/ui/site-shell.module.css` | `ea4e1c63abc58d852635dbf3746c21c2d15e08ddf3da307903a629a16c96883c` |
| `/private/tmp/hd-auto-footer-visual/footer-1440.png` | `5f74c3f4f19b79edd35efd1e198641c314b07a9c1a850acfbd77ec97e41f6c83` |
| `/private/tmp/hd-auto-footer-visual/footer-390.png` | `894393457d6bec34913d8bbc1fe8e74e588188aceaa9e8f554ef9b0463746e60` |

结论绑定本表六个代码文件。

# 正式域名与 HTTPS 部署记录

更新：2026-10-25（P1.16）。本记录描述实际接入，当前验证结论以[开发进度](./开发进度.md)为准。

## 当前入口与架构

正式地址为 [HD Auto Export](https://cars.hongdingauto.com/zh/buy/)。`cars.hongdingauto.com`继续使用阿里云DNS，A记录指向原VPS；未改NS，没有开通CDN、ESA或Cloudflare。

浏览器直接连接本站Nginx TCP443，使用Let's Encrypt证书和HTTP/2。服务器仍只托管Next静态`out/`，没有Node常驻进程或运行时计算API。仅正式域名的HTTP80跳转同路径HTTPS；原IP的HTTP站点保留用于维护，不作为推荐入口。

原VPN入口经用户明确授权迁出443，面板及订阅服务不变，具体管理信息留在私有运维记录。**不要再沿用P1.13中“443归VPN”的历史状态，也不要直接运行旧首次安装或全量恢复脚本。** Reality的外部节点连接端口与其内部伪装目标握手端口是两个不同参数；内部握手目标443无需随网站迁移而修改。

## 证书与续期

- 域名证书已签发，当前到期日2027-01-23。
- 使用Certbot `certonly --webroot`，验证目录`/var/www/hd-auto-acme`；`/.well-known/acme-challenge/`始终由HTTP80直接提供，不跳转或落入404。
- `certbot.timer`已启用；指定域名的`renew --dry-run --no-random-sleep-on-renew`演练通过。
- `/etc/letsencrypt/renewal-hooks/deploy/hd-auto-nginx`仅在该域名更新时执行`nginx -t`和`systemctl reload nginx`，已手动验证；不重启VPN。
- 证书和私钥放在Certbot管理目录，绝不复制到网站或Git。没有配置跨子域HSTS，避免影响主域其他服务。

续期复查：

```sh
sudo systemctl status certbot.timer
sudo certbot renew --cert-name cars.hongdingauto.com --dry-run --no-random-sleep-on-renew
sudo nginx -t
```

## Nginx 配置边界

新增`/etc/nginx/sites-available/hd-auto-cars`及对应启用链接，保留原IP站点和静态snippet。域名80只保留ACME及固定域名HTTPS重定向；域名443复用已有静态路径、真实404、RSC缓存及gzip。Ubuntu22当前Nginx1.18使用`listen 443 ssl http2;`，不能照新版本教程改成不支持的`http2 on;`。

本轮未更改原VPN程序、systemd unit、Reality/TLS记录、UUID和客户端入站归属。通过s-ui1.3.10官方API热更新单入站并重新生成导出链接，同时纠正原导出的本地回环主机地址；没有升级或重启面板程序。服务端与客户端必须使用一致的新连接端口；原443节点需手工改端口或更新订阅。

## 构建与发布

构建使用：

```sh
NEXT_PUBLIC_SITE_URL=https://cars.hongdingauto.com SITE_INDEXABLE=false pnpm build
```

保留noindex，未因绑定域名自动开放SEO；需要内容与规则审核后另行开启。三语canonical／hreflang均切为HTTPS域名，汇率仍为构建快照。

当前源码`9ba05f3`，成品213文件、5,288,372字节；SHA-256清单摘要`30217b39e7a9ef5ca7a2a80dc43d0764bbccb5b867753391f70c146d26ff6dea`。P1.16固定半透明头部及辅助导航状态修复；P1.15主站外链、俄语入口及25000 USD演示默认值保留。只更新静态文件和current。当前release：

```text
/srv/hd-auto/current
  -> /srv/hd-auto/releases/20261025T082026Z-sticky-header
```

P1.14版本`20261025T054803Z-domain-https`（源码bbe1c42、213文件、5,272,311字节，清单摘要25de21b986cb13e65088495bed896fb355176254847efa366daeea36e3360e4a）、P1.13旧版及旧hash资源均保留。第一次发布校验沿用了旧IP canonical断言，已触发保护自动回退；将断言纠正为本次HTTPS域名后，重新核对同一候选全部文件并成功原子发布，没有放宽检查。

本轮同时按用户要求弱化定金：顶部不再展示大号500，订单卡片无独立金色高亮，标题／摘要／FAQ标题去掉重复金额；正文仍按唯一配置准确说明500 USD及付款条件。

## 验证与回滚

最终静态构建及完整116项本机浏览器验收通过；三语七国静态路由、金额／公式、语言／身份／草稿、动效与剪贴板逻辑继续保留。正式域名公网24项验收通过，包含真实复制、三语指南、导航动效及费用交互；另21国家语言HTML／canonical、HTTP301和真实404通过。旧IP仍是HTTP，不作为HTTPS复制的验收地址。

VPN迁移前后均使用官方匹配版本临时客户端完成真实认证及代理出口验证；测试未修改本机系统代理，临时认证副本已清理。原客户端认证、TLS记录、防火墙与保护文件均检查；不是仅凭端口可连接宣称VPN可用。

只回退网页时，按[既有发布记录](./VPS-IP部署记录.md)原子切换current即可，不必改VPN或恢复数据库。若确需回退端口，必须先撤销本站443监听并平滑reload、确认端口已释放，再恢复原VPN入站；管理脚本和新备份只保存在管理员私有目录，后续使用前必须重新核对，不能盲目恢复整份运行数据库。

## P1.15 更新验收

本轮类型、5边界／12文件闭包、626单元、静态构建及完整116浏览器通过；三语购车／计算器在320～1440px共60布局无溢出。公网实际验证根入口俄语、默认USD／25000、12个三语主站外链、CNY草稿保留及USD恢复。VPN、证书、Nginx配置及服务主进程保持基线，无reload或重启；独立的新私有一致性备份保留。

本次正式域名另外15项购车／导航／手机／动效验收通过（46.1秒）；网站443、VPN8443及certbot.timer最终只读核对正常。

## P1.16 更新

前版`20261025T080759Z-about-defaults`保留；本轮建立新的私有一致性备份，逐文件核对后原子发布。服务进程／启动时间、保护文件、配置链接、防火墙保持基线，无配置修改／reload／重启。固定头部、辅助入口与统一锚点避让的维护入口见[交互动效](./路由性能与动效.md)；实际验证明细见开发进度。

正式HTTPS公网17项购车及导航／固定头部验收全部通过（51.8秒）；最终release、服务主进程及保护文件、VPN8443与certbot.timer已再次核对。

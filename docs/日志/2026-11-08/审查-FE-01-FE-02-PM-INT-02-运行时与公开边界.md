# 独立审查 / FE-01、FE-02 / PM-INT-02 运行时与公开边界
日期：2026-11-08（Asia/Shanghai）
审查者：`/root/fe_runtime_review`，非本轮实现作者。
状态：独立复查通过（原P1、P2均关闭；本次范围无剩余已确认阻断问题）

## 范围与版本

- 共同基线 `61dc7414b20a395d1d09e906a49d974763b3cce7`，共享分支 `codex/backend-foundation`，本次审查对象为未提交工作树。
- 仅审官网standalone配置／产物脚本、HTTP适配、公开同源代理、动态页面／metadata／sitemap、联系草稿和相关缓存。BE／AD／PM既有修改不属于本报告结论。
- 初审文件集合摘要（文件路径排序后的SHA256清单JSON再计算）：`0f6d602b6edb6867531521d2c057f033bdbadca2cc2df0194cec61ad329769fa`。实际交付后需由集成人核对最终diff／提交身份；本报告尚未绑定任何待推送SHA。
- 只读实现代码；仅写本报告。未构建、typegen、安装依赖、提交／推送／部署，也未操作3317／3318／3320或真实数据库。临时测试使用独立随机端口内存fixture和同一standalone成品，结束均关闭。

## 发现

### P1：浏览器返回历史恢复了已售／下架车辆的旧在售详情

- 位置：[动态详情](../../../apps/web/src/app/[locale]/cars/[slug]/page.tsx)、[PublicCatalogLink](../../../apps/web/src/modules/vehicles/ui/public-catalog-link.tsx)。
- 触发：Next客户端导航离开车辆详情，再通过浏览器Back返回；后台在离开期间把该车改为sold或archived。
- 独立复现：内存fixture先发布`fixture_future`，打开`/en/cars/fixture_future/`（available）；点击正文Back to curated catalog离开；fixture改sold；`page.goBack()`后等1.2秒，详情仍`data-availability=available`。随后再次离开、改archived、Back，仍恢复旧Available正文和Telegram／WhatsApp草稿。
- 对照：相同成品直接HTTP请求已返回sold新事实，故不是API事务或服务端fetch缓存；问题来自客户端历史Router Cache。`connection()`、`cache:no-store`及`prefetch=false`没有使Back／Forward历史段失效。安装版Next的`staleTimes`说明也明确这些设置不改变back/forward恢复行为。
- 预期：历史恢复不得把已售／下架车辆重新呈现为可购买旧状态；应重新校验公开事实，售出准确显示、下架撤销正文／联系。
- 建议：实现历史恢复的数据刷新／失效（并考虑浏览器pageshow恢复）；新增不依赖reload的真实浏览器回归，覆盖详情、目录及首页的旧库存恢复。
- 负责人：FE集成人。**已修复并独立复测关闭**，见下方最终复查；初审时曾阻塞本轮范围进入待验收。

### P2：详情服务故障时，无JavaScript首屏缺少可读错误和重试入口

- 位置：[详情load与metadata](../../../apps/web/src/app/[locale]/cars/[slug]/page.tsx)、[客户端错误边界](../../../apps/web/src/app/[locale]/cars/[slug]/error.tsx)。
- 独立复现：fixture将公开API切为unavailable，直接HTTP读取详情得到500，HTML不包含自定义“Vehicle information unavailable”，也没有`main#main`；该错误组件需客户端接管才呈现。
- 对照：启用JS后错误标题和Reload可用，API恢复后点击Reload成功回到详情；未发现内部API地址泄漏。
- 影响：无JS／脚本未加载的故障降级路径只能依赖浏览器手动刷新。正常资料SSR／无JS不受此结论影响。
- 处理：**已补服务端可读故障／重试状态并独立无JS复测关闭**，见下方最终复查。

## 已核对与实际验证

- 开工`pnpm hooks:check`通过。
- 独立运行`pnpm --filter @hd/web exec vitest run src/modules/vehicles/infrastructure/public-api.test.ts src/shared/lib/public-vehicle-contact.test.ts src/modules/vehicles/public-presentation.test.ts`：3文件、19项通过。
- 独立Chrome：语言菜单hover后预取，再改sold并点击，实际再次请求并准确显示sold；原先怀疑的语言预取陈旧问题没有复现，未列为缺陷。
- 独立Chrome／HTTP：Back恢复sold／archived的旧available事实已复现；JS详情故障标题／Reload及服务恢复后重试成功；无JS故障HTML缺少自定义正文已复现。
- 源码核对：公开代理仅GET允许列表，不接受管理／鉴权路径、任意目标或重复查询参数；不转发入站Cookie／Authorization，也不把上游Set-Cookie／私有头回传。schema验证公开JSON，媒体限制格式／体积，redirect:error，缓存no-store。
- 成品只读扫描：standalone未发现真实环境文件、docs/private或apps/api/admin产物；客户端JS未发现VEHICLE_API变量、内部origin或INTERNAL_FIXTURE_NOT_PUBLIC。仅数字常量中有3320/3327子串，不是网络地址。
- 原币金额以十进制字符串和BigInt格式化，未引入浮点金额运算；null事实未补造，demo声明与两个聊天草稿复用共享文案；实际车号／稳定ID／detailPath经过显式校验。

## 限制与交接

- 本次没有复跑作者整套653单元／构建／9接口浏览器作为独立结果；它们是作者提供证据，完整原有回归由FE另跑。
- 未验证生产反向代理／新服务器、真实库存／照片业务确认、Safari／真机及消息实发。默认noindex时未执行SITE_INDEXABLE=true下的动态sitemap全量HTTP验收；仅审查其manual+available过滤与错误时不返回截断结果。
- 本轮未提交、推送、合并或部署。原问题已使用更新成品独立复测关闭；任何后续源码变化仍需核对本报告范围和实际diff身份。

## 初审文件清单

```json
{
  "apps/web/next.config.ts": "59017cc8eff4962a3d35aabd79dc8a4d521d12ab4df58fe457ad19d8a3828980",
  "apps/web/package.json": "25e23e27e673a541b60c9d194c90f8285bcef603c3a84b96b307f034b60810ad",
  "apps/web/scripts/prepare-static-build.mjs": "9621983286bee51ff089be5a20cbdf0decd94c57a745410382df896c765a7c3e",
  "apps/web/scripts/prepare-standalone.mjs": "ba1aa09318f306f47af3daaac0a71516d52c05041b44b8573cb46a132324361f",
  "apps/web/scripts/start-standalone.mjs": "69e7939c2eb2e89ab61d2e70e7e7a94c96a338e038818dcaf12b9eb6747ba358",
  "apps/web/src/app/[locale]/page.tsx": "3ff044a79d123ae9ecf18dafb92f710c88e4abfb42a7b81334414d1702ee828b",
  "apps/web/src/app/[locale]/cars/page.tsx": "f986fcdb78fb6659061dd0e71c8f582513b504a89037b5c275e87c2a9d6cd4b2",
  "apps/web/src/app/[locale]/cars/[slug]/page.tsx": "58186fc9cfeb7fefdca2d37bd20c7b6cb4f99044b0a167bbfbb187639a0da288",
  "apps/web/src/app/[locale]/cars/[slug]/error.tsx": "55ffc30fca563972cb678a3afbd3df517b8e975a23d3acbea5f82e58b793f8d7",
  "apps/web/src/app/api/v1/[...path]/route.ts": "c8bb3a5dcb1aca51691503da8be0faedf9ddce847cab8c092ecbcddf4e9aa719",
  "apps/web/src/app/sitemap.ts": "9bd410bc7e28c868e498f9c85e5d530913fcd488fa4d9607137585cd401e8bc1",
  "apps/web/src/modules/vehicles/server.ts": "266ad0b3bb67008610e08d7a5bf1ba753f35bd106f4ecc3af8bb84e625bc1c2b",
  "apps/web/src/modules/vehicles/infrastructure/public-api.ts": "48d522f971c5f44ee0567a8a4ef49dc4a571947869f679768654b93af2b3ac5a",
  "apps/web/src/modules/vehicles/infrastructure/public-proxy.ts": "7e6ca521ae8b5b8fdad131e437fb15b0f8756161e612e6490c8a18e0c6fe7cec",
  "apps/web/src/modules/vehicles/ui/public-catalog-link.tsx": "bdb4f393a1823829ef20ea2c5806cbaee414ba793890103c005e5390d7c9347a",
  "apps/web/src/shared/lib/vehicle-contact.ts": "64db8f509d8bffa0973147bd0b8c41cc620fa262fdabc8f149bb3030e208662a",
  "apps/web/src/shared/config/vehicle-display.ts": "4a2d626eeab1e3206f9d743cf585ab67ee406aae3e95c9f874647da1e121ae0d"
}
```


## 最终独立复查（2026-11-08）

结论：原P1与P2均关闭；本次运行时／公开边界范围未发现剩余可确认问题。最终业务／视觉、真实资料与生产组合验收仍由PM／用户确认。

- 复查新增的 `InventoryFreshness`：持久语言布局监听历史恢复、persisted pageshow、窗口激活及可见性恢复，仅官网首页／车辆路径刷新；pending期间缓存main不可见，三语状态可读，事件／timer卸载清理。该处不访问API密钥或业务数据库。
- 详情已把PublicApiError转为服务端故障正文及原生重试链接，metadata明确noindex；缺失／下架仍走notFound，不把故障伪装为404。故障正文页面的HTTP状态为200，底层公开API仍为503，这是当前SSR降级行为，不记为成功取得车源。
- `src/proxy.ts` 对无效顶层页面语言输出完整品牌404，不接管正常三语、公开API、框架资源和已知静态资源路径；未解析不受信任HTML。根not-found为常规fallback。未知资源URL仍按资源404处理，不要求其拥有页面的三语品牌导航。
- 已独立启动新的随机端口standalone及内存fixture，设置E2E_BASE_URL和PUBLIC_FIXTURE_API_URL指向它们，运行：
  `pnpm exec playwright test tests/public-catalog.spec.ts tests/runtime-pages.spec.ts --grep "Back and Forward|detail service outage|filter service outage|invalid locale|320px Russian source demo" --output=/private/tmp/hd-fe-runtime-review-recheck-results`
- **5项真实Chrome全部通过（9.4秒）**：Back由旧available更新sold且草稿改咨询类似车；Forward目录不恢复旧车、再Back已下架显示404；无JS详情故障可读／noindex／原生重试恢复；facets单独故障保留成功目录并可恢复；320px俄文demo无JS可读可联系；无效语言与未知页面品牌404（其中相关组合在同一场景中执行）。
- 另直接HTTP核对：`/fr/cars/fixture_demo/`为404＋完整main／品牌文本／no-store；正常动态详情200，Cache-Control为private、no-cache、no-store、max-age=0、must-revalidate；管理路径代理404，未变成可访问后台。所有独立随机端口服务已关闭，没有操作共享服务或真实库。
- 作者提供的完整回归仍由作者／PM另行登记，未在此冒充独立全量运行。最终Git提交发生后，须核对本报告文件集合与实际提交，再按协作规则登记；此报告不授权推送或部署。

复查成品 BUILD_ID：`tUxSErSBV6zrAhOoTG8Or`。最终25文件集合摘要：`56e028ee2cd7437a72e1115bff8c95b395a3018ffaf9cd2269047d9a771a328a`。

```json
{
  "apps/web/next.config.ts": "59017cc8eff4962a3d35aabd79dc8a4d521d12ab4df58fe457ad19d8a3828980",
  "apps/web/package.json": "25e23e27e673a541b60c9d194c90f8285bcef603c3a84b96b307f034b60810ad",
  "apps/web/scripts/prepare-static-build.mjs": "9621983286bee51ff089be5a20cbdf0decd94c57a745410382df896c765a7c3e",
  "apps/web/scripts/prepare-standalone.mjs": "ba1aa09318f306f47af3daaac0a71516d52c05041b44b8573cb46a132324361f",
  "apps/web/scripts/start-standalone.mjs": "69e7939c2eb2e89ab61d2e70e7e7a94c96a338e038818dcaf12b9eb6747ba358",
  "apps/web/src/app/[locale]/layout.tsx": "25ea1cef7ea760998ccf9207ba94fb225d2eb33e8d41ceb6b953ee241b80aabe",
  "apps/web/src/app/[locale]/page.tsx": "3ff044a79d123ae9ecf18dafb92f710c88e4abfb42a7b81334414d1702ee828b",
  "apps/web/src/app/[locale]/cars/page.tsx": "f986fcdb78fb6659061dd0e71c8f582513b504a89037b5c275e87c2a9d6cd4b2",
  "apps/web/src/app/[locale]/cars/[slug]/page.tsx": "e6b24ad294684c336627068c1c96c0cb3d463f195d987a77dc2cc0feaeff5a7b",
  "apps/web/src/app/[locale]/cars/[slug]/error.tsx": "55ffc30fca563972cb678a3afbd3df517b8e975a23d3acbea5f82e58b793f8d7",
  "apps/web/src/app/api/v1/[...path]/route.ts": "c8bb3a5dcb1aca51691503da8be0faedf9ddce847cab8c092ecbcddf4e9aa719",
  "apps/web/src/app/sitemap.ts": "9bd410bc7e28c868e498f9c85e5d530913fcd488fa4d9607137585cd401e8bc1",
  "apps/web/src/app/not-found.tsx": "da04b864d855745c4d9bd3bb442b71f2d03405fbf9937bbf0f858dc608e6eb56",
  "apps/web/src/app/globals.css": "1be1dec74505cbdb1c626f21981e9a7feb5c4acd90fb80c6096a6db59d30923f",
  "apps/web/src/proxy.ts": "633b8c7aa739759ea3e2f26422b1b9696269504302c08d3289c1bdd09c85ea2c",
  "apps/web/src/modules/vehicles/server.ts": "266ad0b3bb67008610e08d7a5bf1ba753f35bd106f4ecc3af8bb84e625bc1c2b",
  "apps/web/src/modules/vehicles/infrastructure/public-api.ts": "48d522f971c5f44ee0567a8a4ef49dc4a571947869f679768654b93af2b3ac5a",
  "apps/web/src/modules/vehicles/infrastructure/public-proxy.ts": "7e6ca521ae8b5b8fdad131e437fb15b0f8756161e612e6490c8a18e0c6fe7cec",
  "apps/web/src/modules/vehicles/ui/public-catalog-link.tsx": "bdb4f393a1823829ef20ea2c5806cbaee414ba793890103c005e5390d7c9347a",
  "apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx": "c4db61ad34abf8cb11beabccffca0fcea639fe5e0766650c39523ccc293f50c5",
  "apps/web/src/shared/lib/vehicle-contact.ts": "64db8f509d8bffa0973147bd0b8c41cc620fa262fdabc8f149bb3030e208662a",
  "apps/web/src/shared/config/vehicle-display.ts": "4a2d626eeab1e3206f9d743cf585ab67ee406aae3e95c9f874647da1e121ae0d",
  "apps/web/src/shared/ui/inventory-freshness.tsx": "d5b586baf428b4717d22cd63184cfd102f60aed3fb9388bd30f128ddcc8bb366",
  "apps/web/tests/public-catalog.spec.ts": "ba8a2f0bf96e8619fdb4e1b8aba8910ea225eaa041aba807d062d93986a2cc17",
  "apps/web/tests/runtime-pages.spec.ts": "316c61cf40934228985599db4aadd217b60ee6ac385da97dc4d4c32ee4a87e7d"
}
```

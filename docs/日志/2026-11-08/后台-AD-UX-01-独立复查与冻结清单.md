# 后台 / AD-UX-01 / 独立复查与冻结清单
日期：2026-11-08（Asia/Shanghai）
独立 Reviewer：`/root/ad01b_review`（未参与本轮实现，仅只读检查；报告由根代理按实际返回结论登记）
结论：通过。代码审查5项P2已修复并独立复查，QA另发现2项窄屏布局P2已修复并定向复测；未处置P0/P1/P2为0。保留P3：320px首页卡头数量标签轻微截断，AD负责后续细节，不影响选车、排序和保存。

## 审查对象与独立性
- 分支 `codex/backend-foundation`，基线HEAD `61dc7414b20a395d1d09e906a49d974763b3cce7`；对象是未提交工作树，未伪造提交SHA或推送门禁。
- 范围为后台非生成源码／配置／测试（排除README与AGENTS）和根package／锁、官网package、CI配置。官网package只核对消费依赖／构建接口，FE源码不属于AD审查；相关contracts/API按消费边界核对，不代替BE全量审计。
- Reviewer实际执行hooks、类型、空白检查并核对源码、最终产物、QA日志；没有将作者自测冒充自己亲自跑完全部浏览器。

## 已修复问题
1. 已创建车辆仍可改来源且清本地字段后服务拒绝：已有record禁用来源控件并在handler再次拒绝。
2. 首页重载确认中慢GET取消后覆盖新输入：先完成同步确认，再锁定编辑读取；取消不读、失败保留本地。
3. 刷新列表后再选行会静默升级已选车辆版本：只为新增选择采纳表格对象，原选中对象和版本优先保留；升级必须显式核对。
4. 批量结果慢核对期间仍可移出／关闭而改变选择：busy与unknown期间锁定结果处理、关闭和完成入口。
5. 离开／换员工后迟到GET弹旧车信息：GET后先检查mounted，确认框保存引用并在卸载销毁，await后再次检查。
6. QA：长品牌320px撑宽编辑grid：minmax(0,1fr)和card/child min-width:0，未掩盖全页溢出。
7. QA：已选车辆首页grid被table撑宽：限定grid轨道及子项最小宽度，卡头允许窄屏换行，表格局部横滚。

## 实际验证证据
- Node24.19.0下 `pnpm --filter @hd/admin check`：44单测与类型通过（`/private/tmp/hd-ad-ux-node24-check.log`）。构建通过。
- QA最终同一成品20项Chrome契约回归通过（32.1s），`/private/tmp/hd-ad-ux-ui-final.log`；覆盖原恢复路径、批量旧版本/未知重试/核对锁定、首页冲突/取消/失败保留、品牌模型关联及布局。
- 最终成品Node24真实隔离API：demo pending发布、reviewed=false/unknown/on_request、字典／搜索／两首页区块保存与公开反映、批量成功1/失败1(DEMO_RESTRICTION)、390/320四Tab及列表／首页通过（19.3s），`/private/tmp/hd-ad-ux-live-final-pass.log`。
- 登录／草稿／Cookie真实场景和manual图片／三语／库存／发布／下架场景此前分别通过；最终只重跑demo大流程与20UI，不将三个场景冒称为同一轮完整通过。
- 3项最终成品布局定向通过：发布demo长品牌320、长筛选列表390/320、已有车辆首页390/320。根workspace28测试与扫描通过；空白检查通过。
- 根只读真实3318账号及PM两BYD样例截图，验证4个可编辑控件320滚动点击均在保存栏上方，无保存与业务写入；对比度#607278在白底5.03:1、hover4.79:1。PM另独立只读首页320复查，page/body/viewport320，table局部scroll650/client246；不冒称根手动操作IAB。
- 未覆盖生产部署、真实业务库存验收、Safari真机、全部API安全审计；Ant兼容属性与客户端use-client指令有弃用／打包警告，未作为功能异常或测试通过的替代。

## 最终产物与状态
- JS `index-BoU-iTTQ.js` SHA256 `ba3c2d72cbf1a897a9a62211c865519459f4d7322426b9a5ed6e1174d2109085`
- CSS `index-CgI7Bvzt.css` SHA256 `b82b5647de336286fb3ca7574cd0eb4882ce9914c0154b3e43b11e080e324cd0`
- 截图：`/private/tmp/hd-ad-ux-evidence/`（隔离测试）与 `/private/tmp/hd-ad-ux-preview/`（真实只读样例）；`workspace-demo-final.png`、`atto3-media-final.png`与`atto3-header-320-final.png`是本机实际资料界面。
- 3318保留Node24 Vite dev，3320由BE维护；冻结后两处HTTP状态200。未提交、推送或部署。PM本轮最终只读验收另见[PM-INT-02日志](产品项目-PM-INT-02-官网接入与后台体验升级.md)。

## 冻结指纹与文件清单
按路径排序，对每份文件拼接UTF-8路径、NUL、文件字节、NUL，再SHA256。总计 **50文件**，范围指纹：

`258abb41b82d65b2ac1bed86929b268ba03ad533e2c02266dd71800012f8e0e1`

| 文件 | SHA256 |
| --- | --- |
| `.github/workflows/quality.yml` | `4f76b3d867d5aa274245b346a6b5d8e4a87d211cf9361bf1059a01d3ee3e1daf` |
| `apps/admin/index.html` | `ac76b785825d181ec68895ff5dfa9e465e71d085f1cb200bb78471f929b3f02b` |
| `apps/admin/package.json` | `4d844ad58b050e5c375fbc6b8fff43a7713ced2b70f9114bb87c598019361256` |
| `apps/admin/playwright.config.ts` | `71ecfa08e6d7da2b0d4b9ae8a6b7d60d9c180892e41b81ff27dfb5f85ce70d08` |
| `apps/admin/src/main.tsx` | `7640da1577e8634c87213a88c72c78fb9a2e98e648376b93c062d192d4379295` |
| `apps/admin/src/modules/auth/index.tsx` | `276cc4b68adb4ac1dae8cde8e03d0141c2b3befc96d35371d7d0dfe7cbd38cb7` |
| `apps/admin/src/modules/home/home-sections-model.test.ts` | `326d2d2d4a422d4701707b026b31dbb940f6cf659ac99b48de6d23f456519f96` |
| `apps/admin/src/modules/home/home-sections-model.ts` | `de9f13931aad859eaedc9f79e61dd59f501151b77a35e2c131a1a4aba3a528fa` |
| `apps/admin/src/modules/home/home-sections-page.tsx` | `5e0f17c2ff59d4f2a8cef2619c891c6b4d20dcf1e321979ae517045db18250a7` |
| `apps/admin/src/modules/home/home-sections.module.css` | `c51d3a889490c7b8f1367c42b1000c3446357b3841f2d9b53bb1229890dff1a5` |
| `apps/admin/src/modules/home/index.ts` | `68ff4dcce0092cc449081f31918a0f2787271ce8cb8ca35396f3783c6ea24247` |
| `apps/admin/src/modules/vehicles/bulk-vehicle-actions.tsx` | `7bbb7c9c33a29e146ce6f02612026e3f6ebb2053e8163d522bcb04aff7124787` |
| `apps/admin/src/modules/vehicles/draft-form.test.ts` | `5462356f4a32d7c45724d183bd82f8709915f07881f578c710cf236f01331cb7` |
| `apps/admin/src/modules/vehicles/draft-form.ts` | `b39754b7e781aedbb388c108f5640ede2e8e00adc7d9b543a1372c05010735a3` |
| `apps/admin/src/modules/vehicles/index.ts` | `914b4113e2e2090a1fa7d5e8aeb50a33f9d4145d2a75b5dc5786279892c919dd` |
| `apps/admin/src/modules/vehicles/media-editor.module.css` | `7a151d684146b92c0ace9e917b50b6f2b16ddccdf2eeb68cfaf82cfe44bee1a9` |
| `apps/admin/src/modules/vehicles/media-editor.tsx` | `96dc647bf441021e92a926b0bfa084dd877b2f4cbbfd44defd9c6b2f29f7c6ff` |
| `apps/admin/src/modules/vehicles/media-upload.test.ts` | `dd9c8632f0a1322b67a73c63c74c5e70ea83200a1f612deb39b94d95059bfda7` |
| `apps/admin/src/modules/vehicles/media-upload.ts` | `0b035e792b20d432a23f56d940315d387f21d1d71587b0373dde772ed0693312` |
| `apps/admin/src/modules/vehicles/public-catalog-page.tsx` | `7925d745b64ae7cfc91f8c8aabc50fa944acf53d963dd508fa93453a128e0fb2` |
| `apps/admin/src/modules/vehicles/public-catalog.module.css` | `2f47eee7786cbf567813b8abaf60c4590353b940a9162a373eb61235efe65834` |
| `apps/admin/src/modules/vehicles/translation-editor.module.css` | `f336b5aa1e2dc4d25a7ecab2c755b92adc6f0f706a6afd8bfedf5d4bb14617c5` |
| `apps/admin/src/modules/vehicles/translation-editor.tsx` | `85a5d4fd4e0f8f7c1dcfb787dd8981d7dc585965f72310dc25c21d899b516db5` |
| `apps/admin/src/modules/vehicles/translation-model.test.ts` | `c9e1361b0f2434aacd3a2d7fb020f468078fa51dfbea6a72ac0b2429f4f8420d` |
| `apps/admin/src/modules/vehicles/translation-model.ts` | `79f838e46ea1734953be22b41c1bb0e7db65ccfb3007c8c1ada430f0d8cbd964` |
| `apps/admin/src/modules/vehicles/vehicle-actions-model.test.ts` | `feebb76977e722632eb0b32d2219dc2922dc37975e4d9e53452e5166628f85dd` |
| `apps/admin/src/modules/vehicles/vehicle-actions-model.ts` | `b0a16c6e2cfd6a40e5296ef63afe8b8442bf1cb42a682719923d428020c949e5` |
| `apps/admin/src/modules/vehicles/vehicle-actions.module.css` | `b64bd6be6cbed5eb67b8304d88efce657c0f91991f61eee5ea657dea2075a5ea` |
| `apps/admin/src/modules/vehicles/vehicle-actions.tsx` | `c53a21a5ac0cc08370b518a63b6fc10ba3292a647ce66e8d4e420d6512c76ad0` |
| `apps/admin/src/modules/vehicles/vehicle-editor-helpers.test.ts` | `1b11e07ed0620d2cab1027a55d002cebc121283d4a8642bd1cf1a8b370e2e8b3` |
| `apps/admin/src/modules/vehicles/vehicle-editor-helpers.ts` | `667d8e371648bfaccd5fa6ddd602f0546817546ca833cad1fa5fdac103672096` |
| `apps/admin/src/modules/vehicles/vehicle-editor-page.tsx` | `024b6ccd3a714a43e39884aa1c99bf34d077b645beb01d36aea2c535074a63d6` |
| `apps/admin/src/modules/vehicles/vehicle-editor.module.css` | `43a6fe111c76b97b0c0f7d999ae32f3da5c6fa93a2d54ee76f0a44e4f561b9e7` |
| `apps/admin/src/modules/vehicles/vehicles-page.tsx` | `2eedc2b48d77c2a54da773d1337df56a809c35a35e4eed4cbf8b536f4848b8a6` |
| `apps/admin/src/modules/vehicles/vehicles.module.css` | `48bc416f381231bf0f803341e7c80b8b072873c27664e0d5e8a09afa4f1825fa` |
| `apps/admin/src/shared/api/client.test.ts` | `c7ddd12f03c34bac1e2f73c98b285e85ca5c9802697da263ccfac5113d11fbca` |
| `apps/admin/src/shared/api/client.ts` | `851033eba82c12c11a59f262fb32dea9160e9230da25a0373a19bf658c82d8a7` |
| `apps/admin/src/shared/api/vehicle-dictionary.ts` | `3e790afa30c29c6fe6067527b567755808307521c63ce33c9107cbac78456f9e` |
| `apps/admin/src/styles.css` | `ac06fbfac5ee075bfcb48b4d21741e39b4cb2a6bd9789150e9e776fc3bfae8f7` |
| `apps/admin/tests/admin.spec.ts` | `65bc9a5a08004ecf7d9a1414a0bb32f38ef1273d8a4b524e3e3c90e589699a9f` |
| `apps/admin/tests/api-fixture.ts` | `7a78f15ae49cd9f4c77a2a0932725acd9915915dff893b9403164eb77f8fdb79` |
| `apps/admin/tests/live.spec.ts` | `ca21b59b1deb9975826c8890cb7424e5111682806c148be968e96a4f883ee47b` |
| `apps/admin/tests/run-live.mjs` | `a5bf62f5cb93133ff16f9f5c7899a5ea302e540b470b8221bac24cc47cbf560c` |
| `apps/admin/tests/ui-helpers.ts` | `96819f7f0177980564d9c99824e2de88f95e05b75224e1a48734eb5bdce42720` |
| `apps/admin/tests/ux-cases.ts` | `41f0327cc0c438ec9c638f2680dea144e42a2a6749d4c40d27bf4add83f379d1` |
| `apps/admin/tsconfig.json` | `fa4946ab2ec21473ae92ddcbd7d7cd6592be076f28781ce381d0ea01db4c5a8a` |
| `apps/admin/vite.config.ts` | `7ecd2c8e3ea3c510f9c1a929d9d526bac8af5e0c9c44a43f7c04defe0f5551bf` |
| `apps/web/package.json` | `25e23e27e673a541b60c9d194c90f8285bcef603c3a84b96b307f034b60810ad` |
| `package.json` | `0f67115ca0ef41cff798ceca80bd74deb7cf6ec6c7da81dce693525a51a049dc` |
| `pnpm-lock.yaml` | `6d88c5ea64949c82eb3a0ada121d8e6bcc489331e7dc57e7d74bb2ee1c4d0a8c` |

# 演示车源与图片来源

本目录仅用于页面演示，所有记录的 `source` 均为 `demo`，`sampleOrigin` 区分旧官网与韩国参考站样例，不能作为当前库存或真实报价。车型、图片、价格、年份及里程上线前均须重新核实；不得用作售卖承诺。公开接口是上一级 `index.ts`，未来接入服务时由适配层把三方数据转换为统一模型，并处理缺失值、可售状态、币种和来源；静态导出要在构建时生成详情路由，实时库存需要另设计服务端方案。

- BYD Seagull：图片来自公司旧官网 [BYD 产品页](https://www.hongdingauto.com/byd-new-energy-car-reliable--cost-effective-sustainable-mobility)，年份、里程、价格均是演示假设。
- Hongqi E-HS9：图片来自公司旧官网 [产品页](https://www.hongdingauto.com/faw-hongqi-e-hs9-460km-qixiang-edition-six-seat-luxury-new-energy-suv-with-advanced-electric-technology)，年份、里程、价格均是演示假设。
- Mercedes-Benz AMG G63：图片来自公司旧官网 [产品页](https://www.hongdingauto.com/premium-used-car-offer-mercedes-benz-amg-g63---ultimate-luxury--performance-in-a-pre-owned-vehicle)，年份、里程、价格均是演示假设。
- Kia K5 (Optima) 2 Generation：2026-11-04 参考站首页公开展示的 2017 年、170329 km、LPG、约 5071 USD（原价 6740000 KRW）仅作演示快照；图片未获取，使用中性占位图。来源：[参考站首页](https://www.kmotors.shop/en)。

## 参考站首页快照（2026-11-04）

以下 7 条逐卡片对应参考站首页当时返回的详情链接、型号、年份、里程、动力、原始韩元价格与页面折算美元价格，车型图片取自同一卡片的 `img`。美元是当时的近似展示值而非实时汇率，车身分类基于车型归类，非首页明示字段；不得认为车辆仍在售或允许从韩国出口。图片由 Encar 域名提供，保留原图水印；仅限本地演示，正式对外使用前必须确认图片和车源数据的权利及授权。

| 演示模型                     | 参考站当时详情地址                                       | 年份 | 里程 km | 动力     | 韩元原价 | 美元约 | 卡片图片来源                                                        |
| ---------------------------- | -------------------------------------------------------- | ---- | ------: | -------- | -------: | -----: | ------------------------------------------------------------------- |
| K5 (Optima) 2 Generation     | [41807723](https://www.kmotors.shop/en/catalog/41807723) | 2016 |  153884 | 汽油     |  7940000 |   5987 | [Encar](https://ci.encar.com/carpicture09/pic4179/41790043_001.jpg) |
| K8                           | [41290156](https://www.kmotors.shop/en/catalog/41290156) | 2023 |   79355 | 汽油     | 28430000 |  21439 | [Encar](https://ci.encar.com/carpicture07/pic4127/41279210_001.jpg) |
| The K9 (Quoris)              | [42666244](https://www.kmotors.shop/en/catalog/42666244) | 2019 |   47355 | 汽油     | 26440000 |  19938 | [Encar](https://ci.encar.com/carpicture05/pic4265/42659406_001.jpg) |
| Stonic                       | [42668873](https://www.kmotors.shop/en/catalog/42668873) | 2019 |   69616 | 汽油     | 12340000 |   9305 | [Encar](https://ci.encar.com/carpicture06/pic4266/42668867_027.jpg) |
| The New Sorento 4 Generation | [42525848](https://www.kmotors.shop/en/catalog/42525848) | 2024 |   54580 | 汽油     | 35430000 |  26717 | [Encar](https://ci.encar.com/carpicture02/pic4252/42524428_001.jpg) |
| K3 (Forte)                   | [42416997](https://www.kmotors.shop/en/catalog/42416997) | 2015 |   88870 | 汽油     |  5840000 |   4404 | [Encar](https://ci.encar.com/carpicture10/pic4240/42407233_001.jpg) |
| K8 Hybrid                    | [42446950](https://www.kmotors.shop/en/catalog/42446950) | 2022 |   39884 | 汽油＋电 | 27340000 |  20617 | [Encar](https://ci.encar.com/carpicture04/pic4244/42445877_027.jpg) |

## 严格首页复刻补充素材（2026-11-04）

`hyundai-vehicles.ts` 单独保存下列 8 条 Hyundai 卡片，并由 `vehicles.ts` 合并到公共演示车源，不覆盖已有 11 条记录。字段取自同日再次抓取的公开首页，因此折算美元可能与较早 Kia 快照略有变化；保留原样，不能当作统一实时汇率。`referencePriceKrw` 是当时卡片韩元金额，`priceUsd` 是同一卡片当时的近似美元，`transmission` 为原卡片 Automatic。`referenceUrl` 对应该样例自己的详情链接。车身分类根据车型归类，非参考卡片明示字段。

| 模型                       | 当时详情链接                                             | 年份 | 里程 km | 动力   |     韩元 | 约 USD | 本地图片                                            |
| -------------------------- | -------------------------------------------------------- | ---- | ------: | ------ | -------: | -----: | --------------------------------------------------- |
| Avante (CN7)               | [41201041](https://www.kmotors.shop/en/catalog/41201041) | 2023 |   38841 | petrol | 19940000 |  15011 | /demo-vehicles/hyundai-avante-cn7-2023.jpg          |
| Palisade                   | [42563484](https://www.kmotors.shop/en/catalog/42563484) | 2020 |   97282 | petrol | 19940000 |  15011 | /demo-vehicles/hyundai-palisade-2020.jpg            |
| Grandeur HG                | [40770427](https://www.kmotors.shop/en/catalog/40770427) | 2016 |   54843 | petrol | 12240000 |   9214 | /demo-vehicles/hyundai-grandeur-hg-2016.jpg         |
| Grandeur IG                | [42954110](https://www.kmotors.shop/en/catalog/42954110) | 2018 |  169702 | petrol |  9340000 |   7031 | /demo-vehicles/hyundai-grandeur-ig-2018.jpg         |
| The New Grandeur IG Hybrid | [42788517](https://www.kmotors.shop/en/catalog/42788517) | 2022 |   34216 | hybrid | 24240000 |  18248 | /demo-vehicles/hyundai-grandeur-ig-hybrid-2022.jpg  |
| Kona                       | [42825813](https://www.kmotors.shop/en/catalog/42825813) | 2018 |   70962 | petrol | 14140000 |  10644 | /demo-vehicles/hyundai-kona-2018.jpg                |
| Grandeur Hybrid (GN7)      | [42537021](https://www.kmotors.shop/en/catalog/42537021) | 2023 |   95692 | hybrid | 27940000 |  21033 | /demo-vehicles/hyundai-grandeur-hybrid-gn7-2023.jpg |
| All New Tucson             | [42559717](https://www.kmotors.shop/en/catalog/42559717) | 2019 |   31776 | petrol | 16640000 |  12526 | /demo-vehicles/hyundai-tucson-2019.jpg              |

所有 Hyundai 图片来自同一张公开卡片的 `img`，使用它明示的 640×400 变体，不更换车辆、不移除 Encar 水印。具体原图 URL 与本地文件关系见 `reference-homepage-sources.json`。图片与数据只供本地演示，对外发布须确认权利与可用性。

### 热门车型展示卡

`homepage.ts` 独立导出 `popularModels`，共 9 个车型家族，与单辆车的 `Vehicle` 记录分开。顺序与参考站一致：KIA Sorento、KIA Sportage、KIA Carnival、Hyundai Tucson、Hyundai Palisade、Hyundai Santa Fe、Genesis GV80、KIA K5、Hyundai Sonata。每项 `image` 对应原站该车型卡自己的 `sourceImageUrl`，文件保存在 `public/demo-vehicles/popular-models/`；不能为了补齐图片而拿其他型号或同品牌车辆替换。

`startingPriceUsd` 仅保存原站“from”卡片的演示金额，既不是 HD Auto 的落地价，也不属于任何演示单辆车的报价。名称及英文短描述为来源快照资料，页面多语言说明在 UI 语义 key 中维护；不要把英文描述作为缺失翻译的兜底。`referenceHomepageSource` 记录公开首页、捕获日期、仅本地演示与授权边界。正式平台适配器不应继承这些 mock 价格或韩国出口前提。

本轮不采集个人聊天评价截图，也不将第三方客户评价作为 HD Auto 真实客户背书。优势区图标可用本站独立图标表达相同结构，不需要复制第三方个人资料。

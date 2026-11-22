# 中亚目的国顺序与费用计算

固定 FE 工作树 `codex/fe-engine-power-footer`，基线 `cce1bff`。塔什干按乌兹别克斯坦关联。首页、完整计算器、详情页目的国共用注册表，顺序为吉尔吉斯斯坦、乌兹别克斯坦、哈萨克斯坦、塔吉克斯坦、土库曼斯坦、俄罗斯、格鲁吉亚、亚美尼亚、阿尔巴尼亚。显式 URL、已保存偏好和俄罗斯默认入口保持原行为。国旗源与现有旗帜一致，随 Next 输出内容指纹。[塔吉克斯坦国旗](https://flagcdn.com/tj.svg) · [土库曼斯坦国旗](https://flagcdn.com/tm.svg)

## 土库曼斯坦

- 覆盖 2026 年个人自用、原厂左舵、通常排量不超 3500 cc 的普通乘用车。制造年份不计，车龄 0 至 4 年分别采用 2%、10%、25%、40%、50%，和 USD/cc 下限 0.10、0.30、0.50、1.00、1.50 取高。合资格纯电免关税，普通混动关税按一半计。达到五年、右舵、超过排量范围或未核实的增程分类，页面提示确认并停止出价。[官方原文税则](https://www.customs.gov.tm/index.php/tk/customs-info/customs-fees/duties) · [主管部门车辆准入规定](https://www.customs.gov.tm/index.php/tk/customs-info/customs-control/68)
- 消费税为每 cc 0.30 USD，清关费为海关估价的 0.2%，个人自用海关估价不加运抵费用。各项换成 TMT 后保留两位再汇总。按海关官网申报工具列三项基本收费，公司进口、许可、认证、运输、仓储和登记不上算。[土库曼斯坦议会税法第 119 条](https://mejlis.gov.tm/single-code/10?lang=ru) · [海关法第 230 条](https://mejlis.gov.tm/single-code/11?lang=ru) · [清关收费](https://www.customs.gov.tm/ru/customs-info/customs-fees/fees) · [申报指南](https://customs.gov.tm/storage/posts/50/pdf/gollanma-ru.pdf)

## 塔吉克斯坦

- 普通进口 2013 年之前生产的车辆超出准入范围。仅由电机驱动且生产不足 12 个月的情景可计算进口关税、消费税、增值税免征后的应付项目。恰好 12 个月缺具体日期，旧纯电、混动、企业优惠和特殊类别需确认。[准入第 355 号令](https://jumhuriyat.tj/1371-arori-ukumati-umurii-toikiston-az-2-avgusti-soli-2023-355-sh-dushanbe.html) · [海关法免税修订](https://mmih.adlia.tj/Search/DocumentView?DocumentId=168028) · [税法第 251、286 条](https://ncl.tj/node/1605)
- 普通汽油、柴油个人进口的税率、税基和参考范围见下方复核。2026 年 VAT 为 14%，按税法第 250 条将关税、消费税、报关费、进口回收费等适用进口款项计入税基。[官方办事门户计税程序](https://tajtrade.tj/procedure/356?l=ru) · [塔吉克斯坦税法](https://andoz.tj/docs/kodex/Tax-Code__17_12_2025-RT_ru.pdf)
- 清关手续费按美元计税价值查档后折算 TJS。进口回收费附表 21 按 144 单位，2026 年每单位 78 TJS，合计 11,232 TJS，由海关在清关时收取。市场／参考汇率可手动换成清关当日公布的汇率。[清关费第 472 号令](https://tajtrade.tj/media/%E2%84%96472%20%D0%BE%D1%82%2002.12.2005%D0%B3..pdf) · [收费下限第 205 号修订](https://mmih.adlia.tj/SEARCH/DocumentView?DocumentId=148078) · [现行费用法](https://ncz.tj/node/1120) · [第 476 号令附表 21](https://www.andoz.tj/docs/postanovleniya-pravitelstvo/Qaror_476_2025_tj.pdf) · [2026 年预算](https://mmih.adlia.tj/SEARCH/DocumentView?DocumentId=173763) · [国家银行汇率](https://nbt.tj/ru/kurs/kurs.php)

## 维护与交接

各国税则在独立的 `policies/<country>/reference.ts`，核心使用单一派发表和币种映射。状态翻译、美元报价和高级输入共用已有组件，旧计算器储存的汇率及分享链接兼容。

- 官网成品构建、1,293 项单测和 7 项模块边界检查通过。Chrome 覆盖 161 个用例，首轮 160 个通过，唯一失败为已移除的电话入口仍被旧断言要求。更新该断言后单独复跑通过，并验证微信复制。新增用例覆盖三处目的国排序、三语静态路由、塔吉克斯坦燃油税率输入后测算及刷新保留、纯电优惠、土库曼斯坦车龄限制。独立审查无 P0／P1。
- 本机 3363 的中文首页、购车页及两个新目的国页面均返回 200，现可本地验收。生产未变更。验收原始收据存于 FE 工作区 `docs/private/fe-central-asia/`。

## 塔吉克斯坦税率复核

- 已从塔吉克斯坦海关档案下载并查阅两份俄语原始附表。第 470 号令附表 1（2025 年 6 月 10 日第 346 号修订版）中，普通 HS 8703.21–8703.24 汽油车及 HS 8703.31–8703.33 柴油车适用 10% 标准关税。第 335 号令（2025 年 5 月 29 日）附表第 78 行规定 HS 8703 消费税为 14%，且每 cc 排量至少 0.20 欧元。欧元下限按清关时适用的国家银行汇率换算。[海关档案](https://new.edavlat.tj/en/gumruk/documents/366) · [第 470 号令附表压缩包](https://new.edavlat.tj/api/files_storage/3467) · [第 335 号令附表压缩包](https://new.edavlat.tj/api/files_storage/3483)
- 当地 MBT、Robar 等计算器显示关税 10% 和消费税 14%，但仍使用旧的 0.15 欧元/cc 下限。2025 年第 138 号令已将下限调到 0.20，后由第 335 号令附表沿用。本站按附表预填三项数值并允许修改，旧草稿中未保存的税率自动补齐。[MBT](https://mbt.tj/rastamozhka?lang=ru) · [Robar](https://robar.tj/ru/tools/customs) · [第 138 号令官方公报](https://jumhuriyat.tj/5364-arori-ukumati-umurii-toikiston.html)
- 依据税法第 283 条，消费税从价额按海关计税价值计算。第 250 条规定的进口 VAT 税基另加适用关税及税费。个人自用估算直接使用输入的海关计税价值，未有核定值时用车价作起点；计算器不再自动叠加入境前运费或另列保险，实际计入的费用由海关核定。切换其他国家时不会把塔吉克斯坦核定值当车价。税法第 397 条规定 2027 年起进口 VAT 为 13%，但全套费用尚未按 2027 年复核，当前工具维持 2026 年估算范围。 [税法第 250、283、397 条](https://andoz.tj/docs/kodex/Tax-Code__17_12_2025-RT_ru.pdf) · [海关法第 310、355 条](https://www.wipo.int/wipolex/ru/legislation/details/23710)
- 官网成品构建、1,293 项单测、7 项官网模块边界检查及 10 项定向 Chrome 用例通过。覆盖三语页面、预填、手改与刷新、车辆详情转独立计算器；金额单测分别验证从价额与排量下限。增量独立审查通过，已修复核定值误传至其他目的国的问题。3363 中文页面返回 200，HTML 中有三项税率默认值和官方附表链接。收据存于 `docs/private/fe-central-asia/tj-tax-*`。本轮是本机验收版。
- v2.0.11 候选已基于主线 `7aef736` 冻结。本轮两项官网需求的组合验证及独立复查见[候选复核](前端-FE-ENGINE-POWER-FOOTER-发动机功率与页脚联系.md#v2011-候选复核)，待 PM 集成及 OPS 对现有域名做上线验收。

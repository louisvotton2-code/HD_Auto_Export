# 页面、组件与模块模式

从 [模块维护](../../../../docs/开发/模块维护.md) 与 [技术架构](../../../../docs/开发/技术架构.md) 只读本次相关章节：目录职责、依赖方向、路由／消息和当前运行方式。普通页面或后台任务无需通读计算器内部章节。以下是代码组织模式，不要求重写已有模块，也不要求每个模块建立全部目录。

本文件的 `src/`、`public/`、`tests/` 等官网路径均相对 `apps/web/`。管理后台在独立应用初始化后沿用适用的组件／可访问规则，不复制官网的 Next 路由、语言父布局或动效。

## 文件与依赖

```text
src/app/[locale]/<route>/page.tsx     路由参数、静态装配、metadata
src/modules/<module>/index.ts        供外部调用的函数、类型和页面出口
src/modules/<module>/types.ts        业务或展示契约
src/modules/<module>/ui/             页面、职责明确的组件与 CSS Module
src/modules/<module>/content/        按 locale 同形的静态内容（需要时）
src/modules/<module>/mock/           演示来源与数据（需要时）
```

沿用当前模块的命名和消息形状，文件使用已有的 `kebab-case`，React 组件／类型用 `PascalCase`。纯函数单测放相邻 `*.test.ts`，浏览器验收放 `tests/*.spec.ts`。只将实际被外部使用的契约导出到 `index.ts`；不把内部 UI 状态和 mock 表当成公共 API。

依赖方向：`app → 模块公共入口 → 模块内部`；模块可以依赖 `shared`，共享层不能反向依赖业务模块。首页接收车辆展示事实，不导入 `vehicles/mock`；供应商适配由独立 API 负责并输出公共契约，官网车辆模块仅将公开 DTO 映射为展示数据，页面不识别供应商字段。自动边界检查不能代替新增依赖的人工审查。

## 当前静态阶段的路由模式

本节描述当前实现；FE-01 官网运行时迁移须同步动态车源、元信息与测试方式，不能直接把以下构建期样例当实时数据库查询方案。

沿用本项目异步 `params`、`hasLocale`／`notFound`、`setRequestLocale` 与父布局的静态语言参数，不自行换一套国际化路由。现有列表页的组合模式如下，metadata 与静态参数在相应页面／布局维护：

```tsx
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { getVehicles, VehicleList } from '@/modules/vehicles';

type Props = { params: Promise<{ locale: string }> };

export default async function CarsPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <VehicleList locale={locale} initialVehicles={getVehicles()} />;
}
```

增加路径时同步静态参数、三语 metadata／canonical／hreflang、导航和需要收录的 sitemap；未知 slug 返回真正的 404。演示目录和详情始终不索引；全站是否开放索引仍由现有站点配置控制。不能依赖静态托管上不存在的 API、运行时重定向或请求头来补逻辑。

## 组件、内容与样式

- 页面负责装配；重复交互或独立状态提取为组件／hook。Props 使用明确类型并传业务事实；内容配置和 URL 生成不散落在 JSX。
- 仅有状态、事件或浏览器 API 的边界使用 `'use client'`；跨边界传可序列化数据，不把整站布局改成客户端来迁就单个按钮。
- 本模块新样式放相邻 CSS Module；全站 token 和真正共享交互放共享样式。先查现有选择器与覆盖顺序，不用不断追加覆盖来修局部问题。
- 视觉文案从本模块三语消息／内容取值；需要新增语义时三语同改。跨页面复用现有共享组件文案，不为同一组件维护多份翻译；动态内容的占位符须同形。
- 用真实 `<a>` 导航、`<button>` 执行动作，保留 `focus-visible`。不要让整卡链接包住其他链接或按钮；装饰图标对读屏隐藏，只有图标的联系入口有平台可读名称。

## 车辆数据与联系入口

现有库存均为演示，规则见[首页与演示车源](../../../../docs/开发/模块/首页与车源.md)。增加样例时记录来源、对应照片和使用限制，保留来源水印，不把韩国参考样车包装为中国现货。车型家族卡与具体车辆记录是不同契约，不能给家族卡编造年份、里程或库存编号。

所有具体车辆图卡与详情的 Telegram／WhatsApp 使用同一 builder：

```ts
import { buildVehicleContactLinks } from '@/shared/lib/vehicle-contact';

const links = buildVehicleContactLinks(
  {
    ...vehicle,
    id: vehicle.slug,
    detailPath: `/${locale}/cars/${vehicle.slug}/`,
  },
  locale,
);
```

当前 `slug` 是演示稳定标识，不是库存系统 VIN 或正式车源编号；未来接入真实数据由独立 API 提供正式标识和公开 DTO；SSR 同样经 HTTP 获取，不跨应用导入后端源码。共用 `shared/ui/social-icon.tsx`，外部新窗口链接保留 `noopener noreferrer`。无车参数的公司通用联系入口直接使用 `siteConfig`。不要自动发送消息、要求访客在站内登录聊天账号，或把机器人 `start` 参数套给普通 Telegram 用户。

## 参考站与动效

动效修改先读[首页动效还原记录](../../../../docs/research/首页动效研究.md)、[路由性能与动效](../../../../docs/开发/模块/路由与动效.md)。用户指定结构／样式还原时，实际打开对应页面，在同视口检查 DOM、计算样式、交互与连续帧；仅截图不能证明水波、轮播或 3D 已还原。记录观察依据与有意差异，工具无法访问时如实说明，不凭印象换布局或把功能测试当视觉验收。

- 平移动效优先 `transform`／`opacity`，有状态的 Canvas／pointer 动效独立于业务组件，卸载清理事件和 RAF。后台、离屏、暂停与减弱动效按现有生命周期处理，不引入新的无限渲染循环。
- 车轨用稳定外壳承担布局与 scroll-snap，内层承担 3D；指针坐标参照稳定边界。不要让按钮 hover 位移改变其命中区域并反复触发 enter／leave；不要用移除键盘焦点掩盖闪烁。
- 桌面悬停不得成为手机必需操作；尊重 `prefers-reduced-motion`，触屏／粗指针不强行倾斜。信息与链接在无 JavaScript 时仍可理解和使用，增强效果失败不能挡住内容。
- 复核桌面、320px 长俄文和正常手机宽度：页面不横溢出，按钮／文字不遮挡。可滚动横轨属于局部容器，不能把整页溢出当作轮播。

---
name: motionsites-web-builder
description: 为 HD Auto 官网的新落地页、首页区块或视觉改版设计响应式布局、首屏媒体和交互动效，并通过浏览器复核实际呈现。用于有明确视觉目标的前端任务。
---

# MotionSites Web Builder

从 [项目接手入口](../../../docs/README.md) 定位本轮范围，[路由与动效文档](../../../docs/开发/模块/路由与动效.md) 说明现有动效。将下列方法用在任务涉及的页面和组件中，沿用项目的 Next.js、React、主题和国际化结构。

## 设计与实现

1. 有现有页面时，先在浏览器观察桌面及窄屏效果。确定用户首先要看到什么、要完成什么操作，以及品牌和素材限制。
2. 从[设计指南](references/craft.md)选择布局、字体、对比度和留白。从[动效索引](references/techniques/INDEX.md)挑选契合内容的效果，再读对应实现。需要参考上游示例时，打开[原版示例索引](https://github.com/Motionsites-AI/claude-skill/blob/faa30d512e3973e58675c72101a7ef42ed37ae83/plugins/motionsites-web-builder/skills/motionsites-web-builder/examples/INDEX.md)，提取适用的设计手法。
3. 用[规格模板](references/spec-template.md)整理本轮所需的界面、断点、媒体和动效参数。为实际车型、价格和联系方式使用项目数据，为中、英、俄三语留出布局空间。
4. 将参考代码适配为现有组件。用 CSS 实现基本过渡，按需增强交互。首屏保持可读和可用，按需加载视频或 3D，处理触屏、键盘焦点、`prefers-reduced-motion` 和媒体回退。素材选型见[媒体指南](references/assets.md)。
5. 用项目现有的 Playwright 或浏览器检查实际页面，按[视觉验收表](references/review.md)审查首屏、窄屏溢出、图片和视频加载、交互、焦点和减少动态效果，并修正观察到的问题。记录实际检查场景和未覆盖项。

[MotionSites 上游版本](https://github.com/Motionsites-AI/claude-skill/tree/faa30d512e3973e58675c72101a7ef42ed37ae83) · [许可证](LICENSE.md)

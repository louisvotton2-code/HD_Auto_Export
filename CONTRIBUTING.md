# 开发与维护

先读 [开发进度](docs/开发进度.md)，确认当前可用能力和未完成事项；再按根目录 [AGENTS.md](AGENTS.md) 的顺序阅读 [README](README.md)、[模块与维护指南](docs/模块与维护指南.md)、[技术架构](docs/技术架构.md)、开发交接规划和参考规则研究。长期规划不是已实现功能清单。

## 建立本地工作目录

```sh
git clone https://github.com/louisvotton2-code/HD_Auto_Export.git
cd HD_Auto_Export
nvm use
pnpm install --frozen-lockfile
pnpm dev
```

`.nvmrc`记录本轮验证的Node版本；未使用nvm时自行提供同版本运行时。pnpm版本以`package.json`的`packageManager`为准，当前为11.25.0；不要生成npm或yarn锁文件。Chrome浏览器供现有Playwright配置使用。

环境文件从`.env.example`复制，只在本地填写；默认预览禁止索引。修改部署域名、端口或索引设置需要重新构建，不能只改服务器环境变量。

## 目录与依赖规则

- `src/app`只装配路由、页面、布局和SEO。
- `src/modules/calculator/index.ts`是供其他业务模块调用的计算公共入口。
- `core`与`policies`计算层不读取网络、翻译、React、浏览器或当前系统时间，日期和汇率显式传入。
- `application`组织默认输入、草稿、复制参数、格式化和页面展示事实；`ui`处理交互，不复制税率和公式。
- 翻译按现有语义key维护中英俄三份；计算说明由各国`method-messages.ts`提供，不再复制到基础JSON。
- 未来车辆、配件、物流在各自模块实现，只通过计算公共入口接入，不依赖计算器表单或内部策略；当前不建立空模块或假接口。

详细目录职责、公共接口示例和修改入口见[模块与维护指南](docs/模块与维护指南.md)。

## 验证与提交

```sh
pnpm check
pnpm build
pnpm test:e2e
git diff --check
```

`pnpm check`包含类型、模块边界防护和单元测试；浏览器验收直接使用构建后的`out/`，应先构建。根据改动选择相关页面验收；计算规则和公共契约改动须保留独立金额回归与说明／复制同步验证。当前公共边界检查不等于全仓库所有层级依赖都已自动检查。

`.github/workflows/quality.yml`在push、pull request或手动触发时执行锁依赖安装、上述检查、静态构建与Chrome验收。它只有仓库读取权限，不连接VPS、不读取部署凭据、不自动发布。工作流使用官方[checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)与[pnpm安装动作](https://github.com/pnpm/action-setup)；远端实际运行结果以GitHub Actions为准。

修改功能、约束、部署方法或发现限制时，同步更新[开发进度](docs/开发进度.md)中的阶段、实际验证结果和下一步；不得把未执行的检查写成通过。

新工作建议使用`codex/`分支，经审查合并到`main`。提交前检查`git diff --cached --stat`与`git diff --cached --check`。源码、锁文件、测试、品牌资产、维护文档和通用部署模板进入版本控制；`node_modules`、`.next`、`out`、浏览器报告、真实环境文件、密钥、数据库和私有备份不提交。`.env.example`只包含公开占位配置。

## 更新服务器

代码提交与服务器发布是两件事。Git推送不自动连接、重启或部署VPS；网站只需要Nginx托管静态成品，无Node常驻服务。

维护当前试运行站点先读[实际VPS部署记录](docs/VPS-IP部署记录.md)，新服务器参考[通用部署指南](docs/服务器部署.md)。更新只创建本站release并原子切换，保留旧版本和哈希资源；不能重复首次安装、接管VPN端口或重置防火墙。密码、SSH密钥和数据库备份通过仓库之外的安全渠道管理。

当前公网IP为HTTP；按用户决定保留标准剪贴板接口，待HTTPS启用后复验复制。七国金额仍是2026参考实现，官方规则核验与完整落地成本仍在后续范围。

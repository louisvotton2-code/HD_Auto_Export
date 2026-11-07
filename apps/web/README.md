# 官网 @hd/web

这是原官网的完整迁入位置，页面、资源、测试与应用工具各自保留。仍为静态导出，真实后台、API 和库存未实现。

从仓库根执行：

```sh
pnpm --filter @hd/web dev
pnpm --filter @hd/web check
pnpm --filter @hd/web build
pnpm --filter @hd/web preview --port 3100
pnpm --filter @hd/web test:e2e
```

本应用 `.env.example` 是无密钥配置示例；真实环境文件不提交。产物 `out/`、缓存 `.next/`、测试输出均属于本目录，不共享给其他应用。端到端测试只针对最新构建，外部测试地址使用 `E2E_BASE_URL` 显式指定。

职责和功能顺序见 [前端任务](../../docs/协作/前端.md)，每轮交付写对应角色摘要及仓库集中日志。计算公共入口目前仍为 `src/modules/calculator/index.ts`；暂不从尚未实现的公共包导入。

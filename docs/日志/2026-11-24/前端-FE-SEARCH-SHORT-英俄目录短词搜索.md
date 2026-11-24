# FE-SEARCH-SHORT 英俄目录短词搜索

- 本轮基线为 `v2.0.19`／`4ee3bbd`，固定前端工作树和 `codex/fe-search-short-query` 分支。已核对 Git hooks，保留先前未提交的文件。
- 旧链接和客户端使用 BE 的 `publicCatalogSearchIssue`，拦截英俄无品牌或车型的短词搜索。旧链接保留关键词和筛选，提示显示在搜索框下。若没有已加载的品牌可选，用户可清空关键词并保留其他条件以浏览品牌。短词页面停用列表、筛选和恢复发起的请求。同源代理返回 `400 CATALOG_SEARCH_TERM_TOO_SHORT`。
- 有品牌或车型时，列表、匹配总数和已选范围的车型、配置仍按实际短词过滤。用于切换品牌的侧栏概览使用原价限下的目录选项，概览数字和结果总数采用各自口径。中文、空查询、完整咨询编号保留原查询路径。
- 隔离使用 Next standalone 与回环数据夹具。BE 共享契约对照：`common.ts` SHA-256 `389155396e42af60a9160a94211872bde8dc12c0091b37cc5ec367ed1559c4cd`，`public.ts` SHA-256 `c9398a5d7677296e2f542e0cbbeaa9eea65525d03f95ea5e978bbe6a8ee4b8d1`。依次执行 `pnpm --filter @hd/contracts build`、`pnpm --filter @hd/web check`、`pnpm --filter @hd/web build`，通过 1,314 项单元与 7 项边界测试。
- Chrome 执行 `catalog-filters.spec.ts`、`public-freshness.spec.ts`、`vehicle-history-pagination.spec.ts` 共 42 项通过。390px、无 JS 和俄语深分页旧链接验证提示及上游零请求，临时短词提交和历史前进、后退验证零目录、筛选和 RSC 请求。另验证品牌和车型范围、撤销品牌、清空后同 URL 读到新结果、完全匹配的咨询号、中文短词和详情返回。
- 独立审查核对了清空后读取原查询以及换品牌时旧车型失效的修复，最终无 P0/P1。生产网关协议 4 可能在普通文档回源前探测浏览缓存代际，该控制请求需要同版 QA 与 OPS 验证；真实数据库、生产网络与发布尚待集成。先纳入 BE 共享契约再集成官网提交，合并候选执行仓库推送门禁。

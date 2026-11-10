# 后台 / AD-INT-01-02 / 公开车型品牌筛选复查

日期：2026-11-08（Asia/Shanghai）
状态：待验收（修复、自测与独立复查通过，重新冻结）

## 范围与版本

- PM转交独立QA的P2：不同品牌可以共用相同model.id，原公开目录未选品牌时同时列出这些车型，但option value仅id，导致选择其中一个品牌车型时查询跨品牌，显示数量与结果不一致。
- 保持 `codex/backend-foundation`，HEAD `61dc7414b20a395d1d09e906a49d974763b3cce7`；本轮为既有未提交工作树上的最小补丁。仅修改公开目录页面及追加对应浏览器回归、AD日志和角色摘要。
- PM正在独立IAB标签页验收HD-000003，本轮未读取或修改该车，也未操作IAB标签页；测试使用独立Chrome和合成响应，没有操作数据库。

## 实际修复

- 未选品牌时禁用车型选择并提示先选品牌，不再混列不同品牌的同ID车型。
- 选品牌后仅列该makeId下的车型，车型请求总是与品牌成对；切换／清空品牌会清除车型与页码。
- 直接URL只有model而没有make时，计算查询参数时即忽略孤立model、返回第1页；随后replace移除model/page，保留语言／动力等其它条件，地址、控件和实际查询一致。

## 验证

- `pnpm --filter @hd/admin build`：TypeScript和构建通过。保留原react-router客户端指令警告，无新增失败。
- `pnpm --filter @hd/admin exec playwright test tests/admin.spec.ts -g 'public catalog scopes'`：1项Chrome定向契约回归通过（3.5s）。两品牌共用model.id，分别选择／切换／清空、初始禁用与提示、孤立model URL规范化、所有带model请求必须带make均通过。
- 此测试使用同公共schema合成数据并拦截响应，用于复现筛选歧义，不冒充本轮真实API联调。未重复已通过且本补丁未触及的上传／发布／下架全链路；历史真实证据见[上一轮交付](后台-AD-01b-AD-INT-01-本地单车闭环与试用.md)。
- `git diff --check`通过。构建JS `index-DvJlpK88.js` SHA256 `d7ea9d65f0452f5ae5edf6fe6186b84778e9dfacd168b783b937aeb28865ff4c`；CSS `index-BsZAJjUv.css` SHA256 `e2c518a1ab62c3a268bcc58a05463c0d895d19f24d8075cb51a222a1f7531025`。
- 独立Reviewer `/root/ad01b_review` 复查通过，车型跨品牌P2关闭，未发现新增可确认P1/P2；Reviewer自行执行后台typecheck通过，并核对根提供的构建／定向回归结果和实际产物。沿用前轮33文件范围及“排序路径＋NUL＋文件字节＋NUL”算法，新快照SHA256为 `3e4c9266fdbdb46e75f69b0d095408915660fddf370a4a2fc4850e147bd75012`。未将未提交快照冒充提交SHA。

## 交接

- 后台3318与API3320继续运行；未提交、切分支、推送或部署。PM可继续其独立标签页和原测试车验收。
- 本日志补充并替代上一轮报告中的“最终”源码／产物快照；上一轮历史测试结果仍只对应当时的实际范围。

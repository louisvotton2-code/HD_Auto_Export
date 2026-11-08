# 项目助理 / PA-DATA-01 / 第三方车源本机发布
日期：2026-11-08（Asia/Shanghai）
状态：本机已发布，待用户验收（非生产、非自有已核验库存）

## 范围与版本
- 本机验收环境通过管理 API 新建 8 条第三方来源草稿，原始来源、图片、哈希、请求准备和操作状态留在忽略的 `docs/private/PA-DATA-01/`。不涉及生产。
- 工作树含其他角色未提交改动；本轮未提交、推送或部署。

## 实际变更
- HD-000008 至 HD-000015 均为 external 草稿、unknown 库存及空核验时间；8–9 张图／车，共 71 张，三语待审核。图片来源逐张记录，许可标记未核验，仅供本机验收。
- 奇瑞挂牌里程与仪表照片不一致，结构化里程为空，三语和内部记录注明差异。部分新能源挂牌的燃料字段与车型描述冲突，动力类型暂记未知。

## 验证与限制
- 通过实际管理 API 逐车读取并核验草稿、库存、翻译状态、图片数量、ready 状态、来源声明和单封面；8车均 version 2。导入前 7 条现有记录及首页配置与导入后读取一致。
- 上传过程中遇到 HTTP 429；等待限流窗口并降低请求频率后继续，完成核验。独立来源／图片审查由 PM 协调；本次管理 API 导入结果尚待独立复核。
- 尚未发布或更新首页；官网 external 消费兼容性待 PM／FE 确认。第三方库存、出口资格和图片生产使用许可均待核验。

## 交接
- 等待官网兼容性确认后再执行已授权的发布和首页配置；保留 HD-000006／007。

## 本机发布与公开核验
- 经 PM 放行后通过管理 API 发布 HD-000008–015；首页更新为 version 3，第一组按序 008、009、013、010，第二组按序 011、012、014、015，三语标题标注第三方来源及库存待核验。原 HD-000006／007 仅从首页移出，记录未改。
- 实际读取三语公开详情、首页顺序、unknown/null 库存、reference 价格、reviewed=false 及来源信息；每车图数 8–9，所有 71 个原图和缩略图各可读取并解码，缩略图宽度不超过 240px。三语图片 ID 与顺序一致；未单独断言各语言 URL 字符串一致。公开 DTO 未见 internal 与 externalId。旧7条管理记录与导入前快照一致。
- 公开读取遇到429，等待限流窗口后降低速率完成；已停止读取和写入本机 API。记录见忽略目录 `docs/private/PA-DATA-01/public-verification.json`、`publication-state.json`。仅为本机验收，生产图片许可、库存及出口资格仍待核验；最终视觉和业务验收未执行。

## 价格口径补充
- 本机 HD-000008–015 三语描述追加供应商 FOB 南沙挂牌参考价、非本公司确认报价及费用待确认说明；原里程差异说明保留。逐车按当前版本保存两次以更新源文本与 pending 译文，重新发布后均为 version 6。
- 逐车读取三语公开 DTO，确认说明、reviewed=false、价格、图片 ID／URL 与顺序一致；管理数据对比确认来源、事实、价格、库存、图片及标题未变。原7车及首页 version 3 未变。未重新下载图片；完整记录在忽略目录 `docs/private/PA-DATA-01/price-disclosure-state.json` 和 `price-disclosure-verification.json`。操作后已停止本机 API 读写。

## 最终交接索引
- 本机数据冻结：8 辆均 version 6，首页 version 3；非生产发布，第三方库存、出口资格及图片生产使用许可待核验。
- 完整预备数据与图片来源：`docs/private/PA-DATA-01/payload-preparation.json`；图片哈希：`docs/private/PA-DATA-01/hashes.txt`；草稿导入状态：`docs/private/PA-DATA-01/import-state.json`。
- 发布记录：`docs/private/PA-DATA-01/publication-state.json`；公开核验：`docs/private/PA-DATA-01/public-verification.json`；FOB 更新记录：`docs/private/PA-DATA-01/price-disclosure-state.json`；FOB 核验：`docs/private/PA-DATA-01/price-disclosure-verification.json`。上述私有文件均不提交。
- 车辆编号及 UUID：
  - HD-000008：`45b87e86-e6c6-4d78-a912-0ef2e505481d`
  - HD-000009：`b14ba40b-f65a-4ee1-99ef-efdc6d71e650`
  - HD-000010：`cb57d045-f243-499c-b47b-06373261a9c3`
  - HD-000011：`7002cc86-63f2-49b5-9bb9-93a9b0eb0404`
  - HD-000012：`386e16e8-8571-4ad9-8a34-313b4445482d`
  - HD-000013：`58b797b2-9bb1-478d-abee-54a9e8e3cc88`
  - HD-000014：`5f0828d3-031d-4c81-ba5c-e39969ee0298`
  - HD-000015：`eb6aaa7f-1637-4691-bc46-02f37b15da4b`

## 用户纠偏后的本机数据调整
- HD-000008–015 更新三语中性描述及 FOB 参考价说明后重新发布，均为 version 9；来源、事实、价格、unknown 库存、图片和标题未变，译文 pending。HD-000010 里程仍为 null，描述及内部资料保留挂牌和仪表差异。
- HD-000006／007 下架至 archived，均 version 7；后台草稿、图片和审计保留，公开详情返回 404。首页未引用两车，配置保持 version 3。
- 三语公开描述、价格、图片 ID 顺序及后台数据已逐车核验；没有重新读取 71 张图片。操作状态与核验结果分别在 `docs/private/PA-DATA-01/neutralize-state.json` 和 `docs/private/PA-DATA-01/neutralize-verification.json`。完成后停止本机 API 读写，可供备份。
- 按本轮要求保持 home v3 未变：其数据中的分组标题仍有第三方及库存待核验字样，官网展示文字需由 FE／PM 按用户纠偏协调；不能将首页数据本身描述为已清理。

## 首页标题最终更正
- 根据后续明确授权，仅更新两组中英俄标题为“精选车源／更多车源”及对应译文；组 ID、车辆及顺序不变，首页 version 3 → 4。
- 读回三语公开首页，核对标题、车辆顺序及可见标题／描述无此前第三方和库存待核验模板词；来源元数据保留。证据：`docs/private/PA-DATA-01/home-titles-state.json`。操作后停止本机 API 读写，数据冻结。

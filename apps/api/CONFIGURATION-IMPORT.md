# REL-103 三语配置导入

`@hd/contracts/admin` 提供 `ConfigurationImportDocumentSchema`、`parseConfigurationImportJson`、`configurationImportExample`、两个请求 schema 和 `ConfigurationImportPreviewResponseSchema`。

```json
{
  "version": 1,
  "facts": {"powertrain": "petrol"},
  "items": [
    {
      "id": "cfg-63214f4d6570",
      "name": {"zh": "挡位数", "en": "Gears", "ru": "Количество передач"},
      "value": {"zh": "8", "en": "8", "ru": "8"}
    }
  ],
  "content": {
    "title": {"zh": "车辆展示样例", "en": "Example vehicle", "ru": "Пример автомобиля"},
    "description": {"zh": "车况以实际检查为准。", "en": "Condition is subject to inspection.", "ru": "Состояние уточняется при осмотре."}
  },
  "display": [
    {"ref": "model", "text": {"zh": "车型展示名称", "en": "Model display name", "ru": "Название модели"}}
  ]
}
```

- `version` 为文件格式版本。至少提供 `items`、`content`、`display`、`facts` 之一。每个提供的多语字段都要有中英俄非空文本，现有槽位的非空判断沿用 v1.0.2。JSON 原文按 UTF-8 限 512 KiB，禁止重复属性、重复 ID、额外键和非法数据库字符。
- `items` 提供 1–200 项，按文件顺序替换整份配置。省略时保留原配置。用 `vehicleConfigurationItemId(name.zh)` 生成现有格式的 ID，改中文名对应删除旧项并新增一项。中文名及值进入原配置存储，三语展示进入原语言记录。纯数字、单位和标识等按现有配置规则原样展示，中文值无汉字时三个值须完全一致。名称最多 100、值最多 500 UTF-16 单元，中文名称和值合计最多 16,000。
- `content.title`／`content.description` 对应标题和车况正文，每语最多 10,000 UTF-16 单元，省略的字段原样保留。已有原文留存。原文空白时使用导入的中文建立原文。
- `display` 补充既有公开展示字段。可使用 `GET /api/v1/admin/vehicles/{id}/translation-bundle` 返回的 `localization.data.fields[].ref`，包括品牌、车型、款型、代系、地点、外部平台展示名、图注、价格包含项。仅导入已有引用。配置项由 `items` 承载。报价、动力型号和代系等结构化事实沿用现有字段入口。
- `facts.powertrain` 可显式填写 `petrol`、`diesel`、`hev`、`phev`、`erev`、`bev`、`lpg`、`other`。变更在预览中以 `facts.powertrain` 的枚举前后值表示，员工确认后随配置和译文同事务保存。省略保留该车原值。文本不参与推断，`unknown` 和 `null` 不能用于导入。草稿仍为 `unknown` 时，在配置页明确显示动力选择入口。可把员工选值合并进导入文件后重新预览，或对已经保存的草稿使用仅含 `version` 与 `facts.powertrain` 的同一流程。
- 被明确提供的标题、正文、展示字段和配置槽位按导入值更新。原文绑定和译文均未变时保留原译文的来源和审核状态。新增或变化的文字标记待审核。为历史草稿补建标题或车况原文后，会把该字段三语重新绑定并标记待审核。省略的内容、展示字段和已发布快照继续保留。

## HTTP

先取 `GET /api/v1/admin/vehicles/{id}/translation-bundle` 的 `data.vehicle.version` 和 `data.localization.revision`。导入应针对已保存的草稿。

1. `POST /api/v1/admin/vehicles/{id}/configuration-import/preview` 接收 `{ "version": 7, "localizationRevision": 4, "json": "<原始文件文本>" }`。响应 `data` 为 `{version, localizationRevision, previewToken, changes, itemOrder}`。预览不写库。每个 `changes` 条目为 `{path,before,after}`，缺项用 `null`。配置顺序发生变化时 `itemOrder` 返回前后 ID 数组，否则为 `null`。
2. `PUT /api/v1/admin/vehicles/{id}/configuration-import` 接收相同字段加 `previewToken`，一次事务保存。响应沿用 `VehicleTranslationBundleResponseSchema`，可直接刷新草稿及语言版本。令牌绑定员工、车辆、两个版本和原始 JSON 字节，10 分钟有效。文件修改、版本冲突或令牌失效需重新预览。禁止先 PATCH 配置再保存多语。

两条接口均走员工会话、Origin 和车辆写权限。常见状态为 `400 INVALID_REQUEST`（带字段路径）、`401`／`403`、`404`、`409 VERSION_CONFLICT`、`413 PAYLOAD_TOO_LARGE`。接口更新草稿，发布仍经既有预览和确认流程。导入处理无翻译供应商调用。

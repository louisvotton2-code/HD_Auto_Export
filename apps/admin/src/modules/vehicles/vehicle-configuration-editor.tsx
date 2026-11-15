import { useEffect, useState } from 'react';
import { App, Button, Card, Collapse, Form, Input, Space, Table, Tag, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { VEHICLE_CONFIGURATION_LIMITS, vehicleConfigurationExample } from '@hd/contracts/admin';
import styles from './vehicle-configuration-editor.module.css';
import { configurationPowertrainOptions } from './configuration-facts';
import type { DraftForm } from './draft-form';

export const configurationExample = JSON.stringify(vehicleConfigurationExample, null, 2);

const configurationAiPrompt = `你是车辆配置检索与结构化助手。请先联网查找该车辆对应的技术参数和装备配置，再整理成后台可直接导入的 JSON。基础资料用于定位车型。

检索目标

尽量找到不少于 50 项真实、可核实的技术参数和装备配置，最多 ${VEHICLE_CONFIGURATION_LIMITS.items} 项。准确性优先于数量。资料不足时只输出已核实的项目，不得为达到 50 项编造配置、重复拆分数据或借用相近车型参数。不得未经检索就仅返回“车身形式”等泛化信息。

车型定位

根据品牌、车型、年款和配置款型定位车辆。必要时核对销售市场、动力版本、发动机、驱动形式和完整款型名称。
年款、生产日期和首次登记日期是不同概念，不能互相替代，也不能根据首次登记日期推断年款。中文标题中的测试文字和广告描述不作为匹配依据。
不得混用不同年款、配置、动力版本或销售市场的参数。配置名称不完整时，先查完整车型目录和配置表，尝试确定准确版本。

来源要求

优先使用厂商官网、官方车型配置表、官方产品手册、官方上市资料和官方历史资料。官方经销商资料必须明确对应同一年款和同一配置版本。
汽车之家、懂车帝、易车等第三方平台可用于识别完整款型、寻找线索和交叉核对。确定的配置事实需要同款官方资料支持。
打开具体页面或完整配置表，核对车型、年款、列标题、单位和配置标记。PDF 或图片表格须核对原始页面。搜索摘要只能用作线索。
基础资料未提供某个参数时，继续查询同款资料。无法联网时，只处理用户明确提供的技术参数和装备，也不得声称已经查询。

参数范围

按下列类别检索。每项都需要找到依据后才能输出。
- 动力系统：动力类型、发动机型号、排量、进气形式、气缸数、气缸排列、功率、扭矩、燃油标号、排放标准、电机和电池参数。
- 传动及底盘：变速箱、挡位数、驱动方式、前后悬架、转向助力、前后制动器、驻车制动。
- 车身：车身形式、长度、宽度、高度、轴距、车门数、座位数、整备质量、油箱容积、行李厢容积。
- 轮胎及车轮：前轮胎规格、后轮胎规格、轮圈材质、备胎规格。
- 安全及辅助驾驶：各位置安全气囊、胎压监测、ABS、制动力分配、制动辅助、牵引力控制、车身稳定系统、儿童座椅接口、主动安全功能、巡航、雷达和影像。
- 舒适及内饰：座椅材质、座椅调节、座椅加热、方向盘、天窗、钥匙、启动方式、仪表、中控屏、音响、空调、后排出风口和车内接口。
- 灯光及玻璃：远近光灯、日间行车灯、自动大灯、车窗、后视镜和雨刷。

真实性规则

按照原表图例区分标配、选装、不提供和空白。选装配置只标“选装”。用户明确确认实车已安装时，可记录实际情况。
资料未提及的配置直接省略。只有资料明确标注不配备时，才可写“未配备”。
没有可靠依据的项目直接省略，不用 0、空字符串、“未知”、“待确认”或猜测值补齐。来源冲突时优先核对同款官方原始资料，仍无法解决的项目省略。
只输出技术参数和装备配置。品牌、车型、年款、标题、行驶里程、登记状态、登记日期等基础身份或使用记录不进入输出。不得包含价格、采购成本、VIN、车架号、联系人、电话、网址、来源说明或内部备注。

字段标准

- “动力类型”的 value 只能选：${configurationPowertrainOptions.map(option => option.label).join('、')}。混动类别无法确定时省略。
- “排量(cc)”只填可靠资料明确提供的精确数值。不能将 1.8L 直接当作 1800cc。
- “功率(kW)”不得混用发动机功率、电机功率和系统综合功率。后台未指定口径时，分别使用“发动机最大功率(kW)”“电动机最大功率(kW)”“系统综合功率(kW)”等明确名称，省略含义不清的“功率(kW)”。
- “原始马力(hp)”只取资料明确以 hp 提供的数值。不换算，PS 或未注明制式的“马力”不作为 hp。
- “变速箱”的 value 只能选：手动、自动、无级变速、双离合、其他。无法可靠归类时省略该标准字段，可将核实的原始名称另列为“变速箱原始描述”。
- “车身形式”的 value 只能选：掀背、SUV、轿车、旅行车、轿跑、敞篷、厢式车、皮卡、其他。
- 单位放在 name 中，value 只写对应的实际值，例如“座位数”“长度(mm)”“轴距(mm)”“最大扭矩(N·m)”“前轮胎规格”“后轮胎规格”。数值全部使用字符串。
- 每项只表达一个参数。长、宽、高分别列项，前后轮胎分别列项。不要用“安全配置”等笼统名称合并多个装备，也不要用同义名称重复记录同一参数。

输出格式

车型已确定且查到可靠配置时，只返回一个标准 JSON 对象。JSON 回复中不包含 Markdown、代码块、解释、标题或其他文字。
顶层只能有 version 和 items。version 固定为数字 1。items 必须是数组，每项只能有 name 和 value，二者必须是非空字符串。名称及文字说明用中文，型号、标准缩写、单位和数值保留原样。
名称不能重复，不允许重复 JSON 属性。每项 name 最多 ${VEHICLE_CONFIGURATION_LIMITS.nameUtf16} 个字符，value 最多 ${VEHICLE_CONFIGURATION_LIMITS.valueUtf16} 个字符。所有名称与内容总长度不超过 ${VEHICLE_CONFIGURATION_LIMITS.totalUtf16} 个字符，JSON 原文最多 ${VEHICLE_CONFIGURATION_LIMITS.jsonBytes} 个 UTF-8 字节。
输出必须压缩成单行，没有缩进、换行或结构性空格。保留必需的双引号、冒号、逗号、大括号和方括号。数组方括号前不能添加反斜杠，不得将整个 JSON 包成字符串。字符串首尾不能有空白。
输出前检查车型匹配、来源依据、数值单位、配置状态、字段唯一性和 JSON 语法，确保标准 JSON 解析器可以直接解析。

若没有任何可靠技术参数或装备配置，直接告诉我为什么没有搜索到
如果配置或参数有疑问，检索到多个候选车型或款型，先列出候选及关键差异，向我确认具体版本。确认前暂停输出配置 JSON。

以下是待检索车辆的基础资料：
`;

export function buildConfigurationAiPrompt(form: DraftForm) {
  const fields = [
    ['品牌', form.makeName], ['车型', form.modelName], ['中文标题', form.title],
    ['配置款型', form.trimName], ['年款', form.modelYear], ['里程（公里）', form.mileageKm],
    ['登记状态', ({ registered: '已登记', never_registered: '从未登记', unknown: '' })[form.registrationStatus]],
    ['制造日期', form.manufacturedAt], ['首次登记日期', form.firstRegistration],
  ] as const;
  const known = Object.fromEntries(fields.filter(([, value]) => value.trim() !== ''));
  return configurationAiPrompt + JSON.stringify(known);
}

type Props = {
  value: string;
  prompt: string;
  onChange: (value: string) => void;
  onReview: () => void;
  showReview: boolean;
  rows: ReadonlyArray<{ name: string; value: string }> | null;
  errors: readonly string[];
  disabled?: boolean;
  requiredForPublish?: boolean;
};

export function VehicleConfigurationEditor({ value, prompt, onChange, onReview, showReview, rows, errors, disabled = false, requiredForPublish = true }: Props) {
  const { message } = App.useApp();
  const [expanded, setExpanded] = useState<string[]>([]);
  const valid = !!rows?.length && errors.length === 0;
  const previewRows = valid && showReview ? rows : null;
  useEffect(() => {
    if (errors.length) setExpanded(previous => previous.includes('example') ? previous : [...previous, 'example']);
  }, [errors.length]);

  async function copyPrompt() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(prompt);
      void message.success('已复制 AI 提示词及基础资料。');
    } catch {
      setExpanded(previous => [...new Set([...previous, 'prompt'])]);
      void message.info('请展开下方提示词，选中文字后手动复制。');
    }
  }

  return <Card title="车辆详细配置" className={styles.card} extra={<Tag color={requiredForPublish ? 'gold' : undefined}>{requiredForPublish ? '发布必填' : '可选型号配置'}</Tag>}>
    <div className={styles.instructions}>
      <Typography.Paragraph>提示词已带入第一步的资料。复制给可联网的 AI 检索同款配置，核对结果后把 JSON 粘贴到下方。若 AI 说明未找到可靠资料，配置先留空。</Typography.Paragraph>
      <Button icon={<CopyOutlined />} onClick={() => void copyPrompt()}>复制 AI 配置提示词</Button>
    </div>
    <Typography.Paragraph type="secondary">最多 {VEHICLE_CONFIGURATION_LIMITS.items} 项；名称最多 {VEHICLE_CONFIGURATION_LIMITS.nameUtf16} 字符，内容最多 {VEHICLE_CONFIGURATION_LIMITS.valueUtf16} 字符，名称与内容合计最多 {VEHICLE_CONFIGURATION_LIMITS.totalUtf16.toLocaleString('zh-CN')} 字符。超限会提示修正，不会截断内容。</Typography.Paragraph>
    <Form.Item label="配置内容（JSON）" htmlFor="configuration" required={requiredForPublish} validateStatus={errors.length ? 'error' : undefined}
      help={errors.length ? <ul className={styles.errors}>{errors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul> : requiredForPublish ? '可先留空保存草稿。填写后请解析并核对配置，再进入下一步。' : '可选填有依据的型号参数；填写后需符合标准格式。'}>
      <Input.TextArea id="configuration" aria-label="配置内容（JSON）" value={value} onChange={event => onChange(event.target.value)}
        disabled={disabled} autoSize={{ minRows: 9, maxRows: 22 }} placeholder={configurationExample}
        className={styles.input} spellCheck={false} aria-invalid={errors.length > 0} />
    </Form.Item>
    <Space className={styles.valid} wrap>
      {!showReview && <Button type="primary" disabled={disabled || !valid} onClick={() => {
        onReview();
        setExpanded(previous => [...new Set([...previous, 'preview'])]);
      }}>解析并核对配置</Button>}
      {previewRows && <><Tag color="success">格式有效</Tag><Typography.Text type="secondary">已解析 {previewRows.length} 项配置</Typography.Text></>}
    </Space>
    <Collapse className={styles.details} activeKey={expanded} onChange={keys => setExpanded(Array.isArray(keys) ? keys.map(String) : [String(keys)])} items={[
      { key: 'example', label: '查看正确格式示例', children: <pre className={styles.example}>{configurationExample}</pre> },
      { key: 'prompt', label: '查看完整 AI 提示词', children: <Input.TextArea aria-label="AI 配置提示词" readOnly value={prompt} autoSize={{ minRows: 10, maxRows: 24 }} className={styles.input} /> },
      ...(previewRows ? [{ key: 'preview', label: `核对已解析的 ${previewRows.length} 项配置`, children: <Table size="small" dataSource={previewRows.map((row, index) => ({ ...row, key: index }))}
        pagination={previewRows.length > 8 ? { pageSize: 8, showSizeChanger: false } : false} columns={[
          { title: '配置项目', dataIndex: 'name', key: 'name', width: '44%' },
          { title: '内容', dataIndex: 'value', key: 'value' },
        ]} /> }] : []),
    ]} />
  </Card>;
}

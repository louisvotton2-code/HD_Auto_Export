import { useEffect, useState } from 'react';
import { App, Button, Card, Collapse, Form, Input, Space, Table, Tag, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { VEHICLE_CONFIGURATION_LIMITS, vehicleConfigurationExample } from '@hd/contracts/admin';
import styles from './vehicle-configuration-editor.module.css';

export const configurationExample = JSON.stringify(vehicleConfigurationExample, null, 2);

export const configurationAiPrompt = `请将我提供的车辆配置资料整理成以下固定 JSON 格式，用于车辆管理后台录入。

只依据我提供的资料整理，不推测车型配置，不联网补全，不编造参数。没有可靠依据的项目直接省略，不用 0、空字符串或“未知”代替缺失数据。
只整理车辆技术参数和装备配置，不要包含采购成本、价格、VIN、车架号、联系人、电话、网址或内部备注。

格式要求：
1. 只返回一个标准 JSON 对象，不要 Markdown 代码块、解释或其他文字。
2. 顶层只能有 version 和 items，version 固定为数字 1。
3. items 是配置项目数组，每项只能有 name 和 value，二者都必须是非空字符串。数值也写成字符串。
4. name 用中文填写，单位放在名称中，例如“排量(cc)”；value 填写资料中的实际值。
5. 每个项目只表达一个参数，名称不能重复，不要合并多个同名参数。
6. 至少需要一项有依据的配置。如果没有任何可靠配置，返回 {"version":1,"items":[]}，不要生成假数据；后台会提示我补充资料。
7. 最多 ${VEHICLE_CONFIGURATION_LIMITS.items} 项；每项名称最多 ${VEHICLE_CONFIGURATION_LIMITS.nameUtf16} 个字符，内容最多 ${VEHICLE_CONFIGURATION_LIMITS.valueUtf16} 个字符；所有名称与内容总长度不超过 ${VEHICLE_CONFIGURATION_LIMITS.totalUtf16} 个字符。字符串首尾不能留空白，不允许重复 JSON 属性。

以下示例值只用于说明格式，不能当作我的车辆数据：
${configurationExample}

以下是我要整理的车辆配置资料：
（在这里粘贴车辆的原始配置资料）`;

type Props = {
  value: string;
  onChange: (value: string) => void;
  rows: ReadonlyArray<{ name: string; value: string }> | null;
  errors: readonly string[];
  disabled?: boolean;
  requiredForPublish?: boolean;
};

export function VehicleConfigurationEditor({ value, onChange, rows, errors, disabled = false, requiredForPublish = true }: Props) {
  const { message } = App.useApp();
  const [expanded, setExpanded] = useState<string[]>([]);
  const valid = !!rows?.length && errors.length === 0;
  useEffect(() => {
    if (errors.length) setExpanded(previous => previous.includes('example') ? previous : [...previous, 'example']);
  }, [errors.length]);

  async function copyPrompt() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(configurationAiPrompt);
      void message.success('AI 提示词已复制，请连同原始配置资料发给你的 AI。');
    } catch {
      setExpanded(previous => [...new Set([...previous, 'prompt'])]);
      void message.info('请展开下方提示词，选中文字后手动复制。');
    }
  }

  return <Card title="车辆详细配置" className={styles.card} extra={<Tag color={requiredForPublish ? 'gold' : undefined}>{requiredForPublish ? '发布必填' : '可选型号配置'}</Tag>}>
    <div className={styles.instructions}>
      <Typography.Paragraph>复制提示词，连同原始配置资料发给你使用的 AI，再把生成的 JSON 粘贴到下方。只填写有依据的配置，粘贴后请核对具体数值。</Typography.Paragraph>
      <Button icon={<CopyOutlined />} onClick={() => void copyPrompt()}>复制 AI 配置提示词</Button>
    </div>
    <Typography.Paragraph type="secondary">最多 {VEHICLE_CONFIGURATION_LIMITS.items} 项；名称最多 {VEHICLE_CONFIGURATION_LIMITS.nameUtf16} 字符，内容最多 {VEHICLE_CONFIGURATION_LIMITS.valueUtf16} 字符，名称与内容合计最多 {VEHICLE_CONFIGURATION_LIMITS.totalUtf16.toLocaleString('zh-CN')} 字符。超限会提示修正，不会截断内容。</Typography.Paragraph>
    <Form.Item label="配置内容（JSON）" htmlFor="configuration" required={requiredForPublish} validateStatus={errors.length ? 'error' : undefined}
      help={errors.length ? <ul className={styles.errors}>{errors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul> : requiredForPublish ? '可先留空保存草稿；填写后必须符合标准格式，发布前至少填写一项有效配置。' : '可选填有依据的型号参数；填写后需符合标准格式。'}>
      <Input.TextArea id="configuration" aria-label="配置内容（JSON）" value={value} onChange={event => onChange(event.target.value)}
        disabled={disabled} autoSize={{ minRows: 9, maxRows: 22 }} placeholder={configurationExample}
        className={styles.input} spellCheck={false} aria-invalid={errors.length > 0} />
    </Form.Item>
    {valid && <Space className={styles.valid}><Tag color="success">格式有效</Tag><Typography.Text type="secondary">已解析 {rows.length} 项配置</Typography.Text></Space>}
    <Collapse className={styles.details} activeKey={expanded} onChange={keys => setExpanded(Array.isArray(keys) ? keys.map(String) : [String(keys)])} items={[
      { key: 'example', label: '查看正确格式示例', children: <pre className={styles.example}>{configurationExample}</pre> },
      { key: 'prompt', label: '查看完整 AI 提示词', children: <Input.TextArea aria-label="AI 配置提示词" readOnly value={configurationAiPrompt} autoSize={{ minRows: 10, maxRows: 24 }} className={styles.input} /> },
      ...(valid ? [{ key: 'preview', label: `核对已解析的 ${rows.length} 项配置`, children: <Table size="small" dataSource={rows.map((row, index) => ({ ...row, key: index }))}
        pagination={rows.length > 8 ? { pageSize: 8, showSizeChanger: false } : false} columns={[
          { title: '配置项目', dataIndex: 'name', key: 'name', width: '44%' },
          { title: '内容', dataIndex: 'value', key: 'value' },
        ]} /> }] : []),
    ]} />
  </Card>;
}

import { useEffect, useState } from 'react';
import { Button, Card, Collapse, Form, Input, Space, Table, Tag, Typography } from 'antd';
import { VEHICLE_CONFIGURATION_LIMITS, vehicleConfigurationExample } from '@hd/contracts/admin';
import styles from './vehicle-configuration-editor.module.css';

export const configurationExample = JSON.stringify(vehicleConfigurationExample, null, 2);

type Props = {
  value: string;
  onChange: (value: string) => void;
  onReview: () => void;
  showReview: boolean;
  rows: ReadonlyArray<{ name: string; value: string }> | null;
  errors: readonly string[];
  disabled?: boolean;
  requiredForPublish?: boolean;
};

export function VehicleConfigurationEditor({ value, onChange, onReview, showReview, rows, errors, disabled = false, requiredForPublish = true }: Props) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const valid = !!rows?.length && errors.length === 0;
  const previewRows = valid && showReview ? rows : null;
  useEffect(() => {
    if (errors.length) setExpanded(previous => previous.includes('example') ? previous : [...previous, 'example']);
  }, [errors.length]);

  return <Card title="中文配置" className={styles.card} extra={<Tag color={requiredForPublish ? 'gold' : undefined}>{requiredForPublish ? '发布必填' : '可选型号配置'}</Tag>}>
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
      ...(previewRows ? [{ key: 'preview', label: `核对已解析的 ${previewRows.length} 项配置`, children: <Table size="small" dataSource={previewRows.map((row, index) => ({ ...row, key: index }))}
        pagination={previewRows.length > 8 ? { pageSize: 8, showSizeChanger: false } : false} columns={[
          { title: '配置项目', dataIndex: 'name', key: 'name', width: '44%' },
          { title: '内容', dataIndex: 'value', key: 'value' },
        ]} /> }] : []),
    ]} />
  </Card>;
}

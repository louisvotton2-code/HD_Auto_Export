import { useState } from 'react';
import { Alert, App, Button, Modal, Space, Typography } from 'antd';
import { ExternalBatchResponseSchema, ExternalImportBatchRequestSchema } from '@hd/contracts/admin';
import { ActionFeedback } from './action-feedback';
import { externalRoot } from './external-labels';
import { useExternalAction } from './use-external-action';
import styles from './external-sources.module.css';

// Matches the import route's request body ceiling.
const maxBytes = 8 * 1024 * 1024;

export function ExternalImport({ onImported }: { onImported: () => void }) {
  const { message, modal } = App.useApp();
  const action = useExternalAction('POST', ExternalBatchResponseSchema);
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<{ provider: string; count: number; body: string }>();
  const [fileError, setFileError] = useState('');
  const [reading, setReading] = useState(false);

  async function readFile(file: File) {
    setPayload(undefined);
    setFileError('');
    if (file.size > maxBytes) {
      setFileError('批次文件超过 8 MiB，请拆分后重新选择。');
      return;
    }
    setReading(true);
    try {
      const body = await file.text();
      if (new TextEncoder().encode(body).byteLength > maxBytes) {
        setFileError('导入内容超过 8 MiB，请拆分后重新选择。');
        return;
      }
      const parsed = ExternalImportBatchRequestSchema.safeParse(JSON.parse(body));
      if (!parsed.success) {
        setFileError('请选择由来源适配流程整理好的批次 JSON。');
        return;
      }
      // Candidates are opaque until the API validates each row.
      setPayload({ provider: parsed.data.provider, count: parsed.data.records.length, body });
    } catch {
      setFileError('无法读取此 JSON 文件。');
    } finally { setReading(false); }
  }
  function close() {
    setOpen(false);
    setPayload(undefined);
    setFileError('');
    action.clear();
  }
  async function submit(retry = false) {
    if (!retry && !payload) return;
    const result = await action.execute(payload && !retry ? { path: `${externalRoot}/batches`, body: payload.body } : undefined);
    if (result) {
      close();
      onImported();
      void message.success('导入完成，请查看批次结果。');
    }
  }
  async function reconcile() {
    if (!await modal.confirm({ title: '返回批次列表核对？', content: '请先在列表中查找该批次，再决定是否重新导入。', okText: '返回列表', cancelText: '继续核对' })) return;
    close();
    onImported();
  }
  const locked = reading || action.busy || action.uncertain;
  return <>
    <div><Button type="primary" onClick={() => setOpen(true)}>导入批次</Button></div>
    <Modal open={open} destroyOnHidden title="导入结构化批次" okText="确认导入" cancelText="取消"
      closable={!locked} keyboard={!locked} mask={{ closable: !locked }} onCancel={() => { if (!locked) close(); }}
      confirmLoading={action.busy} okButtonProps={{ disabled: locked || !payload }} cancelButtonProps={{ disabled: locked }}
      onOk={() => void submit()}>
      <Space orientation="vertical" align="start">
        <Typography.Paragraph>选择已规范化的 JSON 批次。导入后，符合公开条件的挂牌会进入目录。</Typography.Paragraph>
        <input type="file" className={styles.fileInput} aria-label="规范化批次 JSON" accept=".json,application/json" disabled={locked} onChange={event => {
          const file = event.target.files?.[0];
          if (file) void readFile(file);
        }} />
        {payload && <Typography.Text>来源 {payload.provider}，共 {payload.count} 条</Typography.Text>}
        {fileError && <Alert type="error" title={fileError} />}
        <ActionFeedback {...action} retry={() => void submit(true)} reconcile={() => void reconcile()} />
      </Space>
    </Modal>
  </>;
}

import { useEffect, useState } from 'react';
import { Alert, App, Button, Modal, Space, Typography } from 'antd';
import { ExternalFullSyncControlSchema, ExternalFullSyncStatusResponseSchema, type ExternalFullSyncControl, type ExternalFullSyncStatus } from '@hd/contracts/admin';
import { ActionFeedback } from './action-feedback';
import { externalRoot } from './external-labels';
import { useExternalAction } from './use-external-action';

export function FullSyncControls({ status, disabled, onRefresh, onBusyChange }: {
  status: ExternalFullSyncStatus | null; disabled: boolean; onRefresh: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const { message, modal } = App.useApp();
  const action = useExternalAction('POST', ExternalFullSyncStatusResponseSchema);
  const [confirmation, setConfirmation] = useState<ExternalFullSyncControl | null>(null);
  useEffect(() => { onBusyChange(action.busy || confirmation !== null); }, [action.busy, confirmation, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const rejected = ['VERSION_CONFLICT', 'FORBIDDEN', 'SYNC_NOT_CONFIGURED'].includes(action.errorCode);
  const unavailable = disabled || !status || status.state === 'disabled' || action.busy || action.uncertain || rejected;

  async function submit(retry = false) {
    if (disabled || action.busy || (!retry && (unavailable || !confirmation || confirmation.version !== status?.version))) return;
    const input = confirmation;
    const response = await action.execute(retry ? undefined : {
      path: `${externalRoot}/sync-control`, body: JSON.stringify(ExternalFullSyncControlSchema.parse(input)),
    });
    setConfirmation(null);
    if (response) {
      void message.success('本次同步控制请求已确认，正在读取最新状态。');
      onRefresh();
    }
  }
  async function reconcile() {
    if (action.busy) return;
    const accepted = await modal.confirm({ title: '结束本次重试并读取状态？', okText: '结束重试并读取', cancelText: '保留原请求',
      content: '这不会撤销已提交的请求。原操作可能已经执行；结束后仅重新读取状态，不会自动再次暂停或恢复。' });
    if (accepted) { action.clear(); onRefresh(); }
  }
  return <Space orientation="vertical" style={{ width: '100%', marginTop: 20 }}>
    <Space wrap>
      <Button danger={status?.paused !== true} disabled={unavailable} loading={action.busy} onClick={() => status && setConfirmation({ version: status.version, action: status.paused ? 'resume' : 'pause' })}>
        {status ? status.paused ? '恢复同步重任务' : '暂停同步重任务' : '同步控制（请先读取状态）'}
      </Button>
      <Typography.Text type="secondary">仅管理员可操作。暂停重任务后，查询与来源撤回处理继续运行。</Typography.Text>
    </Space>
    {status?.state === 'disabled' && <Typography.Text type="secondary">正式同步尚未配置，不能从这里创建任务或启用旧样本同步。</Typography.Text>}
    <ActionFeedback error={action.error} uncertain={action.uncertain} busy={action.busy} retryDisabled={disabled} retry={() => void submit(true)} reconcile={() => void reconcile()} />
    {action.uncertain && <Alert type="info" title="以服务端当前状态为准" description="可以使用上方刷新按钮读取当前状态；读取不会重发控制请求，也不代表确认了原请求的执行结果。" />}
    {rejected && !action.uncertain && <Button onClick={() => { action.clear(); onRefresh(); }}>重新读取同步状态</Button>}
    <Modal open={confirmation !== null} title={confirmation?.action === 'resume' ? '确认恢复同步重任务' : '确认暂停同步重任务'}
      okText={confirmation?.action === 'resume' ? '确认恢复' : '确认暂停'} cancelText="取消" confirmLoading={action.busy}
      closable={!action.busy} keyboard={!action.busy} maskClosable={!action.busy}
      okButtonProps={{ disabled: unavailable || confirmation?.version !== status?.version }} cancelButtonProps={{ disabled: action.busy }}
      onCancel={() => !action.busy && setConfirmation(null)} onOk={() => void submit()}>
      <p>{confirmation?.action === 'resume' ? '继续原正式同步任务，可能继续请求供应商并处理待补齐资料；不会创建旧样本同步任务。容量等保护仍可能阻止重任务，最终状态以重新读取结果为准。' : '暂停导入、资料补齐等重任务；查询、后台访问与来源撤回处理保持可用。'}</p>
      {confirmation && <p>本次操作基于控制版本 {confirmation.version}。其他管理员更新后，需要刷新再确认。</p>}
    </Modal>
  </Space>;
}

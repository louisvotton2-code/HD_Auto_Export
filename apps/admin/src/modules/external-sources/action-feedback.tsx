import { Alert, Button, Space } from 'antd';

export function ActionFeedback({ error, uncertain, busy, retry, reconcile, retryDisabled = false }: {
  error: string;
  uncertain: boolean;
  busy: boolean;
  retry: () => void;
  reconcile: () => void;
  retryDisabled?: boolean;
}) {
  if (!error && !uncertain) return null;
  return <Alert
    type={uncertain ? 'warning' : 'error'}
    showIcon
    title={uncertain ? '操作结果尚未确认' : error}
    description={uncertain ? <Space orientation="vertical" align="start">
      <span>{error} 重试使用原请求和原操作标识。</span>
      <Space wrap><Button loading={busy} disabled={retryDisabled} onClick={retry}>重试原请求</Button><Button disabled={busy} onClick={reconcile}>放弃重试并核对</Button></Space>
    </Space> : undefined}
  />;
}

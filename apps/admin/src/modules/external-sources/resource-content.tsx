import type { ReactNode } from 'react';
import { Alert, Button, Spin } from 'antd';

export function ResourceContent({ loading, error, retry, children }: {
  loading: boolean;
  error?: string;
  retry: () => void;
  children: ReactNode;
}) {
  if (loading) return <Spin description="正在读取…" />;
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={retry}>重新读取</Button>} />;
  return <>{children}</>;
}

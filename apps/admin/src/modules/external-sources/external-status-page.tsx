import { Link } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { ExternalProviderStatusResponseSchema, type ExternalProviderAccount } from '@hd/contracts/admin';
import { formatTime } from '../vehicles/draft-form';
import { externalRoot, platformName } from './external-labels';
import { FullSyncStatusCard } from './full-sync-status-card';
import { ResourceContent } from './resource-content';
import { useExternalResource } from './use-external-resource';
import styles from './external-sources.module.css';

const accountLabels: Record<ExternalProviderAccount['state'], string> = {
  not_configured: '未配置',
  ok: '连接正常',
  unauthorized: '账户认证失败',
  forbidden: '账户访问受限',
  rate_limited: '探测请求受限',
  unavailable: '暂时无法连接',
  invalid_response: '供应商响应异常',
};

export function ExternalStatusPage() {
  const resource = useExternalResource(`${externalRoot}/provider-status`, ExternalProviderStatusResponseSchema);
  const status = resource.data?.data;
  const account = status?.account;

  return <section className={styles.stack}>
    <header className={styles.heading}>
      <Typography.Title level={2}>三方 API 状态</Typography.Title>
      <Space wrap>
        <Button onClick={resource.reload} loading={resource.loading}>刷新账户状态</Button>
        <Link to="/external-sources/batches">历史导入批次</Link>
      </Space>
    </header>
    <FullSyncStatusCard />
    <ResourceContent {...resource} retry={resource.reload}>
      {status && account && <>
        <Card title="ChinaCarAPI">
          {account.state === 'not_configured' && <Alert showIcon type="info" title="本机尚未配置账户探测"
            description="配置 ChinaCarAPI 账户凭据后，这里可显示套餐、到期时间、覆盖平台及供应商提供的额度。" />}
          <Descriptions column={{ xs: 1, md: 2 }} items={[
            { key: 'connection', label: '账户连接', children: <Tag color={account.state === 'ok' ? 'success' : undefined}>{accountLabels[account.state]}</Tag> },
            { key: 'checked', label: '探测时间', children: formatTime(account.checkedAt) },
            ...(account.state === 'ok' ? [
            { key: 'plan', label: '套餐', children: account.plan ?? '供应商未返回' },
            { key: 'expiry', label: '套餐到期', children: account.expiresAt ? formatTime(account.expiresAt) : '供应商未返回' },
            { key: 'platforms', label: '覆盖平台', children: account.sources.length
              ? <Space wrap>{account.sources.map((source, index) => <Tag key={`${source}:${index}`}>{platformName(source)}</Tag>)}</Space>
              : '供应商未返回' },
            { key: 'limit', label: '每日请求限额', children: account.dailyLimit ?? '供应商未返回' },
            { key: 'remaining', label: '今日剩余请求', children: account.remainingToday ?? '供应商未返回' },
            ] : []),
          ]} />
        </Card>
        <Card title="历史入库参考">
          <Descriptions column={{ xs: 1, md: 2 }} items={[
            { key: 'import', label: '最近成功入库', children: formatTime(status.lastImportAt) },
            { key: 'fetched', label: '最近来源采集时间', children: formatTime(status.lastFetchedAt) },
            { key: 'source', label: '已知来源更新时间', children: formatTime(status.lastSupplierUpdatedAt) },
          ]} />
          <Typography.Text type="secondary">入库记录包含历史手动导入的样本。账户探测仅检查连接。</Typography.Text>
        </Card>
      </>}
    </ResourceContent>
  </section>;
}

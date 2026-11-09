import { Card, Descriptions, Typography } from 'antd';

const integer = new Intl.NumberFormat('zh-CN');

function characters(count: number | null) {
  return count === null ? '尚未报告' : `${integer.format(count)} 字符`;
}

export function BatchTranslationUsage({ estimated, consumed, status }: {
  estimated: number | null;
  consumed: number | null;
  status: string;
}) {
  return <Card title="翻译用量">
    <Descriptions size="small" column={{ xs: 1, sm: 3 }} items={[
      { key: 'status', label: '翻译状态', children: status },
      { key: 'estimate', label: '预计计费字符', children: characters(estimated) },
      { key: 'used', label: '实际计费字符', children: characters(consumed) },
    ]} />
    <Typography.Text type="secondary">字符数由服务端报告，预估与实际消耗分别记录。</Typography.Text>
  </Card>;
}

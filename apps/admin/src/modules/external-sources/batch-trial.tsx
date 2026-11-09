import { useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Input, Table, Typography } from 'antd';
import { EXTERNAL_TRIAL_SIZE, ExternalTrialRequestSchema, ExternalTrialResponseSchema } from '@hd/contracts/admin';
import { ActionFeedback } from './action-feedback';
import { BatchTranslationUsage } from './batch-translation-usage';
import { externalRoot, fieldLabels } from './external-labels';
import { ResourceContent } from './resource-content';
import { useExternalAction } from './use-external-action';
import { useExternalResource } from './use-external-resource';
import styles from './external-sources.module.css';

export function BatchTrial({ batchId, canPlan }: { batchId: string; canPlan: boolean }) {
  const path = `${externalRoot}/batches/${encodeURIComponent(batchId)}/translation-trial`;
  const plan = useExternalResource(path, ExternalTrialResponseSchema);
  const action = useExternalAction('POST', ExternalTrialResponseSchema);
  const { modal, message } = App.useApp();
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const data = plan.data?.data;
  const vehicleIds = input.trim() ? input.trim().split(/\s+/) : [];
  async function submit(retry = false) {
    const parsed = ExternalTrialRequestSchema.safeParse({ vehicleIds });
    if (!retry && !parsed.success) { setInvalid(true); return; }
    const selected = new Set(vehicleIds);
    const result = await action.execute(retry ? undefined : {
      path, body: JSON.stringify(parsed.data),
      matches: ({ data }) => data?.batchId === batchId && data.vehicleIds.every(id => selected.has(id)),
    });
    if (result) {
      setInput('');
      plan.reload();
      void message.success('已记录试译测算');
    }
  }
  async function reconcile() {
    if (!await modal.confirm({ title: '核对当前试译计划？', content: '确认后重新读取该批次的试译记录。', okText: '读取记录', cancelText: '返回' })) return;
    action.clear();
    plan.reload();
  }
  return <Card title="固定样本试译">
    <div className={styles.stack}>
      <ResourceContent {...plan} retry={plan.reload}>{plan.data && (data ? <>
        <BatchTranslationUsage estimated={data.estimate.estimatedCharacters} consumed={data.budget.realCalls === 0 ? 0 : null} status="干跑测算" />
        <Descriptions size="small" column={{ xs: 1, md: 2 }} items={[
          { key: 'sample', label: '已固定样本', children: `${data.vehicleIds.length} 条` },
          { key: 'calls', label: '预估调用次数', children: data.estimate.estimatedCalls },
          { key: 'actual', label: '实际调用次数', children: data.budget.realCalls },
          { key: 'limit', label: '批次字符上限', children: data.budget.batchLimit.toLocaleString('zh-CN') },
          { key: 'free', label: '账号剩余免费额度', children: '待核实' },
          { key: 'reserved', label: '账本预留字符', children: data.budget.reservedCharacters },
          { key: 'attempted', label: '账本尝试字符', children: data.budget.attemptedCharacters },
        ]} />
        <Table size="small" rowKey="field" dataSource={data.byField} pagination={false} scroll={{ x: 480 }}
          columns={[
            { title: '字段', render: (_, row) => fieldLabels[row.field] },
            { title: '原始字符', dataIndex: 'grossCharacters' },
            { title: '预计计费字符', dataIndex: 'estimatedCharacters' },
            { title: '预计调用次数', dataIndex: 'estimatedCalls' },
          ]} />
      </> : <Typography.Text type="secondary">此批次暂无试译测算。</Typography.Text>)}</ResourceContent>
      <ActionFeedback {...action} retry={() => void submit(true)} reconcile={() => void reconcile()} />
      {canPlan && plan.data && !data && !action.uncertain && <>
        <Typography.Text>粘贴交接清单中固定的 {EXTERNAL_TRIAL_SIZE} 个挂牌编号，每行一个。</Typography.Text>
        <Input.TextArea aria-label="试译挂牌编号" rows={4} value={input} maxLength={5000} disabled={action.busy}
          onChange={event => { setInput(event.target.value); setInvalid(false); }} />
        {invalid && <Alert type="error" title={`请输入 ${EXTERNAL_TRIAL_SIZE} 个互不重复的有效挂牌编号。`} />}
        <div><Button loading={action.busy} disabled={!input.trim()} onClick={() => void submit()}>测算试译用量</Button></div>
      </>}
    </div>
  </Card>;
}

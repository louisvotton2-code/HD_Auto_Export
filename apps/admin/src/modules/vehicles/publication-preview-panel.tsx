import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Radio, Space, Tag, Typography } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { PublicationPreviewFrameMessageSchema } from '@hd/contracts/admin';
import type { Locale } from '@hd/contracts/public';
import styles from './publication-preview-panel.module.css';

const languages = { zh: '中文', en: '英文', ru: '俄文' };
const errors = {
  unauthenticated: '预览无法验证当前登录，可重新载入预览。',
  forbidden: '当前账号没有读取这份预览的权限。',
  not_found: '未找到车辆草稿，可能已移入回收站。',
  conflict: '车辆已发生变化，请核对最新草稿后重新载入。',
  invalid_response: '预览资料暂时无法识别，请重试或联系维护人员。',
  unavailable: '预览服务暂时不可用，请稍后重新载入。',
  render_error: '车辆预览未能完整显示，请重新载入。',
};

type Props = {
  vehicleId: string;
  version: number;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  hasUnsavedChanges: boolean;
  disabled?: boolean;
};

export function PublicationPreviewPanel(props: Props) {
  const [open, setOpen] = useState(false);
  return <Card className={styles.panel} title={<Space><EyeOutlined />官网预览（可选）</Space>}
    styles={open ? undefined : { body: { display: 'none' } }}
    extra={<Button aria-expanded={open} disabled={props.disabled} onClick={() => setOpen(value => !value)}>
      {open ? '收起预览' : '打开预览'}
    </Button>}>
    {open && <PublicationPreviewFrame {...props} />}
  </Card>;
}

function PublicationPreviewFrame({ vehicleId, version, locale, hasUnsavedChanges, disabled, onLocaleChange }: Props) {
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'stale'>('loading');
  const [error, setError] = useState('');
  const [height, setHeight] = useState(850);
  const frame = useRef<HTMLIFrameElement>(null);
  const invalidated = useRef(false);
  const documentLoaded = useRef<() => void>(() => {});
  const loadId = useMemo(() => crypto.randomUUID(), [vehicleId, version, locale, reload, hasUnsavedChanges]);
  const query = new URLSearchParams({ locale, loadId });
  const src = `/staff/vehicles/${encodeURIComponent(vehicleId)}/publication-preview/?${query}`;

  useLayoutEffect(() => {
    let active = true;
    let deadline: number | undefined;
    let phase = 0;
    let handshakeDeadline: number | undefined;
    let receivedFrameMessage = false;
    function clearDeadline() {
      phase += 1;
      window.clearTimeout(deadline);
      window.clearTimeout(handshakeDeadline);
      handshakeDeadline = undefined;
      deadline = undefined;
    }
    function expire(expectedPhase: number) {
      if (!active || phase !== expectedPhase || invalidated.current || hasUnsavedChanges) return;
      clearDeadline();
      invalidated.current = true;
      setStatus('error');
      setError(receivedFrameMessage
        ? '预览尚未完整显示。可重新载入预览。'
        : '预览页面未响应。请重新载入，或联系维护人员检查官网服务。');
    }
    function startDeadline() {
      if (deadline !== undefined) return;
      clearDeadline();
      const expectedPhase = phase;
      deadline = window.setTimeout(() => expire(expectedPhase), 40_000);
    }
    documentLoaded.current = () => {
      // A document load may be an error page. Only the bound frame protocol proves readiness.
      if (receivedFrameMessage || invalidated.current || deadline === undefined || handshakeDeadline !== undefined) return;
      const expectedPhase = phase;
      handshakeDeadline = window.setTimeout(() => expire(expectedPhase), 12_000);
    };
    invalidated.current = hasUnsavedChanges;
    setStatus(invalidated.current ? 'stale' : 'loading'); setError(''); setHeight(850);
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const parsed = PublicationPreviewFrameMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.loadId !== loadId || message.vehicleId !== vehicleId || message.locale !== locale) return;
      receivedFrameMessage = true;
      window.clearTimeout(handshakeDeadline);
      handshakeDeadline = undefined;
      if (message.event === 'resize') { setHeight(message.height); return; }
      if (invalidated.current) return;
      if (message.event === 'ready') {
        clearDeadline();
        const preview = message.preview;
        if (preview.vehicleId !== vehicleId || preview.locale !== locale || preview.vehicleVersion !== version) {
          invalidated.current = true; setStatus('error'); setError(errors.conflict); return;
        }
        setStatus('ready'); setError('');
        return;
      }
      if (message.event === 'error') {
        clearDeadline();
        invalidated.current = true;
        setStatus('error'); setError(errors[message.error.code]);
      } else if (message.event === 'disposed') {
        clearDeadline();
        invalidated.current = true; setStatus('error'); setError('预览已关闭，请重新载入。');
      } else {
        // Image changes may start another render after a completed preview.
        // Only ready -> loading starts a new deadline; pending loading cannot renew it.
        startDeadline(); setStatus('loading'); setError('');
      }
    }
    window.addEventListener('message', receive);
    if (!invalidated.current) startDeadline();
    return () => { active = false; documentLoaded.current = () => {}; clearDeadline(); window.removeEventListener('message', receive); };
  }, [loadId, vehicleId, version, locale, hasUnsavedChanges]);

  return <>
    <div className={styles.toolbar}>
      <Radio.Group aria-label="发布预览语言" value={locale} disabled={disabled || hasUnsavedChanges}
        onChange={event => { invalidated.current = true; onLocaleChange(event.target.value as Locale); }}
        options={Object.entries(languages).map(([value, label]) => ({ value, label }))} optionType="button" />
      <Button icon={<ReloadOutlined />} disabled={disabled || hasUnsavedChanges}
        onClick={() => { invalidated.current = true; setReload(value => value + 1); }}>重新载入预览</Button>
      <Tag color={status === 'ready' ? 'success' : status === 'error' ? 'error' : 'warning'}>
        {status === 'ready' ? '已显示当前草稿' : status === 'error' ? '预览未就绪' : status === 'stale' ? '请先保存修改' : '正在载入预览'}
      </Tag>
    </div>
    <Typography.Paragraph type="secondary">可切换语言查看封面、车辆资料、车况和价格。</Typography.Paragraph>
    {hasUnsavedChanges && <Alert showIcon type="warning" title="当前显示的是已保存草稿，请先保存修改" className={styles.notice} />}
    {error && <Alert showIcon type="error" title={error} className={styles.notice} />}
    <div className={styles.frameWrap}><iframe key={loadId} ref={frame} src={src} onLoad={() => documentLoaded.current()} title={`${languages[locale]}车辆发布预览`}
      className={styles.frame} style={{ height }} referrerPolicy="same-origin" /></div>
  </>;
}

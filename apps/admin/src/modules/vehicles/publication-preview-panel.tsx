import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Radio, Space, Tag, Typography } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { PublicationPreviewFrameMessageSchema, type ConfirmPublicationPreviewRequest } from '@hd/contracts/admin';
import type { Locale } from '@hd/contracts/public';
import styles from './publication-preview-panel.module.css';

const languages = { zh: '中文', en: '英文', ru: '俄文' };
const errors = {
  unauthenticated: '登录已失效，请重新登录后载入预览。',
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
  onRendered: (receipt: ConfirmPublicationPreviewRequest | null) => void;
};

export function PublicationPreviewPanel(props: Props) {
  const { vehicleId, version, locale, hasUnsavedChanges, disabled } = props;
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'stale'>('loading');
  const [error, setError] = useState('');
  const [height, setHeight] = useState(850);
  const frame = useRef<HTMLIFrameElement>(null);
  const invalidated = useRef(false);
  const cancelDeadline = useRef<() => void>(() => {});
  const documentLoaded = useRef<() => void>(() => {});
  const current = useRef(props);
  current.current = props;
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
      if (!active || phase !== expectedPhase || invalidated.current || current.current.hasUnsavedChanges) return;
      clearDeadline();
      invalidated.current = true;
      setStatus('error');
      setError(receivedFrameMessage
        ? '预览尚未完整显示。请重新载入，显示完成后才能确认。'
        : '预览页面未响应。请重新载入，或联系维护人员检查官网服务。');
      current.current.onRendered(null);
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
    cancelDeadline.current = clearDeadline;
    invalidated.current = current.current.hasUnsavedChanges;
    setStatus(invalidated.current ? 'stale' : 'loading'); setError(''); setHeight(850);
    current.current.onRendered(null);
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
      if (current.current.hasUnsavedChanges) {
        clearDeadline(); invalidated.current = true; setStatus('stale'); current.current.onRendered(null); return;
      }
      if (message.event === 'ready') {
        clearDeadline();
        const preview = message.preview;
        if (preview.vehicleId !== vehicleId || preview.locale !== locale || preview.vehicleVersion !== version) {
          invalidated.current = true; setStatus('error'); setError(errors.conflict); current.current.onRendered(null); return;
        }
        setStatus('ready'); setError('');
        current.current.onRendered({ version: preview.vehicleVersion, publicContentRevision: preview.publicContentRevision,
          fingerprint: preview.fingerprint, locale: preview.locale });
        return;
      }
      current.current.onRendered(null);
      if (message.event === 'error') {
        clearDeadline();
        invalidated.current = true;
        setStatus('error'); setError(errors[message.error.code]);
        if (message.error.code === 'unauthenticated') window.dispatchEvent(new Event('admin:unauthorized'));
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
    return () => { active = false; documentLoaded.current = () => {}; clearDeadline(); window.removeEventListener('message', receive); current.current.onRendered(null); };
  }, [loadId, vehicleId, version, locale]);

  function reloadPreview() { cancelDeadline.current(); invalidated.current = true; current.current.onRendered(null); setReload(value => value + 1); }

  return <Card className={styles.panel} title={<Space><EyeOutlined />发布预览</Space>} extra={
    <Tag color={status === 'ready' ? 'success' : status === 'error' ? 'error' : 'warning'}>
      {status === 'ready' ? '已显示当前草稿' : status === 'error' ? '预览未就绪' : status === 'stale' ? '请先保存修改' : '正在载入预览'}
    </Tag>}>
    <div className={styles.toolbar}>
      <Radio.Group aria-label="发布预览语言" value={locale} disabled={disabled || hasUnsavedChanges}
        onChange={event => { current.current.onRendered(null); props.onLocaleChange(event.target.value as Locale); }}
        options={Object.entries(languages).map(([value, label]) => ({ value, label }))} optionType="button" />
      <Button icon={<ReloadOutlined />} disabled={disabled || hasUnsavedChanges} onClick={reloadPreview}>重新载入预览</Button>
    </div>
    <Typography.Paragraph type="secondary">检查封面、车辆资料、车况和价格。可切换语言核对，再在下方确认并发布。</Typography.Paragraph>
    {hasUnsavedChanges && <Alert showIcon type="warning" title="当前显示的是已保存草稿，请先保存修改" className={styles.notice} />}
    {error && <Alert showIcon type="error" title={error} className={styles.notice} />}
    <div className={styles.frameWrap}><iframe key={loadId} ref={frame} src={src} onLoad={() => documentLoaded.current()} title={`${languages[locale]}车辆发布预览`}
      className={styles.frame} style={{ height }} referrerPolicy="same-origin" /></div>
  </Card>;
}

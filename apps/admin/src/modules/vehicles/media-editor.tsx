import { UtcDateTimeField } from '../../shared/ui/utc-date-time-field';
import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Collapse, Empty, Form, Image, Input, Progress, Select, Space, Tag, Typography, Upload } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, CheckCircleOutlined, CloudUploadOutlined, DeleteOutlined, ReloadOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import {
  MediaAssetResponseSchema, MediaUploadResponseSchema,
  type DraftMedia, type MediaAsset, type MediaRights, type MediaContentType, type VehicleDraftSource,
} from '@hd/contracts/admin';
import { ApiClientError, request } from '../../shared/api/client';
import { appendReadyMedia, finishMediaUpload, MAX_MEDIA_COUNT, normalizeMedia, recycleMediaAsset, validateMediaFile } from './media-upload';
import styles from './media-editor.module.css';
import { uploadRightsForFiles } from './media-source';

type UploadTask = {
  key: string;
  file: File;
  rights: MediaRights;
  asset?: MediaAsset;
  stage: 'waiting' | 'permit' | 'upload' | 'complete' | 'ready' | 'error';
  error?: string;
  retryable: boolean;
  permitUnknown?: boolean;
};
type Props = {
  vehicleId: string;
  value: DraftMedia[];
  onChange: (media: DraftMedia[]) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  savedMediaIds?: string[];
  source?: VehicleDraftSource;
};

const stageText = { waiting: '等待上传', permit: '正在准备上传', upload: '正在上传并核验图片', complete: '正在确认图片处理结果', ready: '上传完成，已加入当前草稿', error: '上传未完成' };

export function VehicleMediaEditor({ vehicleId, value, onChange, disabled = false, onBusyChange, savedMediaIds = [], source = { kind: 'manual' } }: Props) {
  const { message } = App.useApp();
  const external = source.kind === 'external';
  const [basis, setBasis] = useState<MediaRights['basis']>(external ? 'unverified' : 'owned');
  const [imageUrls, setImageUrls] = useState('');
  const [collectedAt, setCollectedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [note, setNote] = useState('');
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [batchNotice, setBatchNotice] = useState('');
  const [previewErrors, setPreviewErrors] = useState<Record<string, boolean>>({});
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [seenMedia, setSeenMedia] = useState<DraftMedia[]>(value);
  const [recycledIds, setRecycledIds] = useState<string[]>([]);
  const [recycleSuccess, setRecycleSuccess] = useState('');
  const mounted = useRef(true);
  const active = useRef(false);
  const currentMedia = useRef(value);
  const persistedMedia = useRef(savedMediaIds);
  const changed = useRef(onChange);
  const busyChanged = useRef(onBusyChange);
  const controller = useRef<AbortController | null>(null);
  currentMedia.current = value;
  persistedMedia.current = savedMediaIds;
  changed.current = onChange;
  busyChanged.current = onBusyChange;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); busyChanged.current?.(false); };
  }, []);
  useEffect(() => {
    setSeenMedia(previous => {
      const added = value.filter(item => !previous.some(known => known.id === item.id));
      return added.length ? [...previous, ...added] : previous;
    });
  }, [value]);

  function updateTask(key: string, patch: Partial<UploadTask>) {
    if (mounted.current) setTasks(current => current.map(task => task.key === key ? { ...task, ...patch } : task));
  }
  function updateMedia(next: DraftMedia[]) {
    currentMedia.current = next;
    changed.current(next);
  }
  async function runTask(task: UploadTask, signal: AbortSignal) {
    let asset = task.asset;
    try {
      updateTask(task.key, { error: undefined, stage: asset ? 'complete' : 'permit' });
      if (!asset) {
        const permit = await request('/api/v1/admin/media/uploads', MediaUploadResponseSchema, {
          method: 'POST', signal,
          body: JSON.stringify({ vehicleId, filename: task.file.name, contentType: task.file.type, sizeBytes: task.file.size, rights: task.rights }),
        });
        asset = permit.data.media;
        if (asset.vehicleId !== vehicleId) throw new Error('上传许可与当前车辆不一致，请重新核对。');
        updateTask(task.key, { asset });
      }
      const final = await finishMediaUpload(asset, task.file, Boolean(task.asset), {
        get: async id => (await request(`/api/v1/admin/media/${encodeURIComponent(id)}`, MediaAssetResponseSchema, { signal })).data,
        upload: async (current, file, contentType: MediaContentType) => {
          updateTask(task.key, { stage: 'upload' });
          return (await request(`/api/v1/admin/media/${encodeURIComponent(current.id)}/content`, MediaAssetResponseSchema, {
            method: 'PUT', signal, body: file,
            headers: { 'Content-Type': contentType, 'If-Match': String(current.version) },
          })).data;
        },
        complete: async current => {
          updateTask(task.key, { stage: 'complete' });
          return (await request(`/api/v1/admin/media/${encodeURIComponent(current.id)}/complete`, MediaAssetResponseSchema, {
            method: 'POST', signal, body: JSON.stringify({ version: current.version }),
          })).data;
        },
      }, next => { asset = next; updateTask(task.key, { asset: next }); });
      if (!mounted.current || signal.aborted) return;
      updateMedia(appendReadyMedia(currentMedia.current, final));
      updateTask(task.key, { stage: 'ready', retryable: false });
      return true;
    } catch (failure) {
      if (!mounted.current || signal.aborted) return;
      // Upload permits have no idempotency key. A lost create response must not reserve another slot blindly.
      const definiteRejection = failure instanceof ApiClientError && [400, 401, 403, 404, 413, 422, 429].includes(failure.status);
      const unknownPermit = !asset && !definiteRejection;
      const terminalAsset = asset?.status === 'failed' || asset?.status === 'deleted';
      const message = unknownPermit
        ? '未能确认上传许可是否已经创建。请勿重复选择这张图片；保留此页面并联系维护人员核对，未使用的许可到期后会回收。'
        : failure instanceof Error ? failure.message : '图片上传未完成，请稍后重试。';
      updateTask(task.key, { asset, stage: 'error', error: message, retryable: !unknownPermit && !terminalAsset, permitUnknown: unknownPermit });
      return false;
    }
  }
  async function recycle(id: string, taskKey?: string) {
    if (active.current || disabled) return;
    active.current = true; setBusy(true); busyChanged.current?.(true); setError(''); setRecycleSuccess('');
    const aborter = new AbortController(); controller.current = aborter;
    try {
      await recycleMediaAsset(id, vehicleId, currentMedia.current.map(item => item.id), persistedMedia.current, {
        get: async mediaId => {
          try { return (await request(`/api/v1/admin/media/${encodeURIComponent(mediaId)}`, MediaAssetResponseSchema, { signal: aborter.signal })).data; }
          catch (failure) { if (failure instanceof ApiClientError && failure.status === 404) return null; throw failure; }
        },
        remove: async asset => {
          try {
            await request(`/api/v1/admin/media/${encodeURIComponent(asset.id)}`, { parse(value: unknown) { if (value !== null) throw new Error('Expected empty response'); return undefined; } }, {
              method: 'DELETE', signal: aborter.signal, body: JSON.stringify({ version: asset.version }),
            });
          } catch (failure) { if (!(failure instanceof ApiClientError && failure.status === 404)) throw failure; }
        },
      });
      if (!mounted.current || aborter.signal.aborted) return;
      setRecycledIds(current => current.includes(id) ? current : [...current, id]);
      setTasks(current => current.filter(task => task.key !== taskKey && task.asset?.id !== id));
      setRecycleSuccess('图片已回收，上传名额已释放。');
      void message.success('图片已回收，上传名额已释放。');
    } catch (failure) {
      if (!mounted.current || aborter.signal.aborted) return;
      setError(failure instanceof ApiClientError && failure.code === 'MEDIA_IN_USE'
        ? '这张图片仍被草稿或发布历史使用，无法回收。已发布历史中的图片受保护，不能删除。'
        : failure instanceof Error ? failure.message : '尚未确认图片回收结果，请重试核对状态。');
    } finally {
      active.current = false;
      if (mounted.current) { setBusy(false); busyChanged.current?.(false); }
    }
  }
  function cancelTask(task: UploadTask) {
    if (active.current || disabled || task.permitUnknown) return;
    if (task.asset) void recycle(task.asset.id, task.key);
    else { setTasks(current => current.filter(item => item.key !== task.key)); setRecycleSuccess('已取消尚未分配上传许可的任务。'); }
  }
  async function runTasks(selected: UploadTask[]) {
    if (active.current || disabled) return;
    active.current = true; setBusy(true); busyChanged.current?.(true);
    const aborter = new AbortController(); controller.current = aborter;
    let completed = 0;
    try {
      for (const task of selected) {
        if (!mounted.current || aborter.signal.aborted) break;
        if (await runTask(task, aborter.signal)) completed += 1;
      }
      if (mounted.current && !aborter.signal.aborted) {
        const failed = selected.length - completed;
        const summary = failed ? `本次完成${completed}张，${failed}张未完成，请查看上传进度核对并重试。` : `${completed}张图片已上传，请保存草稿；发布后才会更新公开图片。`;
        setBatchNotice(summary);
        if (!failed) void message.success(summary);
        else if (completed) void message.warning(summary);
        else void message.error(summary);
      }
    } finally {
      active.current = false;
      if (mounted.current) { setBusy(false); busyChanged.current?.(false); }
    }
  }
  function chooseFiles(files: File[]) {
    if (!files.length || active.current || disabled) return;
    setError('');
    setBatchNotice('');
    if (!note.trim()) { setError('请先填写图片来源或授权依据。'); return; }
    const outstanding = tasks.filter(task => task.stage !== 'ready' && !value.some(item => item.id === task.asset?.id)).length;
    if (value.length + outstanding + files.length > MAX_MEDIA_COUNT) { setError('每辆车最多 30 张图片，待完成的上传也占用名额。请减少本次选择。'); return; }
    for (const file of files) {
      const invalid = validateMediaFile(file);
      if (invalid) { setError(`${file.name}：${invalid}`); return; }
    }
    let rights: MediaRights[];
    try { rights = uploadRightsForFiles(source, files.length, basis, note, imageUrls, collectedAt); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '请检查每张图片的来源资料。'); return; }
    const selected: UploadTask[] = files.map((file, index) => ({ key: crypto.randomUUID(), file, rights: rights[index]!, stage: 'waiting', retryable: false }));
    setTasks(current => [...current, ...selected]);
    if (external) setImageUrls('');
    void runTasks(selected);
  }
  function move(index: number, direction: -1 | 1) {
    const next = [...value];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    updateMedia(normalizeMedia(next));
  }
  const locked = disabled || busy;
  const removedMedia = seenMedia.filter(item => !value.some(current => current.id === item.id) && !recycledIds.includes(item.id));
  const completed = tasks.filter(task => task.stage === 'ready').length;
  return <section className={styles.editor} aria-labelledby="vehicle-media-title">
    <Card title={<Space><CloudUploadOutlined /><Typography.Title level={4} id="vehicle-media-title" style={{ margin: 0 }}>车辆图片</Typography.Title></Space>} extra={<Tag color={value.length ? 'green' : 'default'}>{value.length} / 30 张</Tag>}>
      <Typography.Paragraph type="secondary">先上传清晰的车辆照片，再选封面、调整顺序。完成后保存草稿；重新发布后才会更新线上图片。</Typography.Paragraph>
      <div className={styles.uploadFields}>
        <Form.Item label="图片使用依据" htmlFor="media-rights-basis">
          <Select id="media-rights-basis" aria-label="图片使用依据" value={basis} onChange={setBasis} disabled={locked} options={[{ value: 'owned', label: '自有图片' }, { value: 'permission', label: '已获授权' }, ...(external ? [{ value: 'unverified', label: '使用许可待核验（本地资料）' }] : [])]} />
        </Form.Item>
        <Form.Item className={styles.note} label="图片来源／授权说明" htmlFor="media-rights-note" required>
          <Input.TextArea id="media-rights-note" aria-label="图片来源／授权说明" value={note} onChange={event => setNote(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} disabled={locked} placeholder="例如：公司现场拍摄，或供应商已授权用于车辆展示" />
        </Form.Item>
      </div>
      {source.kind === 'external' && <div className={styles.externalSources}>
        <Alert showIcon type="warning" title="逐张记录图片来源" description="原图地址仅作来源记录，不会自动下载。使用许可待核验仅供本地资料整理，生产使用前需核验。" />
        <Form.Item label="图片挂牌来源" htmlFor="media-listing-url"><Input id="media-listing-url" aria-label="图片挂牌来源" value={source.listingUrl} readOnly /></Form.Item>
        <Form.Item label="图片采集时间（UTC）" htmlFor="media-collected-at" required><UtcDateTimeField id="media-collected-at" label="图片采集时间（UTC）" value={collectedAt} disabled={locked} onChange={value => setCollectedAt(value.slice(0, 16))} /></Form.Item>
        <Form.Item label="逐图原始地址" htmlFor="media-image-urls" required help="每行一个 HTTP(S) 原图地址，数量与本次选择的文件相同，并保持相同顺序。"><Input.TextArea id="media-image-urls" aria-label="逐图原始地址" value={imageUrls} disabled={locked} onChange={event => setImageUrls(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="https://来源网站/图片1.jpg&#10;https://来源网站/图片2.jpg" /></Form.Item>
      </div>}
      <Form.Item label="上传车辆图片" htmlFor="vehicle-image-upload" help="JPEG / PNG / WebP，单张最大 10 MiB，每辆车最多 30 张。请先填写图片使用依据。">
        <Upload.Dragger id="vehicle-image-upload" aria-label="上传车辆图片" multiple accept="image/jpeg,image/png,image/webp" showUploadList={false} disabled={locked || !note.trim()} beforeUpload={(file, fileList) => {
          if (file.uid === fileList[0]?.uid) chooseFiles(fileList);
          return Upload.LIST_IGNORE;
        }}>
          <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
          <p className="ant-upload-text">点击选择图片，或将文件拖到这里</p>
          <p className="ant-upload-hint">支持一次选择多张。图片会在处理完成后加入草稿。</p>
        </Upload.Dragger>
      </Form.Item>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {error && <Alert showIcon type="error" title={error} />}
        {batchNotice && <Alert showIcon type="info" title={batchNotice} />}
        {recycleSuccess && <Alert showIcon type="success" title={recycleSuccess} />}
        {busy && <Alert showIcon type="info" title="正在处理图片" description="请等待当前处理完成，再保存草稿或进行其它操作。" />}
      </Space>
      {tasks.length > 0 && <Collapse className={styles.tasksCollapse} defaultActiveKey={['uploads']} items={[{ key: 'uploads', label: `本次上传 · ${completed} / ${tasks.length} 已完成`, children: <ul className={styles.tasks} aria-label="图片上传进度">{tasks.map(task => <li key={task.key}>
        <div className={styles.taskHeading}><Typography.Text strong ellipsis={{ tooltip: task.file.name }}>{task.file.name}</Typography.Text><Tag color={task.stage === 'ready' ? 'success' : task.stage === 'error' ? 'error' : 'processing'}>{task.stage === 'ready' && !value.some(item => item.id === task.asset?.id) ? '已从当前草稿移除' : stageText[task.stage]}</Tag></div>
        <Progress percent={task.stage === 'ready' ? 100 : task.stage === 'complete' ? 85 : task.stage === 'upload' ? 55 : task.stage === 'permit' ? 20 : 0} status={task.stage === 'error' ? 'exception' : task.stage === 'ready' ? 'success' : 'active'} showInfo={false} size="small" />
        {task.error && <Alert type="error" showIcon title={task.error} />}
        <Space wrap>
          {task.stage === 'error' && task.retryable && <Button icon={<ReloadOutlined />} disabled={locked} onClick={() => void runTasks([task])}>确认状态并重试上传</Button>}
          {task.stage === 'error' && !task.permitUnknown && <Button danger disabled={locked || (Boolean(task.asset) && (value.some(item => item.id === task.asset!.id) || savedMediaIds.includes(task.asset!.id)))} onClick={() => cancelTask(task)}>{task.asset ? '取消并回收上传任务' : '取消上传任务'}</Button>}
        </Space>
      </li>)}</ul> }]} />}
      {value.length === 0 ? <Empty className={styles.empty} image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有车辆图片。上传后选择一张作为封面。" /> : <ol className={styles.gallery}>{value.map((media, index) => <li key={media.id}>
        <Card size="small" className={styles.imageCard} cover={<div className={styles.preview}>
          {previewErrors[media.id] ? <div className={styles.previewFallback}><Typography.Text type="secondary">预览暂不可用</Typography.Text><Button type="link" icon={<ReloadOutlined />} onClick={() => { setPreviewErrors(current => ({ ...current, [media.id]: false })); setPreviewAttempt(current => current + 1); }}>重新读取预览</Button></div> : <Image key={`${media.id}-${previewAttempt}`} src={`/api/v1/admin/media/${encodeURIComponent(media.id)}/preview`} alt={media.alt || `车辆图片 ${index + 1}`} onError={() => setPreviewErrors(current => ({ ...current, [media.id]: true }))} />}
          <div className={styles.imageTags}><Tag>{String(index + 1).padStart(2, '0')}</Tag>{media.isCover && <Tag color="green" icon={<StarFilled />}>封面</Tag>}</div>
        </div>}>
          <Form.Item label={`图片 ${index + 1} 说明`} htmlFor={`media-alt-${media.id}`}>
            <Input id={`media-alt-${media.id}`} aria-label={`图片 ${index + 1} 说明`} maxLength={500} value={media.alt} disabled={locked} placeholder="例如：车辆正面、内饰、里程表" onChange={event => updateMedia(value.map(item => item.id === media.id ? { ...item, alt: event.target.value } : item))} />
          </Form.Item>
          <div className={styles.cardActions}>
            <Button size="small" type={media.isCover ? 'primary' : 'default'} icon={media.isCover ? <StarFilled /> : <StarOutlined />} disabled={locked || media.isCover} onClick={() => updateMedia(value.map(item => ({ ...item, isCover: item.id === media.id })))}>{media.isCover ? '当前封面' : '设为封面'}</Button>
            <Space size={0}>
              <Button type="text" size="small" icon={<ArrowUpOutlined />} aria-label={`上移图片 ${index + 1}`} disabled={locked || index === 0} onClick={() => move(index, -1)} />
              <Button type="text" size="small" icon={<ArrowDownOutlined />} aria-label={`下移图片 ${index + 1}`} disabled={locked || index === value.length - 1} onClick={() => move(index, 1)} />
              <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`从草稿移除图片 ${index + 1}`} disabled={locked} onClick={() => updateMedia(normalizeMedia(value.filter(item => item.id !== media.id)))} />
            </Space>
          </div>
        </Card>
      </li>)}</ol>}
      {removedMedia.length > 0 && <Collapse className={styles.removed} items={[{ key: 'removed', label: `已移除图片 · ${removedMedia.length} 张待回收`, children: <section aria-label="已移除图片回收"><Alert type="info" showIcon title="保存移除后可以回收上传名额" description="已发布历史仍使用的图片会受到保护，无法回收。" /><ul className={styles.tasks}>{removedMedia.map((media, index) => <li key={media.id}>
        <div className={styles.taskHeading}><Typography.Text>{media.alt || `已移除图片 ${index + 1}`}</Typography.Text><Button size="small" icon={<DeleteOutlined />} disabled={locked || savedMediaIds.includes(media.id)} onClick={() => void recycle(media.id)}>回收已移除图片</Button></div>
        {savedMediaIds.includes(media.id) && <Typography.Text type="secondary">请先保存草稿，使移除生效。</Typography.Text>}
      </li>)}</ul></section> }]} />}
      <Typography.Paragraph className={styles.footerNote} type="secondary"><CheckCircleOutlined /> 发布历史图片受到保护。从草稿移除后，当前线上版本会继续使用原图片，直至再次发布。</Typography.Paragraph>
    </Card>
  </section>;
}

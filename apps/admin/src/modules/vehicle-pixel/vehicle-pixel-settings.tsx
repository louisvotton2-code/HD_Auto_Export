import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Modal, Space, Spin, Switch, Tag, Typography } from 'antd';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { ExternalListingResponseSchema, SaveVehiclePixelSettingsSchema, VehiclePixelSettingsResponseSchema,
  type ExternalListing, type VehiclePixelSettings } from '@hd/contracts/admin';
import { ApiClientError, requestWithTimeout } from '../../shared/api/client';
import { usePrivateResource } from '../../shared/api/use-private-resource';

export type PixelVehicle = { id: string; title: string; code: string; source: 'manual' | 'external' };
type SaveFailure = { reloadFirst: boolean; message: string };

function isPublicListing(listing: ExternalListing | undefined, id: string) {
  return listing?.id === id && listing.state === 'published' && listing.vehicle?.id === id;
}

function pixelNotFoundMessage(requestId?: string) {
  return `未能读取这辆车的 Pixel 设置。请刷新车源列表后重试。如果多辆车均出现此提示，请联系维护人员核对 Pixel 接口版本。${requestId ? `（参考编号：${requestId}）` : ''}`;
}

export function VehiclePixelSettings({ vehicle, onSaving, fromEnabledList, onRefreshIndex }: {
  vehicle: PixelVehicle;
  onSaving: (saving: boolean) => void;
  fromEnabledList: boolean;
  onRefreshIndex: () => void;
}) {
  const root = vehicle.source === 'manual' ? '/api/v1/admin/vehicles' : '/api/v1/admin/external/listings';
  const detailPath = `${root}/${encodeURIComponent(vehicle.id)}`;
  const path = `${detailPath}/pixel`;
  const listingPath = vehicle.source === 'external' ? `${detailPath}?locale=zh` : null;
  const [revision, setRevision] = useState(0);
  const listing = usePrivateResource(listingPath, ExternalListingResponseSchema, revision, 12_000);
  const eligible = !listingPath || isPublicListing(listing.data?.data, vehicle.id);
  const canRead = eligible || fromEnabledList;
  const settings = usePrivateResource(canRead ? path : null, VehiclePixelSettingsResponseSchema, revision, 12_000);
  const [saved, setSaved] = useState<VehiclePixelSettings | null>(null);
  const [draft, setDraft] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [saving, setSaving] = useState(false);
  const activeSave = useRef<AbortController | null>(null);
  const current = canRead && settings.data ? saved ?? settings.data.data : undefined;
  const canToggle = fromEnabledList ? current?.pixelEnabled === true : eligible;
  const identityMismatch = !!current && current.vehicleId !== vehicle.id;
  const changed = !!current && draft !== null && current.pixelEnabled !== draft;
  const hasPending = saving || (draft !== null && (!current || changed)) || !!failure?.reloadFirst;
  const leave = useBlocker(() => hasPending || activeSave.current !== null);

  useBeforeUnload(event => {
    if (hasPending || activeSave.current) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('admin:dirty', { detail: hasPending }));
    return () => { window.dispatchEvent(new CustomEvent('admin:dirty', { detail: false })); };
  }, [hasPending]);
  useEffect(() => () => {
    if (!activeSave.current) return;
    activeSave.current.abort();
    onSaving(false);
  }, [onSaving]);

  function reload() {
    setSaved(null);
    setSavedNotice(false);
    setFailure(null);
    listing.resume();
    settings.resume();
    setRevision(value => value + 1);
    if (fromEnabledList) onRefreshIndex();
  }

  async function save() {
    if (!current || identityMismatch || !canToggle || !changed || draft === null || failure?.reloadFirst || activeSave.current) return;
    const input = SaveVehiclePixelSettingsSchema.parse({ version: current.version, pixelEnabled: draft });
    const controller = new AbortController();
    activeSave.current = controller;
    setSaving(true);
    onSaving(true);
    setFailure(null);
    setSavedNotice(false);
    let submitted = false;
    const cancelForSession = () => {
      controller.abort();
      setFailure({ reloadFirst: true, message: submitted
        ? '登录已失效，保存结果待核对。重新登录后请读取最新设置。'
        : '登录已失效，你的选择已保留。重新登录后请重新核对。' });
      setSaving(false);
      onSaving(false);
    };
    window.addEventListener('admin:unauthorized', cancelForSession, { once: true });
    try {
      if (listingPath && input.pixelEnabled) {
        const { data: latest } = await requestWithTimeout(listingPath, ExternalListingResponseSchema, 12_000, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!isPublicListing(latest, vehicle.id)) {
          setFailure({ reloadFirst: true, message: '这条三方车源当前未确认公开。你的选择已保留，请重新核对。' });
          return;
        }
      }
      submitted = true;
      const { data } = await requestWithTimeout(path, VehiclePixelSettingsResponseSchema, 15_000,
        { method: 'PUT', body: JSON.stringify(input), signal: controller.signal });
      if (controller.signal.aborted) return;
      if (data.vehicleId !== vehicle.id || data.pixelEnabled !== input.pixelEnabled || data.version <= input.version) {
        setFailure({ reloadFirst: true, message: '保存回执与当前设置不一致。请读取服务端状态后再操作。' });
        return;
      }
      setSaved(data);
      setDraft(null);
      setSavedNotice(true);
      onRefreshIndex();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!submitted) {
        setFailure({ reloadFirst: true, message: '三方车源公开状态核对失败。你的选择已保留，请重新核对。' });
      } else if (error instanceof ApiClientError && error.status === 409) {
        setFailure({ reloadFirst: true, message: '这辆车的设置已被其他操作更新。你的选择已保留，请读取最新设置后再确认保存。' });
      } else if (error instanceof ApiClientError && error.status === 404) {
        setFailure({ reloadFirst: true, message: pixelNotFoundMessage(error.requestId) });
      } else if (error instanceof ApiClientError && [400, 401, 403, 422, 429].includes(error.status)) {
        setFailure({ reloadFirst: [401, 403].includes(error.status), message: error.message });
      } else {
        setFailure({ reloadFirst: true, message: '保存结果尚未确认。你的选择已保留，请先读取服务端状态。' });
      }
    } finally {
      window.removeEventListener('admin:unauthorized', cancelForSession);
      activeSave.current = null;
      if (!controller.signal.aborted) {
        setSaving(false);
        onSaving(false);
      }
    }
  }

  const settingsError = settings.errorStatus === 404 ? pixelNotFoundMessage(settings.errorRequestId) : settings.error;

  return <Card title="Facebook Pixel" extra={<Tag>{vehicle.code}</Tag>}>
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Text strong>{vehicle.title}</Typography.Text>
      <Typography.Text type="secondary">适用于这辆车的官网详情。事件发送须满足站点配置、车辆公开和访客同意条件。</Typography.Text>
      {listing.loading && <Spin description="正在核对三方车源的公开状态…" />}
      {listing.error && <Alert type="error" showIcon title="三方车源核对失败" description={listing.error}
        action={<Button size="small" onClick={reload}>重新核对</Button>} />}
      {listing.data && !eligible && <Alert type="warning" showIcon title="无法确认该三方车源已公开"
        description={fromEnabledList && current?.pixelEnabled
          ? '可关闭现有推广。再次开启需要车源在官网公开。'
          : '请核对所选车源当前是否在官网展示。'}
        action={<Button size="small" onClick={reload}>重新核对</Button>} />}
      {settings.loading && <Spin description="正在读取 Pixel 设置…" />}
      {(settings.error || identityMismatch) && <Alert type="error" showIcon title="读取 Pixel 设置失败"
        description={identityMismatch ? '服务返回的车辆与所选车源不一致。' : settingsError}
        action={<Button size="small" onClick={reload}>读取最新设置</Button>} />}
      {current && !identityMismatch && <Space wrap>
        <Switch aria-label="Facebook Pixel" checked={draft ?? current.pixelEnabled} disabled={saving || !canToggle || failure?.reloadFirst}
          onChange={value => { setDraft(value === current.pixelEnabled ? null : value); setFailure(null); setSavedNotice(false); }} />
        <Tag color={current.pixelEnabled ? 'green' : undefined}>{current.pixelEnabled ? '已开启' : '已关闭'}</Tag>
        {changed && <Tag color="gold">待保存</Tag>}
      </Space>}
      {current && !identityMismatch && <Button type="primary" aria-label="保存 Pixel 设置" aria-busy={saving} loading={saving}
        disabled={saving || !canToggle || !changed || !!failure?.reloadFirst}
        onClick={() => void save()}>保存 Pixel 设置</Button>}
      {failure && <Alert type={failure.reloadFirst ? 'warning' : 'error'} showIcon title={failure.reloadFirst ? 'Pixel 设置待确认' : 'Pixel 设置保存失败'} description={failure.message}
        action={failure.reloadFirst && canRead && !settings.error && <Button size="small" onClick={reload}>读取最新设置</Button>} />}
      {savedNotice && current && <Alert type="success" showIcon role="status" title="Pixel 设置已保存" />}
      {fromEnabledList && current?.pixelEnabled === false && !identityMismatch &&
        <Typography.Text type="secondary">如需重新开启，请从「查找车辆」进入。</Typography.Text>}
    </Space>
    <Modal open={leave.state === 'blocked'} title="离开 Pixel 推广？" okText="确认离开" cancelText="继续编辑"
      onOk={() => leave.proceed?.()} onCancel={() => leave.reset?.()}>
      <p>未保存的选择会丢失。若保存结果待确认，请重新打开该车辆读取最新设置。</p>
    </Modal>
  </Card>;
}

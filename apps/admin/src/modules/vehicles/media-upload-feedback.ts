import { StaffMeResponseSchema } from '@hd/contracts/admin';
import { ApiClientError, requestWithTimeout } from '../../shared/api/client';

export const uploadFailureReasons = {
  permitRejected: '上传许可申请未通过校验。请检查文件格式、大小和需要填写的图片来源。',
  contentRejected: '发送图片时未通过校验。请重新选择有效的 JPEG、PNG 或 WebP 图片。',
  processingRejected: '图片处理请求未通过校验。请核对待处理任务后重试。',
  fileTooLarge: '所选图片超过了上传大小限制。',
  unsupportedFormat: '服务器未接受所选图片的格式。',
  connectionInterrupted: '连接曾中断，上传结果可能已经变化。请先核对当前任务。',
  forbidden: '服务器拒绝了该上传操作。请核对当前账号的权限。',
  rateLimited: '当时上传操作过于频繁。',
  taskChanged: '当时的图片任务状态已变化，请按当前列表核对。',
  failed: '上传未能完成。请核对待处理任务后重试。',
} as const;

type UploadFailureReason = keyof typeof uploadFailureReasons;
export type UploadStep = 'permit' | 'upload' | 'complete';
export type UploadFailureNotice = { reason: UploadFailureReason; reference?: string };

const rejectionReasons = { permit: 'permitRejected', upload: 'contentRejected', complete: 'processingRejected' } as const;
const prefix = 'hd-admin:media-upload-failure:v1:';
const tabIdKey = 'hd-admin:media-upload-feedback-tab:v1';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function uploadFailureKey(staffId: string, vehicleId: string) {
  return `${prefix}${encodeURIComponent(staffId)}:${encodeURIComponent(vehicleId)}`;
}

function claimTab(id: string): Promise<boolean> {
  return new Promise(resolve => {
    void navigator.locks.request(`${tabIdKey}:${id}`, { ifAvailable: true }, lock => {
      resolve(Boolean(lock));
      if (lock) return new Promise<void>(release => {
        function onPageHide(event: PageTransitionEvent) {
          if (event.persisted) return;
          window.removeEventListener('pagehide', onPageHide);
          release();
        }
        window.addEventListener('pagehide', onPageHide);
      });
    }).catch(() => resolve(false));
  });
}

async function openTabStorage(): Promise<Storage | null> {
  try {
    if (typeof window === 'undefined' || !navigator.locks) return null;
    const storage = window.sessionStorage;
    const navigation = window.performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    // A new document opened or duplicated from another tab can inherit its session storage.
    let tabId = navigation?.type === 'reload' ? safeReference(storage.getItem(tabIdKey)) : undefined;
    if (!tabId || !await claimTab(tabId)) {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) storage.removeItem(key);
      }
      tabId = window.crypto.randomUUID();
      if (!await claimTab(tabId)) return null;
    }
    storage.setItem(tabIdKey, tabId);
    return storage;
  } catch { return null; }
}

const uploadStorage = openTabStorage();

function safeReference(value: unknown): string | undefined {
  return typeof value === 'string' && uuid.test(value) ? value : undefined;
}

export async function readUploadFailure(key: string): Promise<UploadFailureNotice | null> {
  try {
    const raw = (await uploadStorage)?.getItem(key);
    const entry = raw && JSON.parse(raw);
    if (typeof entry?.reason !== 'string' || !Object.prototype.hasOwnProperty.call(uploadFailureReasons, entry.reason)) return null;
    return { reason: entry.reason, reference: safeReference(entry.reference) };
  } catch { return null; }
}

export async function saveUploadFailure(key: string, notice: UploadFailureNotice | null) {
  try {
    const storage = await uploadStorage;
    if (notice) storage?.setItem(key, JSON.stringify({ reason: notice.reason, reference: safeReference(notice.reference) }));
    else storage?.removeItem(key);
  } catch { /* Uploading remains available when session storage is blocked. */ }
}

export function describeUploadFailure(failure: unknown, step: UploadStep): UploadFailureNotice | null {
  if (!(failure instanceof ApiClientError)) return { reason: 'failed' };
  if (failure.status === 401) return null;
  const reason = failure.code === 'UNSUPPORTED_MEDIA_TYPE' || failure.status === 415 ? 'unsupportedFormat'
    : failure.status === 400 ? rejectionReasons[step]
    : failure.status === 413 ? 'fileTooLarge'
    : failure.status === 403 ? 'forbidden'
    : failure.status === 429 ? 'rateLimited'
    : failure.status === 409 || failure.status === 404 ? 'taskChanged'
    : failure.code === 'NETWORK_ERROR' || failure.code === 'REQUEST_TIMEOUT' ? 'connectionInterrupted'
    : 'failed';
  return { reason, reference: safeReference(failure.requestId) };
}

export async function confirmUploadFailureOwner(staffId: string, signal: AbortSignal): Promise<'same' | 'changed' | 'unavailable'> {
  try {
    const identity = (await requestWithTimeout('/api/v1/admin/me', StaffMeResponseSchema, 4_000, { signal })).data;
    return identity.id === staffId ? 'same' : 'changed';
  } catch (failure) { return failure instanceof ApiClientError && failure.status === 401 ? 'changed' : 'unavailable'; }
}

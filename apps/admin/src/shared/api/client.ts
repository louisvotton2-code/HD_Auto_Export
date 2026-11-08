import { ApiErrorSchema } from '@hd/contracts/admin';

const messages: Record<string, string> = {
  INVALID_REQUEST: '请检查填写内容后重试。',
  DEMO_RESTRICTION: '展示样例不能设为实际库存，请保留待询价与库存未知。',
  EXTERNAL_RESTRICTION: '外部挂牌需保留来源身份、参考价格或待询价，以及库存未知。',
  SOURCE_IDENTITY_CONFLICT: '这条外部挂牌已录入（可能在回收站），请核对来源后查看已有车辆。',
  UNAUTHENTICATED: '登录已失效，请重新登录。',
  FORBIDDEN: '当前账号没有此操作权限。',
  NOT_FOUND: '未找到这条记录，可能已被移除。',
  VERSION_CONFLICT: '记录已被其他同事更新。你的输入已保留，请比较最新版本。',
  IDEMPOTENCY_CONFLICT: '这次提交与原请求不一致，请先确认已有结果。',
  PAYLOAD_TOO_LARGE: '文件超过允许大小。',
  PUBLISH_VALIDATION_FAILED: '尚未满足发布条件，请检查缺项。',
  MEDIA_NOT_READY: '图片尚未处理完成。',
  MEDIA_IN_USE: '图片仍被使用，无法删除。',
  UNSUPPORTED_MEDIA_TYPE: '图片格式不受支持。',
  RATE_LIMITED: '操作太频繁，请稍后再试。',
  SERVICE_UNAVAILABLE: '服务暂时不可用，请稍后重试。',
  INTERNAL_ERROR: '服务处理失败，请稍后重试。',
  NETWORK_ERROR: '连接中断，尚不能确认操作结果。请保留当前页面后重试。',
  INVALID_RESPONSE: '服务返回的数据无法识别，请联系维护人员。',
};

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields: { path: string; code: string; message: string }[] = [],
    public requestId?: string,
  ) {
    super(`${messages[code] ?? '操作未完成，请稍后重试。'}${requestId ? `（参考编号：${requestId}）` : ''}`);
    this.name = 'ApiClientError';
  }
}

async function send(path: string, options: RequestInit = {}): Promise<unknown> {
  if (!path.startsWith('/api/') || path.includes('\\')) throw new Error('Only same-origin API paths are allowed');
  const headers = new Headers(options.headers);
  if (options.body && typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiClientError(0, 'NETWORK_ERROR');
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('admin:unauthorized'));
    }
    const parsed = ApiErrorSchema.safeParse(value);
    if (parsed.success) throw new ApiClientError(response.status, parsed.data.error.code, parsed.data.error.fields, parsed.data.meta.requestId);
    const code = response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'FORBIDDEN' : response.status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE';
    throw new ApiClientError(response.status, code);
  }
  return value;
}

export async function request<T>(path: string, schema: { parse(data: unknown): T }, options?: RequestInit): Promise<T> {
  const value = await send(path, options);
  try { return schema.parse(value); } catch { throw new ApiClientError(0, 'INVALID_RESPONSE'); }
}

// Better Auth responses deliberately do not use the business envelope.
export async function signIn(email: string, password: string): Promise<void> {
  await send('/api/auth/sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) });
}
export async function signOut(): Promise<void> {
  await send('/api/auth/sign-out', { method: 'POST', body: '{}' });
}

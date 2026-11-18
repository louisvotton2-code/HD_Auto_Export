import { useEffect, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useOutletContext } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  StaffCreateRequestSchema, StaffDirectoryResponseSchema, StaffLoginSchema, StaffMutationResponseSchema,
  StaffPasswordResetRequestSchema, StaffPasswordSchema, StaffRecordResponseSchema, type StaffMe, type StaffRecord,
} from '@hd/contracts/admin';
import { ApiClientError, request } from '../../shared/api/client';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import { formatTime } from '../vehicles/draft-form';

const staffPath = '/api/v1/admin/staff';
const countFormat = new Intl.NumberFormat('zh-CN');
const roleLabels = { admin: '管理员', editor: '编辑员' };
const actionLabels = { create: '添加员工', reset: '重置密码', remove: '删除员工' };

type StaffAction = { kind: 'create' } | { kind: 'reset' | 'remove'; employee: StaffRecord };
type StaffForm = { login?: string; name?: string; password: string };

function uploadsPath(id: string) {
  return `/vehicles?${new URLSearchParams({ uploader: id })}`;
}

function staffStatus(record: StaffRecord) {
  return <Tag color={record.disabled ? 'default' : 'success'}>{record.disabled ? '已停用' : '已启用'}</Tag>;
}

export function StaffManagementPage() {
  const currentStaff = useOutletContext<StaffMe>();
  const [form] = Form.useForm<StaffForm>();
  const [revision, setRevision] = useState(0);
  const resource = usePrivateResource(staffPath, StaffDirectoryResponseSchema, revision);
  const [accepted, setAccepted] = useState<StaffRecord[] | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [action, setAction] = useState<StaffAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [unconfirmedResets, setUnconfirmedResets] = useState<string[]>([]);
  const mutation = useRef<AbortController | null>(null);
  const sessionActive = useRef(true);
  const records = resource.error ? null : accepted;
  const profile = records?.find(record => record.id === profileId);
  const unavailable = busy || needsReload || resource.loading || Boolean(resource.error) || accepted === null;
  const hasUnconfirmed = needsReload || unconfirmedResets.length > 0;
  const blocker = useBlocker(() => mutation.current !== null || hasUnconfirmed);

  useBeforeUnload(event => {
    if (mutation.current || hasUnconfirmed) event.preventDefault();
  });
  useEffect(() => {
    if (blocker.state === 'blocked' && mutation.current) blocker.reset();
  }, [blocker]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('admin:dirty', { detail: busy || hasUnconfirmed }));
    return () => { window.dispatchEvent(new CustomEvent('admin:dirty', { detail: false })); };
  }, [busy, hasUnconfirmed]);

  useEffect(() => {
    if (!resource.error) return;
    setAccepted(null);
    setProfileId(null);
  }, [resource.error]);

  useEffect(() => {
    if (!sessionActive.current || !resource.data) return;
    setAccepted(resource.data.data.items);
    setNeedsReload(false);
  }, [resource.data]);

  useEffect(() => {
    const clearPrivateState = () => {
      sessionActive.current = false;
      mutation.current?.abort();
      mutation.current = null;
      setAccepted(null);
      setProfileId(null);
      setAction(null);
      setBusy(false);
      setNotice('');
      setActionError('');
      setNeedsReload(false);
      setUnconfirmedResets([]);
    };
    window.addEventListener('admin:unauthorized', clearPrivateState);
    return () => {
      window.removeEventListener('admin:unauthorized', clearPrivateState);
      mutation.current?.abort();
    };
  }, []);

  function reload() {
    sessionActive.current = true;
    resource.resume();
    setRevision(value => value + 1);
  }

  function openAction(next: StaffAction) {
    if (unavailable || mutation.current) return;
    setActionError('');
    setNotice('');
    setAction(next);
  }

  function closeAction() {
    if (mutation.current) return;
    form.resetFields();
    setAction(null);
    setActionError('');
  }

  async function perform(values?: StaffForm) {
    if (!action || unavailable || mutation.current || (action.kind !== 'remove' && !values)) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setActionError('');
    if (values) form.setFieldValue('password', '');
    try {
      if (action.kind === 'create' && values) {
        const { data } = await request(staffPath, StaffRecordResponseSchema, {
          method: 'POST', signal: controller.signal,
          body: JSON.stringify(StaffCreateRequestSchema.parse(values)),
        });
        if (controller.signal.aborted) return;
        if (data.role !== 'editor') throw new ApiClientError(0, 'INVALID_RESPONSE');
        setAccepted(previous => [data, ...(previous ?? []).filter(record => record.id !== data.id)]);
      } else if (action.kind !== 'create') {
        const employeePath = `${staffPath}/${encodeURIComponent(action.employee.id)}`;
        const { data } = action.kind === 'remove'
          ? await request(employeePath, StaffMutationResponseSchema, { method: 'DELETE', signal: controller.signal })
          : await request(`${employeePath}/password`, StaffMutationResponseSchema, {
            method: 'POST', signal: controller.signal, body: JSON.stringify(StaffPasswordResetRequestSchema.parse({ password: values?.password })),
          });
        if (controller.signal.aborted) return;
        if (data.id !== action.employee.id) throw new ApiClientError(0, 'INVALID_RESPONSE');
        setUnconfirmedResets(previous => previous.filter(login => login !== action.employee.login));
        if (action.kind === 'remove') setAccepted(previous => previous?.filter(record => record.id !== data.id) ?? null);
      } else return;

      const result = action.kind === 'create' ? '员工账号已添加。' : action.kind === 'reset' ? '密码已重置。该员工需要使用新密码重新登录。' : '员工账号已删除，原账号无法继续登录。';
      form.resetFields();
      setAction(null);
      setNotice(result);
      reload();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiClientError && error.status === 403) {
        setAccepted(null);
        setProfileId(null);
        setUnconfirmedResets([]);
        setAction(null);
        setNeedsReload(true);
      } else if (error instanceof ApiClientError && (error.status === 0 || error.status >= 500)) {
        setNeedsReload(true);
        if (action.kind === 'reset') setUnconfirmedResets(previous => previous.includes(action.employee.login)
          ? previous : [...previous, action.employee.login]);
        setActionError('暂未确认操作结果。请关闭窗口，刷新员工列表后核对。');
      } else setActionError(error instanceof ApiClientError ? error.message : '员工操作失败，请重试。');
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  return <section>
    <div className="page-heading">
      <div><h1>员工管理</h1><p>管理员工账号，查看车辆录入统计。</p></div>
      <Space wrap>
        <Button disabled={busy} loading={resource.loading} icon={<ReloadOutlined />} onClick={reload}>刷新员工列表</Button>
        <Button disabled={unavailable} icon={<PlusOutlined />} onClick={() => openAction({ kind: 'create' })}>添加员工</Button>
      </Space>
    </div>
    {resource.error && <Alert type="error" showIcon title="员工列表读取失败" description={resource.error} style={{ marginBottom: 16 }} />}
    {needsReload && <Alert type="warning" showIcon title="请刷新员工列表，核对上次操作结果" style={{ marginBottom: 16 }} />}
    {!needsReload && records && unconfirmedResets.map(login => <Alert type="warning" showIcon key={login} title={`${login} 的上次密码重置结果未确认`}
      description="员工列表无法确认密码是否变更。如需改密，请为该账号重新设置密码。" style={{ marginBottom: 16 }} />)}
    {notice && <Alert type="success" showIcon title={notice} style={{ marginBottom: 16 }} />}
    <Card className="workspace-card" title="员工列表">
      <Table<StaffRecord> rowKey="id" dataSource={records ?? []} loading={resource.loading} scroll={{ x: 780 }}
        locale={{ emptyText: resource.error && !accepted ? '员工资料暂不可用' : '暂无员工' }}
        columns={[
          { title: '员工姓名', render: (_, record) => <Button type="link" onClick={() => setProfileId(record.id)}>{record.name}</Button> },
          { title: '登录账号', dataIndex: 'login' },
          { title: '角色', render: (_, record) => roleLabels[record.role] },
          { title: '账号状态', render: (_, record) => staffStatus(record) },
          { title: '今日上传', align: 'right', render: (_, record) => countFormat.format(record.uploads.today) },
          { title: '累计上传', align: 'right', render: (_, record) => countFormat.format(record.uploads.total) },
          { title: '操作', render: (_, record) => <Space wrap>
            <Link to={uploadsPath(record.id)}>查看上传车辆</Link>
            {record.role === 'editor' && record.id !== currentStaff.id && !record.disabled && <>
              <Button size="small" disabled={unavailable} onClick={() => openAction({ kind: 'reset', employee: record })}>重置密码</Button>
              <Button size="small" danger disabled={unavailable} onClick={() => openAction({ kind: 'remove', employee: record })}>删除员工</Button>
            </>}
          </Space> },
        ]} />
    </Card>
    <Modal open={Boolean(profile)} title="员工资料" onCancel={() => setProfileId(null)} footer={null} destroyOnHidden>
      {profile && <>
        <Descriptions column={1} size="small" items={[
          { key: 'name', label: '员工姓名', children: profile.name },
          { key: 'login', label: '登录账号', children: profile.login },
          { key: 'role', label: '角色', children: roleLabels[profile.role] },
          { key: 'status', label: '账号状态', children: staffStatus(profile) },
          { key: 'created', label: '创建时间', children: formatTime(profile.createdAt) },
          { key: 'updated', label: '更新时间', children: formatTime(profile.updatedAt) },
          { key: 'today', label: '今日上传', children: countFormat.format(profile.uploads.today) },
          { key: 'total', label: '累计上传', children: countFormat.format(profile.uploads.total) },
        ]} />
        <Link to={uploadsPath(profile.id)}>查看上传车辆</Link>
      </>}
    </Modal>
    <Modal open={action !== null} title={action && actionLabels[action.kind]} destroyOnHidden
      okText={action?.kind === 'remove' ? '确认删除' : action?.kind === 'reset' ? '确认重置' : '添加员工'} cancelText="取消"
      confirmLoading={busy} closable={!busy} keyboard={!busy} mask={{ closable: !busy }}
      okButtonProps={{ danger: action?.kind === 'remove', disabled: unavailable }} cancelButtonProps={{ disabled: busy }}
      onCancel={closeAction} onOk={() => action?.kind === 'remove' ? void perform() : form.submit()}>
      {action && <Form form={form} layout="vertical" preserve={false} disabled={busy} onFinish={values => void perform(values)}>
        {action.kind === 'create' && <>
          <Form.Item name="login" label="登录账号" rules={[{ validator: (_, value) => StaffLoginSchema.safeParse(value).success
            ? Promise.resolve() : Promise.reject(new Error('请输入有效的账号或工作邮箱。')) }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="name" label="员工姓名" rules={[{ required: true, whitespace: true, max: 200, message: '请输入 1–200 个字符的员工姓名。' }]}>
            <Input maxLength={200} autoComplete="off" />
          </Form.Item>
        </>}
        {action.kind === 'reset' && <Typography.Paragraph>为 {action.employee.name}（{action.employee.login}）设置新密码。重置后，原会话将失效，该员工需要重新登录。</Typography.Paragraph>}
        {action.kind === 'remove' ? <Typography.Paragraph>
          删除 {action.employee.name}（{action.employee.login}）的后台访问权限。其登录会话将失效，已录入的车辆和历史记录会保留。
        </Typography.Paragraph> : <Form.Item name="password" label={action.kind === 'create' ? '初始密码' : '新密码'}
          rules={[{ validator: (_, value: unknown) => StaffPasswordSchema.safeParse(value).success
            ? Promise.resolve() : Promise.reject(new Error('密码须为 12–128 个字符。')) }]}>
          <Input.Password autoComplete="new-password" maxLength={128} />
        </Form.Item>}
        {actionError && <Alert type="error" showIcon title={actionError} />}
      </Form>}
    </Modal>
    <Modal open={blocker.state === 'blocked' && !busy} title="员工操作结果尚未确认"
      okText="离开员工管理" cancelText="留在当前页面"
      onOk={() => blocker.state === 'blocked' && blocker.proceed()}
      onCancel={() => blocker.state === 'blocked' && blocker.reset()}>
      离开后，本页的待核对提示将清除。返回时可重新核对账号状态。
    </Modal>
  </section>;
}

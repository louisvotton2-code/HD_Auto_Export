import { useEffect, useState, type ReactNode } from 'react';
import { Alert, App, Avatar, Breadcrumb, Button, Card, Drawer, Form, Grid, Input, Layout, Menu, Modal, Result, Space, Spin, Tag, Typography } from 'antd';
import { CarOutlined, CheckCircleOutlined, CloseOutlined, DeleteOutlined, HomeOutlined, LockOutlined, LogoutOutlined, MenuOutlined, SafetyCertificateOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import { StaffLoginSchema, StaffMeResponseSchema, type StaffMe } from '@hd/contracts/admin';
import { ApiClientError, request, signIn, signOut } from '../../shared/api/client';
import { Link, Outlet, useLocation } from 'react-router-dom';

// Original public-header asset: apps/web/public/brand/hd-auto-logo.webp.
// SHA-256: ff10157d783b86d3326dc089c564beaa24d1b54b2ba0b10d64360eed8fbe4d16.
const brandLogo = `${import.meta.env.BASE_URL}brand/hd-auto-logo.webp`;

function BrandIdentity() {
  return <><img className="brand-logo" src={brandLogo} width={960} height={648} alt="" aria-hidden="true" /><span className="brand-type">HD Auto Export<small>员工工作台</small></span></>;
}

function LoginForm({ onLogin, expired = false }: { onLogin: (staff: StaffMe) => void; expired?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(values: { login: string; password: string }) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await signIn(values.login, values.password);
      onLogin((await request('/api/v1/admin/me', StaffMeResponseSchema)).data);
    } catch (failure) {
      setError(failure instanceof ApiClientError && failure.status === 401 ? '账号或密码不正确，请重新输入。' : failure instanceof Error ? failure.message : '登录失败，请稍后重试。');
    } finally { setBusy(false); }
  }
  return <div className="login-form">
    <div className="login-brand"><BrandIdentity /></div>
    <Typography.Title id="login-title" level={2}>{expired ? '重新登录' : '登录员工工作台'}</Typography.Title>
    <Typography.Paragraph type="secondary">{expired ? '登录已失效，当前编辑已保留。使用原账号登录即可继续。' : '欢迎回来。登录后管理车辆、审核资料与安排展示。'}</Typography.Paragraph>
    <Form layout="vertical" onFinish={submit} requiredMark={false} size="large" autoComplete="on">
      <Form.Item label="账号或工作邮箱" name="login" rules={[{ validator: (_, value) => StaffLoginSchema.safeParse(value).success ? Promise.resolve() : Promise.reject(new Error('请输入有效的账号或邮箱')) }]}><Input prefix={<UserOutlined />} placeholder="请输入账号或工作邮箱" autoComplete="username" autoFocus /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}><Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" /></Form.Item>
      {error && <Alert title={error} type="error" showIcon className="login-alert" />}
      <Button type="primary" htmlType="submit" block loading={busy}>登录工作台</Button>
    </Form>
    <div className="login-footnote"><SafetyCertificateOutlined /> 员工专属空间 · 账号由管理员维护</div>
  </div>;
}

export function Workspace() {
  const { modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const narrow = !screens.lg;
  const location = useLocation();
  const [staff, setStaff] = useState<StaffMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  async function load() {
    setLoading(true); setError('');
    try { setStaff((await request('/api/v1/admin/me', StaffMeResponseSchema)).data); }
    catch (failure) { if (!(failure instanceof ApiClientError && failure.status === 401)) setError(failure instanceof Error ? failure.message : '暂时无法连接服务。'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void load();
    const unauthorized = () => setExpired(true);
    const changed = (event: Event) => setDirty(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('admin:unauthorized', unauthorized); window.addEventListener('admin:dirty', changed);
    return () => { window.removeEventListener('admin:unauthorized', unauthorized); window.removeEventListener('admin:dirty', changed); };
  }, []);
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const loggedIn = (next: StaffMe) => { setStaff(next); setExpired(false); setError(''); };
  async function logout() {
    if (dirty && !await modal.confirm({ title: '退出并放弃未保存内容？', content: '当前未保存的修改会丢失。仍在处理的请求请先核对结果。', okText: '确认退出', cancelText: '继续编辑', okButtonProps: { danger: true } })) return;
    setBusy(true); setError('');
    try { await signOut(); setStaff(null); setExpired(false); setDirty(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '退出失败，请重试。'); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="centered-state"><Spin size="large" description="正在确认员工身份…" /></main>;
  if (!staff) return <main className="login-screen">
    <section className="login-story"><Link to="/" className="brand-mark"><BrandIdentity /></Link><div><div className="login-kicker">为每一次交付，做好准备</div><h1>让车源管理<br />更清楚、更从容。</h1><p>从车辆档案到内容审核，再到网站展示，<br />把团队的日常工作放在同一个空间。</p><div className="login-steps">{['整理车辆资料', '核对图片与三语', '确认发布与展示'].map((text, i) => <div key={text}><span>0{i + 1}</span>{text}<CheckCircleOutlined /></div>)}</div></div><small>HD Auto Export · 员工协作平台</small></section>
    <section className="login-panel">{error ? <Card className="login-card"><Result status="warning" title="暂时无法进入工作台" subTitle={error} extra={<Button onClick={() => void load()}>重新连接</Button>} /></Card> : <Card className="login-card" bordered={false}><LoginForm onLogin={loggedIn} /></Card>}</section>
  </main>;
  const current = location.pathname.startsWith('/home-sections') ? '/home-sections' : location.pathname.startsWith('/public-catalog') ? '/public-catalog' : location.pathname.startsWith('/recycle-bin') ? '/recycle-bin' : '/vehicles';
  const pageName = current === '/home-sections' ? '首页展示配置' : current === '/public-catalog' ? '公开车源核验' : current === '/recycle-bin' ? '车辆回收站' : '车辆工作台';
  const menuItems = [
    { key: '/vehicles', icon: <CarOutlined />, label: <Link to="/vehicles">车辆管理</Link> },
    { key: '/recycle-bin', icon: <DeleteOutlined />, label: <Link to="/recycle-bin">车辆回收站</Link> },
    ...(staff.permissions.includes('home:write') ? [{ key: '/home-sections', icon: <HomeOutlined />, label: <Link to="/home-sections">首页展示配置</Link> }] : []),
    { key: '/public-catalog', icon: <SearchOutlined />, label: <Link to="/public-catalog">公开车源核验</Link> },
  ];
  const navigation = <div className="sidebar-inner"><Link className="brand-mark" to="/vehicles"><BrandIdentity /></Link><div className="nav-caption">运营空间</div><nav aria-label="后台导航"><Menu theme="dark" selectedKeys={[current]} items={menuItems} /></nav><div className="nav-bottom"><SafetyCertificateOutlined /><div>内部协作空间<small>车源 · 内容 · 展示</small></div></div></div>;
  return <>
    <Layout className="workspace" key={staff.id} inert={expired}>
      <Layout.Sider width={232} className="workspace-sidebar">{navigation}</Layout.Sider>
      <Layout className="workspace-body"><Layout.Header className="topbar"><Space size={16}>{narrow && <Button type="text" icon={<MenuOutlined />} aria-label="打开导航" onClick={() => setMenuOpen(true)} />}<Breadcrumb items={[{ title: '运营管理' }, { title: pageName }]} /></Space><Space size={14}><Tag className="local-tag" bordered={false}>本地工作台</Tag><Avatar className="staff-avatar" icon={<UserOutlined />} /><div className="staff-name">{staff.name}<small>{staff.role === 'admin' ? '管理员' : '编辑员'}</small></div><Button type="text" icon={<LogoutOutlined />} onClick={() => void logout()} loading={busy}>退出登录</Button></Space></Layout.Header>
        <Layout.Content id="main-content" className="page-content">{error && <Alert title={error} type="error" showIcon closable onClose={() => setError('')} />}<Outlet context={staff} /></Layout.Content><Layout.Footer className="app-footer">HD Auto Export <span>车辆运营工作台</span></Layout.Footer>
      </Layout>
    </Layout>
    <Drawer open={menuOpen && narrow && !expired} onClose={() => setMenuOpen(false)} placement="left" width={252} title={null} className="mobile-nav" closeIcon={<CloseOutlined style={{ color: '#e5c05b' }} />}>{navigation}</Drawer>
    <Modal open={expired} footer={null} closable={false} keyboard={false} maskClosable={false} title={null} width={460} centered><LoginForm expired onLogin={loggedIn} /></Modal>
  </>;
}

export function AccessDenied({ children }: { children?: ReactNode }) {
  return <Result status="403" title="没有访问权限" subTitle={children ?? '请联系管理员确认账号权限。'} />;
}

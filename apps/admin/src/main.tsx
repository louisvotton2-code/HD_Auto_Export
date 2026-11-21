import { createRoot } from 'react-dom/client';
import { Alert, App, Button, ConfigProvider, Space, Spin } from 'antd';
import { lazy, Suspense, type ReactNode } from 'react';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import { HomeSectionsPage } from './modules/home';
import { ExternalStatusPage, ExternalCatalogPage, ExternalBatchHistoryPage, ExternalBatchPage, ExternalBatchRecordPage, ExternalListingPage, ExternalWorkspace } from './modules/external-sources';
import { createBrowserRouter, Navigate, RouterProvider, useOutletContext, useParams, Link } from 'react-router-dom';
import type { StaffMe, StaffPermission } from '@hd/contracts/admin';
import { Workspace, AccessDenied } from './modules/auth';
import { StaffManagementPage } from './modules/staff/staff-management-page';
import { VehiclesPage, VehicleEditorPage, PublicCatalogPage } from './modules/vehicles';
import './styles.css';

const SiteAnalyticsPage = lazy(async () => ({ default: (await import('./modules/analytics/site-analytics-page')).SiteAnalyticsPage }));
const VehiclePixelPage = lazy(async () => ({ default: (await import('./modules/vehicle-pixel/vehicle-pixel-page')).VehiclePixelPage }));

function RequirePermission({ permission, children }: { permission: StaffPermission; children: ReactNode }) {
  const staff = useOutletContext<StaffMe>();
  return staff.permissions.includes(permission) ? children : <AccessDenied />;
}
function VehicleEditorRoute() {
  const { id } = useParams();
  return <RequirePermission permission="vehicles:write"><VehicleEditorPage key={id ?? 'new'} /></RequirePermission>;
}
function VehiclePixelRoute() {
  const staff = useOutletContext<StaffMe>();
  return staff.role === 'admin'
    ? <Suspense fallback={<Spin description="正在打开 Pixel 推广…" />}><VehiclePixelPage /></Suspense>
    : <AccessDenied>只有管理员可以管理车辆的 Facebook Pixel。</AccessDenied>;
}
function AnalyticsRouteError() {
  return <Alert type="error" showIcon title="网站分析页面加载失败" action={<Space wrap>
    <Button onClick={() => window.location.reload()}>重新加载页面</Button>
    <Link to="/vehicles">返回精品车辆管理</Link>
  </Space>} />;
}
const router = createBrowserRouter([{
  element: <Workspace />,
  children: [
    { index: true, element: <Navigate to="/vehicles" replace /> },
    { path: 'vehicles', element: <RequirePermission permission="vehicles:read"><VehiclesPage key="active" /></RequirePermission> },
    { path: 'recycle-bin', element: <RequirePermission permission="vehicles:read"><VehiclesPage key="deleted" deleted /></RequirePermission> },
    { path: 'vehicles/new', element: <VehicleEditorRoute /> },
    { path: 'vehicles/:id', element: <VehicleEditorRoute /> },
    { path: 'home-sections', element: <RequirePermission permission="home:write"><HomeSectionsPage /></RequirePermission> },
    { path: 'public-catalog', element: <RequirePermission permission="vehicles:read"><ExternalCatalogPage /></RequirePermission> },
    { path: 'public-catalog/verification', element: <RequirePermission permission="vehicles:read"><PublicCatalogPage /></RequirePermission> },
    { path: 'analytics', errorElement: <AnalyticsRouteError />,
      element: <RequirePermission permission="staff:manage"><Suspense fallback={<Spin description="正在打开网站分析…" />}><SiteAnalyticsPage /></Suspense></RequirePermission> },
    { path: 'vehicle-pixel', element: <VehiclePixelRoute />, errorElement: <Alert type="error" showIcon title="Pixel 推广页面加载失败"
      action={<Button onClick={() => window.location.reload()}>重新加载页面</Button>} /> },
    { path: 'staff', element: <RequirePermission permission="staff:manage"><StaffManagementPage /></RequirePermission> },
    { path: 'external-sources', element: <RequirePermission permission="vehicles:read"><ExternalWorkspace /></RequirePermission>, children: [
      { index: true, element: <RequirePermission permission="staff:manage"><ExternalStatusPage /></RequirePermission> },
      { path: 'batches', element: <ExternalBatchHistoryPage /> },
      { path: 'batches/:batchId', element: <ExternalBatchPage /> },
      { path: 'batches/:batchId/records/:row', element: <ExternalBatchRecordPage /> },
      { path: 'listings/:listingId', element: <ExternalListingPage /> },
    ] },
    { path: '*', element: <section><h1>页面不存在</h1><Link to="/vehicles">返回车辆管理</Link></section> },
  ],
}], { basename: '/admin' });

createRoot(document.getElementById('root')!).render(<ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#94701f', colorPrimaryHover: '#795912', colorPrimaryActive: '#62470d', colorInfo: '#94701f', colorLink: '#89671a', colorLinkHover: '#6b4d0d', colorLinkActive: '#62470d', colorBgLayout: '#f6f5f1', colorText: '#29261f', colorTextSecondary: '#716b5f', colorBorder: '#dcd7ca', borderRadius: 10, fontSize: 13, controlHeight: 36 }, components: { Button: { primaryShadow: 'none' }, Table: { headerBg: '#faf9f5', headerColor: '#716b5f', rowHoverBg: '#faf7ee' }, Card: { headerFontSize: 15 }, Menu: { darkItemBg: '#191815', darkSubMenuItemBg: '#191815', darkItemColor: '#c7c0b1', darkItemHoverBg: '#28251d', darkItemSelectedBg: '#36301f', darkItemSelectedColor: '#e5c05b' } } }}><App><RouterProvider router={router} /></App></ConfigProvider>);

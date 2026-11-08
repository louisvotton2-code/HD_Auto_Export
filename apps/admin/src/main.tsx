import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import { HomeSectionsPage } from './modules/home';
import { createBrowserRouter, Navigate, RouterProvider, useOutletContext, useParams, Link } from 'react-router-dom';
import type { StaffMe, StaffPermission } from '@hd/contracts/admin';
import { Workspace, AccessDenied } from './modules/auth';
import { VehiclesPage, VehicleEditorPage, PublicCatalogPage } from './modules/vehicles';
import type { ReactNode } from 'react';
import './styles.css';

function RequirePermission({ permission, children }: { permission: StaffPermission; children: ReactNode }) {
  const staff = useOutletContext<StaffMe>();
  return staff.permissions.includes(permission) ? children : <AccessDenied />;
}
function VehicleEditorRoute() {
  const { id } = useParams();
  return <RequirePermission permission="vehicles:write"><VehicleEditorPage key={id ?? 'new'} /></RequirePermission>;
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
    { path: 'public-catalog', element: <RequirePermission permission="vehicles:read"><PublicCatalogPage /></RequirePermission> },
    { path: '*', element: <section><h1>页面不存在</h1><Link to="/vehicles">返回车辆管理</Link></section> },
  ],
}], { basename: '/admin' });

createRoot(document.getElementById('root')!).render(<ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#28785d', colorInfo: '#28785d', colorBgLayout: '#f4f6f8', colorText: '#253d41', colorTextSecondary: '#607278', borderRadius: 10, fontSize: 13, controlHeight: 36 }, components: { Button: { primaryShadow: 'none' }, Table: { headerBg: '#fafbfc', headerColor: '#607278', rowHoverBg: '#f7faf8' }, Card: { headerFontSize: 15 }, Menu: { darkItemBg: '#112b30', darkSubMenuItemBg: '#112b30' } } }}><App><RouterProvider router={router} /></App></ConfigProvider>);

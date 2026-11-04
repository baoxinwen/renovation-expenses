import { createContext, lazy, Suspense, useContext } from 'react';
import { BrowserRouter, Link, Navigate, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Button, ConfigProvider, Layout, Menu, Spin } from 'antd';
import { BarChartOutlined, FileTextOutlined, OrderedListOutlined, SettingOutlined } from '@ant-design/icons';
import { Toaster } from 'sonner';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import { woodTheme } from './styles/theme';
import { useThemeMode, type ThemeMode } from './hooks/useThemeMode';
import { useIsMobile } from './hooks/useIsMobile';
import MobileTabBar from './components/MobileTabBar';
import MobileHome from './pages/mobile/MobileHome';
import MobileItems from './pages/mobile/MobileItems';
import MobileRecord from './pages/mobile/MobileRecord';
import Plan from './pages/Plan';

// 路由级代码分割（M5）：此前 echarts/antd/全部页面合成单个 2.5MB chunk，
// 手机每次发版后首访都要全量拉取。首屏（清单/移动三页）保持同步加载，
// 重页面按需拉取——局域网下 Suspense 占位一闪即过
const Analysis = lazy(() => import('./pages/analysis'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const Settings = lazy(() => import('./pages/Settings'));
const PrintSection = lazy(() => import('./pages/PrintSection'));

const PageFallback = () => (
  <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
);

dayjs.locale('zh-cn');

const { Sider, Content } = Layout;

export const ThemeModeContext = createContext<{
  mode: ThemeMode; isDark: boolean; setMode: (m: ThemeMode) => void;
}>({
  mode: 'system',
  isDark: false,
  setMode: () => {},
});
export const useThemeModeCtx = () => useContext(ThemeModeContext);

/** 内容区宽度分级：记录/管理页收窄居中，重表格页稍宽（解决宽屏下的空旷感） */
function ContentShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const narrow = loc.pathname.startsWith('/orders') || loc.pathname.startsWith('/settings');
  return (
    <Content style={{ padding: 24, maxWidth: narrow ? 960 : 1140, margin: '0 auto', width: '100%' }}>
      {children}
    </Content>
  );
}

function SideMenu() {  const nav = useNavigate();
  const loc = useLocation();
  const selected = loc.pathname.startsWith('/orders')
    ? '/orders'
    : loc.pathname.startsWith('/analysis') ? '/analysis'
    : loc.pathname.startsWith('/settings') ? '/settings' : '/';
  return (
    <Menu
      mode="inline"
      selectedKeys={[selected]}
      onClick={(e) => nav(e.key)}
      items={[
        { key: '/', icon: <FileTextOutlined />, label: '预算清单' },
        { key: '/analysis', icon: <BarChartOutlined />, label: '分析' },
        { key: '/orders', icon: <OrderedListOutlined />, label: '订单' },
        { key: '/settings', icon: <SettingOutlined />, label: '设置' },
      ]}
    />
  );
}

/** 路由分发：打印视图游离于移动/桌面布局之外（无侧边栏、无 TabBar），其余走常规布局。
 *  路由是单棵树（不再按 isMobile 分成两套）：断点翻转（旋转/折叠屏跨 768px）时
 *  React 按相同路径复用组件实例——/record 填到一半的表单、已选票据不再被整树
 *  卸载重定向；仅「/」与「/items」按端选组件（首页两端本就是不同页面，/items
 *  桌面无对应页，重定向仅丢搜索词，可接受） */
function AppRoutes({ isMobile }: { isMobile: boolean }) {
  const location = useLocation();
  if (location.pathname.startsWith('/print/')) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/print/section/:id" element={<PrintSection />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    );
  }
  const routes = (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={isMobile ? <MobileHome /> : <Plan />} />
        <Route path="/items" element={isMobile ? <MobileItems /> : <Navigate to="/" replace />} />
        <Route path="/record" element={<MobileRecord />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
  return (
    <>
      {isMobile ? (
            /* ============ 移动布局：顶部标题栏 + 内容 + 底部 TabBar ============ */
            <div style={{ minHeight: '100vh', background: 'var(--bg-linen)' }}>
              <header
                className="no-print"
                style={{
                  position: 'sticky', top: 0, zIndex: 90,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 16px',
                  paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
                  background: 'var(--bg-linen)',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 650, letterSpacing: '0.05em' }}>🏠 装修账本</span>
                <Link to="/settings" aria-label="设置">
                  <Button type="text" size="small" icon={<SettingOutlined />} />
                </Link>
              </header>
              <main style={{ padding: 12, paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))' }}>
                {routes}
              </main>
              <MobileTabBar />
            </div>
          ) : (
          /* ============ 桌面布局：亚麻侧栏（sticky） ============ */
          <Layout style={{ minHeight: '100vh', background: 'var(--bg-linen)' }}>
            <Sider
              breakpoint="md"
              collapsedWidth="0"
              width={176}
              theme="light"
              style={{
                position: 'sticky',
                top: 0,
                height: '100vh',
                maxHeight: '100vh',
                alignSelf: 'flex-start',
                overflow: 'auto',
                background: 'var(--bg-linen)',
                borderRight: '1px solid var(--line)',
              }}
            >
              <div
                style={{
                  padding: '22px 16px 16px',
                  fontSize: 16,
                  fontWeight: 650,
                  letterSpacing: '0.06em',
                  color: 'var(--ink)',
                }}
              >
                🏠 装修账本
              </div>
              <SideMenu />
            </Sider>
            <Layout style={{ background: 'transparent' }}>
              <ContentShell>
                {routes}
              </ContentShell>
            </Layout>
          </Layout>
          )}
    </>
  );
}

export default function App() {
  const { mode, isDark, setMode } = useThemeMode();
  const isMobile = useIsMobile();

  return (
    <ThemeModeContext.Provider value={{ mode, isDark, setMode }}>
      <ConfigProvider locale={zhCN} theme={woodTheme(isDark)}>
        <BrowserRouter>
          <AppRoutes isMobile={isMobile} />
        </BrowserRouter>
        <Toaster
          position="top-center"
          theme={isDark ? 'dark' : 'light'}
          toastOptions={{
            style: {
              background: 'var(--surface)',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
              fontFamily: 'inherit',
            },
          }}
        />
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

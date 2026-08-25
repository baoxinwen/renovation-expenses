import { createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { ConfigProvider, Layout, Menu } from 'antd';
import { BarChartOutlined, FileTextOutlined, OrderedListOutlined, SettingOutlined } from '@ant-design/icons';
import { Toaster } from 'sonner';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import { woodTheme } from './styles/theme';
import { useThemeMode, type ThemeMode } from './hooks/useThemeMode';
import Plan from './pages/Plan';
import Analysis from './pages/Analysis';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Settings from './pages/Settings';

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

function SideMenu() {
  const nav = useNavigate();
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

export default function App() {
  const { mode, isDark, setMode } = useThemeMode();

  return (
    <ThemeModeContext.Provider value={{ mode, isDark, setMode }}>
      <ConfigProvider locale={zhCN} theme={woodTheme(isDark)}>
        <BrowserRouter>
          <Layout style={{ minHeight: '100vh', background: 'var(--bg-linen)' }}>
            {/* 亚麻浅色侧栏，sticky 固定不随内容滚动 */}
            <Sider
              breakpoint="lg"
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
              <div
                className="label-caption"
                style={{ position: 'absolute', bottom: 16, left: 24, fontSize: 11 }}
              >
                数据在本机 · 离线可用
              </div>
            </Sider>
            <Layout style={{ background: 'transparent' }}>
              <Content style={{ padding: 24, maxWidth: 1440, margin: '0 auto', width: '100%' }}>
                <Routes>
                  <Route path="/" element={<Plan />} />
                  <Route path="/analysis" element={<Analysis />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/orders/:id" element={<OrderDetail />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Content>
            </Layout>
          </Layout>
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

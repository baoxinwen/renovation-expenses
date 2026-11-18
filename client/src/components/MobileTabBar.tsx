import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChartOutlined, FileTextOutlined, HomeOutlined, ProfileOutlined,
} from '@ant-design/icons';

// 四栏：首页 / 清单 / 订单 / 分析（记账回归语境入口，不再设独立「记」页）
const TABS = [
  { key: '/', icon: HomeOutlined, label: '首页' },
  { key: '/items', icon: FileTextOutlined, label: '清单' },
  { key: '/orders', icon: ProfileOutlined, label: '订单' },
  { key: '/analysis', icon: BarChartOutlined, label: '分析' },
];

/** 移动端底部导航（含 iOS 安全区适配） */
export default function MobileTabBar() {
  const nav = useNavigate();
  const loc = useLocation();
  // '/' 精确匹配，其余前缀匹配——避免任何路径都命中首页；
  // 都不匹配（如 /settings 子页）时不高亮任何 tab
  const active = loc.pathname === '/'
    ? '/'
    : TABS.filter((t) => t.key !== '/').find((t) => loc.pathname.startsWith(t.key))?.key ?? '';

  return (
    <nav
      className="no-print"
      style={{
        position: 'fixed',
        left: 0, right: 0, bottom: 0,
        zIndex: 100,
        display: 'flex',
        background: 'var(--surface)',
        borderTop: '1px solid var(--line)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: '0 -2px 12px rgba(43,38,34,0.06)',
      }}
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            aria-label={t.label}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => nav(t.key)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 2, minHeight: 56, border: 'none', background: 'transparent',
              color: isActive ? 'var(--wood-600)' : 'var(--ink-3)',
              cursor: 'pointer', fontWeight: isActive ? 600 : 400,
            }}
          >
            <Icon style={{ fontSize: 20 }} />
            <span style={{ fontSize: 11 }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

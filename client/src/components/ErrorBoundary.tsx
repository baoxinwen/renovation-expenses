import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 全局错误边界：React 渲染崩溃时给出友好提示而不是白屏 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('界面崩溃:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: 'var(--bg-linen)',
            color: 'var(--ink)',
            fontFamily: 'inherit',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40 }}>🏠💨</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>页面出了点问题</div>
          <div style={{ color: '#6b6259', fontSize: 13, maxWidth: 420 }}>
            界面遇到错误停止了，但你的账目数据没有受影响。刷新通常能解决；
            如果反复出现，请把下面的错误信息反馈给开发者。
          </div>
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12,
              color: 'var(--clay)',
              maxWidth: 480,
              wordBreak: 'break-all',
            }}
          >
            {this.state.error.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '8px 24px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--wood-600)',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

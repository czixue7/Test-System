import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 路由级错误兜底：懒加载 chunk 失败或页面渲染抛错时，避免出现“点了没反应/白屏”，
 * 直接展示错误信息，便于在手机上定位问题。
 */
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-base font-semibold text-gray-800 dark:text-white mb-2">页面加载失败</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 break-all mb-6">{error.message || String(error)}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg">
              重新加载
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg">
              返回首页
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './ui-refinements.css';
import './update-stages.css';
import './debug-console.css';
import { useThemeStore } from './store/themeStore';
import { initVConsoleOnStartup } from './utils/vconsoleManager';

// 初始化副作用：都不允许因为异常而阻断应用启动
// 控制台初始化失败也不阻断应用。
initVConsoleOnStartup().catch((err) => {
  console.warn('[vconsole] 初始化失败:', err);
});

try {
  useThemeStore.getState().initTheme();
} catch (err) {
  console.warn('[theme] 初始化主题失败，使用默认值:', err);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('找不到 #root 挂载节点，index.html 可能已损坏');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import React from 'react';

const features = [
  { name: '练习', detail: '模拟测试', icon: 'M4 5h6a3 3 0 0 1 3 3v12a3 3 0 0 0-3-3H4V5Zm9 3a3 3 0 0 1 3-3h4v12h-4a3 3 0 0 0-3 3' },
  { name: '错题', detail: 'AI 判题', icon: 'M9 4H5v16h14V4h-4M9 3h6v4H9V3Zm0 11 2 2 4-5' },
  { name: '知识库', detail: '智能问答', icon: 'M4 4h16v12H9l-5 4V4Zm4 5h8M8 12h5' },
  { name: '值班表', detail: '人员调换', icon: 'M4 6h16v14H4V6Zm3-3v6m10-6v6M4 11h16M8 15h2m4 0h2' },
];

function AboutAppCard({ version, build, compact = false }: { version: string; build: string; compact?: boolean }) {
  return <section className={`im-about-card about-app-card rounded-2xl bg-white/70 dark:bg-gray-800/70 border border-gray-200/60 dark:border-gray-700/60 ${compact ? 'about-app-card--compact' : ''}`} aria-label="应用介绍">
    <div className="about-app-layout">
      <div className="about-app-header">
        <div className="about-app-icon bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
          <svg width="30" height="30" className="text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 12 2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
        </div>
        <h2 className="font-bold text-gray-800 dark:text-white">答题测试库</h2>
        <p className="about-app-version text-gray-500 dark:text-gray-400">版本 {version}</p>
        <p className="about-app-build text-gray-400 dark:text-gray-500">构建 {build}</p>
      </div>
      <div className="about-app-description text-gray-600 dark:text-gray-300">
        <p className="about-app-description-title">学习与值班助手</p>
        <ul className="about-app-features">{features.map(feature => <li key={feature.name}>
          <svg className="about-app-feature-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={feature.icon} /></svg>
          <span className="about-app-feature-text"><span>{feature.name}</span><span><span className="about-app-feature-separator" aria-hidden="true">· </span>{feature.detail}</span></span>
        </li>)}</ul>
      </div>
    </div>
    <footer className="about-app-links border-t border-gray-200 dark:border-gray-700">
      <a href="https://gitee.com/zixue7/Test-System" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm6 6v3h-7a2 2 0 0 0-2 2v4h4a2 2 0 0 0 2-2h-4v-3h7v3a5 5 0 0 1-5 5H6v-7a5 5 0 0 1 5-5h7Z" /></svg>Gitee
      </a>
      <span className="text-gray-300 dark:text-gray-600" aria-hidden="true">|</span>
      <a href="https://github.com/czixue7/Test-System" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.57 9.57 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.69-4.57 4.94.36.31.68.92.68 1.86v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" /></svg>GitHub
      </a>
    </footer>
  </section>;
}

export default React.memo(AboutAppCard);

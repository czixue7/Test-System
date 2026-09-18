import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useThemeStore, Theme, ThemeStyle } from '../store/themeStore';
import { useSafeArea } from '../hooks/useSafeArea';
import Modal from '../components/Modal';
import { CURRENT_VERSION_HASH } from '../utils/updater';
import { useUpdaterStore } from '../store/updaterStore';

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const { theme, setTheme, themeStyle } = useThemeStore();
  const safeArea = useSafeArea();
  const updater = useUpdaterStore();

  // 日志容器引用，用于自动滚动
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // 日志自动滚动到底部
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [updater.logs]);

  const openAboutModal = () => {
    setShowAboutModal(true);
  };
  const openThemeModal = () => {
    setShowThemeModal(true);
  };

  const closeModal = (modal: 'about' | 'theme') => {
    if (modal === 'about') {
      setShowAboutModal(false);
      // 注意：不重置更新状态，全局保留（检查中/下载中/日志等）
    } else {
      setShowThemeModal(false);
    }
  };

  const currentVersion = '0.4.1';







  // 日志级别样式（按消息内容自动归类）
  const logStyle = (msg: string) => {
    if (/❌|失败|错误/.test(msg)) return { dot: 'bg-red-500', color: 'text-red-500 dark:text-red-400' };
    if (/⚠️|警告/.test(msg)) return { dot: 'bg-amber-500', color: 'text-amber-600 dark:text-amber-400' };
    if (/✅|完成|成功|已是最新/.test(msg)) return { dot: 'bg-emerald-500', color: 'text-emerald-600 dark:text-emerald-400' };
    return { dot: 'bg-blue-400', color: 'text-gray-600 dark:text-gray-300' };
  };

  const themeModeLabel = theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色';
  const themeStyleLabel = themeStyle === 'immersive' ? '沉浸式' : '经典';

  const menuItems = [
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      title: '设置',
      onClick: () => navigate('/settings')
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      ),
      title: '主题',
      value: `${themeStyleLabel} · ${themeModeLabel}`,
      onClick: () => openThemeModal()
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      title: '题库管理',
      onClick: () => navigate('/manage-banks')
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      title: '测试记录',
      onClick: () => navigate('/records')
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      title: '关于',
      onClick: () => openAboutModal()
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
      <header
        className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="relative max-w-lg mx-auto px-4 h-12 flex items-center justify-between">
          <div className="w-8 h-8" />
          <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold pointer-events-none">我的</h1>
          <div className="w-8 h-8" />
        </div>
      </header>

      <div
        className="max-w-lg mx-auto px-4 py-4 pb-24"
        style={{ paddingTop: safeArea.top + 48 }}
      >
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden">
          {menuItems.map((item, index) => (
            <div
              key={item.title}
              onClick={item.onClick}
              className={`flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                index > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="text-blue-500 dark:text-blue-400">
                  {item.icon}
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{item.title}</span>
              </div>
              <div className="flex items-center gap-2">
                {item.value && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">{item.value}</span>
                )}
                <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>

      <nav
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg"
        style={{ paddingBottom: safeArea.bottom }}
      >
        <div className="max-w-lg mx-auto flex justify-around py-0.5">
          <Link
            to="/"
            className="flex flex-col items-center py-1 px-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="text-xs mt-0.5">首页</span>
          </Link>
          <Link
            to="/duty"
            className="flex flex-col items-center py-1 px-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs mt-0.5">值班表</span>
          </Link>
          <Link
            to="/placeholder"
            className="flex flex-col items-center py-1 px-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
            <span className="text-xs mt-0.5">知识库</span>
          </Link>
          <Link
            to="/profile"
            className="flex flex-col items-center py-1 px-4 text-blue-600 dark:text-blue-400"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-xs mt-0.5 font-medium">我的</span>
          </Link>
        </div>
      </nav>

      <Modal open={showAboutModal} onClose={() => closeModal('about')} className="rounded-2xl p-5 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="text-center">
              <div className="im-about-card rounded-2xl p-4 mb-4 bg-white/70 dark:bg-gray-800/70 border border-gray-200/60 dark:border-gray-700/60">
                <div className="w-16 h-16 mx-auto mb-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-1">答题测试库</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">版本 {currentVersion}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">构建 {CURRENT_VERSION_HASH}</p>
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 text-left">
                  <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1.5">
                    <p>一款帮助用户学习和备考的应用</p>
                    <p>支持题库管理、模拟测试、错题回顾等功能</p>
                    <p>支持 AI 智能判题</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-center gap-4">
                    <a
                      href="https://gitee.com/zixue7/Test-System"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline flex items-center justify-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path fillRule="evenodd" clipRule="evenodd" d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.266.592.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.266.592.593.592h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.592.592 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H5.926a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h8.296Z" />
                      </svg>
                      Gitee
                    </a>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <a
                      href="https://github.com/czixue7/Test-System"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline flex items-center justify-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                      </svg>
                      GitHub
                    </a>
                  </div>
                </div>
              </div>

              {/* 日志显示区域 */}
              {updater.logs.length > 0 && (
                <div className="im-log-panel mb-4 rounded-xl p-3 text-left bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200/60 dark:border-gray-700/60">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 tracking-wide">
                      调试日志
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-900/5 dark:bg-white/10 text-gray-400 dark:text-gray-500">
                      {updater.logs.length} 条
                    </span>
                  </div>
                  <div
                    ref={logsContainerRef}
                    className="max-h-44 overflow-y-auto text-[11px] font-mono space-y-1.5 scroll-smooth pr-1"
                  >
                    {updater.logs.map((log, index) => {
                      const m = log.match(/^\[(.*?)\] (.*)$/);
                      const time = m?.[1] ?? '';
                      const msg = m?.[2] ?? log;
                      const st = logStyle(msg);
                      return (
                        <div key={index} className="flex items-start gap-1.5 leading-relaxed">
                          <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                          <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{time}</span>
                          <span className={`break-all ${st.color}`}>{msg}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mb-4">
                {updater.downloadStatus === 'downloading' ? (
                  <div className="w-full py-2.5 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg font-medium flex items-center gap-2 overflow-hidden">
                    <div className="flex-1 flex items-center gap-2 px-3">
                      <div className="flex-1 h-2 bg-white/30 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-white transition-all duration-300"
                          style={{ width: `${updater.downloadProgress.percentage}%` }}
                        />
                      </div>
                      <span className="text-sm whitespace-nowrap">{updater.downloadProgress.percentage.toFixed(0)}%</span>
                    </div>
                    <button
                      onClick={updater.cancelDownload}
                      className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-r-lg text-sm transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : updater.downloadStatus === 'downloaded' ? (
                  <button
                    onClick={updater.installUpdate}
                    className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    点击安装
                  </button>
                ) : updater.downloadStatus === 'installing' ? (
                  <div className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    正在启动安装...
                  </div>
                ) : (
                  <button
                    onClick={updater.updateInfo?.hasUpdate ? updater.startDownload : updater.checkForUpdate}
                    disabled={updater.checkingUpdate}
                    className={`w-full py-2.5 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                      updater.updateInfo?.hasUpdate
                        ? 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700'
                        : updater.updateInfo?.error
                        ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700'
                        : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
                    }`}
                  >
                    <svg className={`w-4 h-4 ${updater.checkingUpdate ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {updater.checkingUpdate ? '检查中...' : updater.updateInfo?.hasUpdate ? '立即更新' : updater.updateInfo?.error ? '检查失败，点击重试' : updater.updateInfo ? '当前已是最新版本' : '检查更新'}
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={() => closeModal('about')}
              className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all"
            >
              确定
            </button>
      </Modal>

      <Modal open={showThemeModal} onClose={() => closeModal('theme')} className="rounded-2xl p-5 w-full max-w-sm">
            <div className="text-center mb-4">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">选择主题</h2>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 text-left">深浅色</p>
            <div className="space-y-2">
              {[
                { value: 'system' as Theme, label: '跟随系统', desc: '随手机系统自动切换' },
                { value: 'light' as Theme, label: '浅色', desc: '始终使用浅色外观' },
                { value: 'dark' as Theme, label: '深色', desc: '始终使用深色外观' },
              ].map((option) => (
                <div
                  key={option.value}
                  onClick={() => setTheme(option.value)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all ${
                    theme === option.value
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500 dark:border-blue-400'
                      : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    theme === option.value ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {theme === option.value && (
                      <div className="w-3 h-3 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm font-medium ${theme === option.value ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}>
                      {option.label}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{option.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => closeModal('theme')}
              className="w-full mt-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
            >
              完成
            </button>
      </Modal>
    </div>
  );
};

export default Profile;


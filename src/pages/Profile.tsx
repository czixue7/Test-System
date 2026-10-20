import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useThemeStore, Theme, ThemeStyle } from '../store/themeStore';
import { useSafeArea } from '../hooks/useSafeArea';
import Modal from '../components/Modal';
import AboutUpdatePanel from '../components/AboutUpdatePanel';
import AboutAppCard from '../components/AboutAppCard';
import { CURRENT_VERSION_HASH } from '../utils/updater';
import { useUpdaterStore } from '../store/updaterStore';

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [updatePanelStarted, setUpdatePanelStarted] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const { theme, setTheme, themeStyle } = useThemeStore();
  const safeArea = useSafeArea();
  const updateActive = useUpdaterStore(state => state.checkingUpdate || state.downloadStatus !== 'idle');
  const showUpdatePanel = updatePanelStarted || updateActive;

  const openAboutModal = () => {
    setUpdatePanelStarted(false);
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

  const currentVersion = '0.4.4';

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
        <div className="relative max-w-lg mx-auto px-4 h-9 flex items-center justify-between">
          <div className="w-8 h-8" />
          <h1 className="absolute left-1/2 -translate-x-1/2 text-base font-semibold pointer-events-none">我的</h1>
          <div className="w-8 h-8" />
        </div>
      </header>

      <div
        className="max-w-lg mx-auto px-4 py-4 pb-24"
        style={{ paddingTop: safeArea.contentTop }}
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

      <Modal open={showAboutModal} onClose={() => closeModal('about')} className="about-dialog w-full max-w-sm" containerClassName="about-overlay">
        <div className="about-body text-center">
          <AboutAppCard version={currentVersion} build={CURRENT_VERSION_HASH} compact={showUpdatePanel} />
          <AboutUpdatePanel expanded={showUpdatePanel} onExpand={() => setUpdatePanelStarted(true)} />
        </div>
        <div className="about-actions">
          <button type="button" onClick={() => closeModal('about')} className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-colors">确定</button>
        </div>
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


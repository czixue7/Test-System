import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useThemeStore, Theme } from '../store/themeStore';
import { useSafeArea } from '../hooks/useSafeArea';
import { checkUpdate, downloadApk, installApk, isTauri, isAndroid, UpdateInfo, DownloadProgress, CURRENT_VERSION_HASH } from '../utils/updater';

type DownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'installing';

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [activeModal, setActiveModal] = useState<'about' | 'theme' | null>(null);
  const { theme, setTheme } = useThemeStore();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    downloaded: 0,
    total: 0,
    percentage: 0
  });
  const [downloadedFilePath, setDownloadedFilePath] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const safeArea = useSafeArea();

  // 日志容器引用，用于自动滚动
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // 添加日志
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    setLogs(prev => [...prev.slice(-49), logMessage]); // 保留最近50条日志
  };

  // 日志自动滚动到底部
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (showAboutModal || showThemeModal) {
      setIsClosing(false);
      setActiveModal(showAboutModal ? 'about' : 'theme');
      const timer = setTimeout(() => setModalVisible(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setModalVisible(false);
        setActiveModal(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [showAboutModal, showThemeModal]);

  const currentVersion = '0.3.7';

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateInfo(null);
    setDownloadStatus('idle');
    setDownloadProgress({ downloaded: 0, total: 0, percentage: 0 });
    setLogs([]);

    addLog('开始检查更新...');

    try {
      const info = await checkUpdate();
      setUpdateInfo(info);
      addLog(`检查结果: ${info.message}`);

      if (info.downloadUrl) {
        addLog(`下载链接: ${info.downloadUrl}`);
      }
    } catch (error) {
      addLog(`检查更新失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownload = async () => {
    if (!updateInfo?.downloadUrl) {
      addLog('错误: 没有可用的下载链接');
      return;
    }

    // 检查是否在 Tauri Android 环境
    if (!isTauri()) {
      addLog('错误: 不在 Tauri 环境中，无法使用原生下载');
      // 回退到浏览器下载
      window.open(updateInfo.downloadUrl, '_blank');
      return;
    }

    if (!isAndroid()) {
      addLog('错误: 不在 Android 环境中');
      // 回退到浏览器下载
      window.open(updateInfo.downloadUrl, '_blank');
      return;
    }

    setDownloadStatus('downloading');
    addLog('开始下载 APK...');

    try {
      const filename = `app-update-${updateInfo.latestVersion}.apk`;
      addLog(`文件名: ${filename}`);

      const filePath = await downloadApk(
        updateInfo.downloadUrl,
        filename,
        (progress) => {
          setDownloadProgress(progress);
          addLog(`下载进度: ${progress.percentage.toFixed(1)}%`);
        }
      );

      addLog(`下载完成: ${filePath}`);
      setDownloadedFilePath(filePath);
      setDownloadStatus('downloaded');
    } catch (error) {
      addLog(`下载失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setDownloadStatus('idle');
    }
  };

  const handleInstall = async () => {
    if (!downloadedFilePath) {
      addLog('错误: 没有下载好的文件');
      return;
    }

    // 检查是否在 Tauri Android 环境
    if (!isTauri()) {
      addLog('错误: 不在 Tauri 环境中');
      return;
    }

    if (!isAndroid()) {
      addLog('错误: 不在 Android 环境中');
      return;
    }

    setDownloadStatus('installing');
    addLog('开始安装 APK...');
    addLog(`文件路径: ${downloadedFilePath}`);

    try {
      const result = await installApk(downloadedFilePath);
      addLog(`安装结果: ${result}`);

      if (result === 'REQUEST_INSTALL_PERMISSION') {
        addLog('⚠️ 需要允许安装未知来源应用，已跳转系统设置');
        addLog('请在系统设置中允许后，返回应用再次点击安装');
      } else if (result === 'INSTALL_INTENT_SENT' || result.includes('已尝试打开') || result.includes('成功')) {
        addLog('✅ 系统安装器已启动，请查看系统界面');
      } else {
        addLog('⚠️ 自动安装可能未成功');
        addLog('请手动到下载目录中找到 APK 文件并点击安装');
        addLog(`文件位置: ${downloadedFilePath}`);
      }
    } catch (error) {
      addLog(`❌ 安装失败: ${error instanceof Error ? error.message : '未知错误'}`);
      addLog('请手动到下载目录中找到 APK 文件并点击安装');
      setDownloadStatus('downloaded');
    }
  };

  const handleCancelDownload = () => {
    addLog('用户取消下载');
    setDownloadStatus('idle');
    setDownloadProgress({ downloaded: 0, total: 0, percentage: 0 });
  };

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
      value: theme === 'light' ? '浅色' : '深色',
      onClick: () => setShowThemeModal(true)
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
      onClick: () => setShowAboutModal(true)
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
      <header
        className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="max-w-lg mx-auto px-4 pt-1 pb-1 flex items-center justify-between">
          <div className="w-8 h-8" />
          <h1 className="text-lg font-semibold">我的</h1>
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
            className="flex flex-col items-center py-1 px-6 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="text-xs mt-0.5">首页</span>
          </Link>
          <Link
            to="/profile"
            className="flex flex-col items-center py-1 px-6 text-blue-600 dark:text-blue-400"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-xs mt-0.5 font-medium">我的</span>
          </Link>
        </div>
      </nav>

      {(showAboutModal || (modalVisible && activeModal === 'about')) && (
        <div
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${isClosing ? 'bg-opacity-0' : 'bg-opacity-50'}`}
          onClick={() => { setShowAboutModal(false); setUpdateInfo(null); setDownloadStatus('idle'); setLogs([]); }}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl transform transition-all duration-300 ease-in-out max-h-[90vh] overflow-y-auto"
            style={{
              transform: isClosing || !modalVisible ? 'scale(0)' : 'scale(1)',
              opacity: isClosing || !modalVisible ? 0 : 1
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-1">答题测试库</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">版本 {currentVersion}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">构建 {CURRENT_VERSION_HASH}</p>
              <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1.5 mb-4">
                <p>一款帮助用户学习和备考的应用</p>
                <p>支持题库管理、模拟测试、错题回顾等功能</p>
                <p>支持 AI 智能判题（API 云端 / WebLLM 本地）</p>
                <div className="pt-2 mt-2 border-t border-gray-200 dark:border-gray-700">
                  <a
                    href="https://github.com/czixue7/Test-System"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline flex items-center justify-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                    </svg>
                    GitHub 开源地址
                  </a>
                </div>
              </div>

              {/* 日志显示区域 */}
              {logs.length > 0 && (
                <div className="mb-4 bg-gray-100 dark:bg-gray-700 rounded-lg p-3 text-left">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    调试日志 ({logs.length}条):
                  </div>
                  <div 
                    ref={logsContainerRef}
                    className="max-h-40 overflow-y-auto text-xs font-mono space-y-1 scroll-smooth"
                  >
                    {logs.map((log, index) => (
                      <div key={index} className="text-gray-600 dark:text-gray-300 break-all">
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-4">
                {downloadStatus === 'downloading' ? (
                  <div className="w-full py-2.5 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg font-medium flex items-center gap-2 overflow-hidden">
                    <div className="flex-1 flex items-center gap-2 px-3">
                      <div className="flex-1 h-2 bg-white/30 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-white transition-all duration-300"
                          style={{ width: `${downloadProgress.percentage}%` }}
                        />
                      </div>
                      <span className="text-sm whitespace-nowrap">{downloadProgress.percentage.toFixed(0)}%</span>
                    </div>
                    <button
                      onClick={handleCancelDownload}
                      className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-r-lg text-sm transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : downloadStatus === 'downloaded' ? (
                  <button
                    onClick={handleInstall}
                    className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    点击安装
                  </button>
                ) : downloadStatus === 'installing' ? (
                  <div className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-medium flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    正在启动安装...
                  </div>
                ) : (
                  <button
                    onClick={updateInfo?.hasUpdate ? handleDownload : handleCheckUpdate}
                    disabled={checkingUpdate}
                    className={`w-full py-2.5 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                      updateInfo?.hasUpdate
                        ? 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700'
                        : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
                    }`}
                  >
                    <svg className={`w-4 h-4 ${checkingUpdate ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {checkingUpdate ? '检查中...' : updateInfo?.hasUpdate ? '立即更新' : updateInfo && !updateInfo.hasUpdate ? '当前已是最新版本' : '检查更新'}
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={() => { setShowAboutModal(false); setUpdateInfo(null); setDownloadStatus('idle'); setLogs([]); }}
              className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all"
            >
              确定
            </button>
          </div>
        </div>
      )}

      {(showThemeModal || (modalVisible && activeModal === 'theme')) && (
        <div
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${isClosing ? 'bg-opacity-0' : 'bg-opacity-50'}`}
          onClick={() => setShowThemeModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl transform transition-all duration-300 ease-in-out"
            style={{
              transform: isClosing || !modalVisible ? 'scale(0)' : 'scale(1)',
              opacity: isClosing || !modalVisible ? 0 : 1
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">选择主题</h2>
            </div>
            <div className="space-y-2">
              {[
                {
                  value: 'light' as Theme,
                  label: '浅色',
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  )
                },
                {
                  value: 'dark' as Theme,
                  label: '深色',
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  )
                },
              ].map((option) => (
                <div
                  key={option.value}
                  onClick={() => {
                    setTheme(option.value);
                    setShowThemeModal(false);
                  }}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer transition-all ${
                    theme === option.value
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500 dark:border-blue-400'
                      : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`${theme === option.value ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}>
                      {option.icon}
                    </span>
                    <span className={`font-medium ${theme === option.value ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}>
                      {option.label}
                    </span>
                  </div>
                  {theme === option.value && (
                    <svg className="w-5 h-5 text-blue-500 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowThemeModal(false)}
              className="w-full mt-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;


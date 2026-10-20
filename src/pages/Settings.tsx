import Collapse from '../components/Collapse';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../store/settingsStore';
import AIProfileSettings from '../components/AIProfileSettings';
import DataSourceSettings from '../components/DataSourceSettings';
import { useToast } from '../hooks/useToast';
import { GradingProvider } from '../types';
import { initVConsole, destroyVConsole } from '../utils/vconsoleManager';
import { useSafeArea } from '../hooks/useSafeArea';

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { showSuccess } = useToast();
  const safeArea = useSafeArea();
  const {
    gradingMode,
    setGradingMode,
    gradingProvider,
    setGradingProvider,
    vconsoleEnabled,
    setVconsoleEnabled,
  } = useSettingsStore();
  const [gradingExpanded, setGradingExpanded] = useState(false);
  const [providerExpanded, setProviderExpanded] = useState(false);
  const getGradingModeLabel = () => {
    return gradingMode === 'fixed' ? '固定判断' : 'AI判断';
  };

  const handleSelectGradingMode = (mode: 'fixed' | 'ai') => {
    setGradingMode(mode);
    setGradingExpanded(false);
    if (mode === 'ai') {
      if (gradingProvider === 'fixed') {
        setGradingProvider('api');
      }
      showSuccess('已切换到 AI 判题模式', 3000);
    } else {
      setGradingProvider('fixed');
      showSuccess('已切换到固定判题模式', 3000);
    }
  };

  const handleSelectGradingProvider = (provider: GradingProvider) => {
    setGradingProvider(provider);
    if (provider === 'api') {
      showSuccess('已切换到 API 判题', 3000);
    } else {
      showSuccess('已切换到固定判题', 3000);
    }
  };

  const handleToggleGrading = () => {
    setGradingExpanded(!gradingExpanded);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
      <header
        className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="max-w-lg mx-auto px-4 h-9 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="w-8 h-8 flex items-center justify-center"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-semibold">设置</h1>
          <div className="w-8 h-8" />
        </div>
      </header>

      <div
        className="max-w-lg mx-auto px-4 py-4 space-y-3"
        style={{ paddingTop: safeArea.contentTop }}
      >
        <DataSourceSettings />
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden">
          <div
            onClick={handleToggleGrading}
            className="px-4 pt-3 cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">判题模式</span>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">{getGradingModeLabel()}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 pb-3">
              {gradingMode === 'fixed' ? '使用预设答案进行精确匹配' : '使用 AI 智能分析答案语义'}
            </p>
          </div>

          <Collapse open={gradingExpanded}>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 space-y-2">
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectGradingMode('fixed');
                }}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                  gradingMode === 'fixed'
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500'
                    : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  gradingMode === 'fixed' ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {gradingMode === 'fixed' && (
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                  )}
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">固定判断</span>
              </div>

              <div
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectGradingMode('ai');
                }}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                  gradingMode === 'ai'
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500'
                    : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  gradingMode === 'ai' ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {gradingMode === 'ai' && (
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                  )}
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">AI判断</span>
              </div>
            </div>
          </Collapse>
        </div>

        {gradingMode === 'ai' && (
          <>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden">
              <div
                onClick={() => setProviderExpanded(!providerExpanded)}
                className="px-4 py-3 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">判题方式</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {gradingProvider === 'api' ? 'API 云端判题' : '固定判题'}
                    </span>
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${providerExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
              <Collapse open={providerExpanded}>
                <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 space-y-2">
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectGradingProvider('api');
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                      gradingProvider === 'api'
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500'
                        : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      gradingProvider === 'api' ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600'
                    }`}>
                      {gradingProvider === 'api' && (
                        <div className="w-3 h-3 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">API 云端判题</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">通过 API 调用云端 AI 模型，无需本地资源</p>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-3 p-3 rounded-xl transition-all bg-gray-100 dark:bg-gray-700/50 border-2 border-transparent opacity-60 cursor-not-allowed"
                  >
                    <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center border-gray-300 dark:border-gray-600">
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">敬请期待</span>
                    </div>
                  </div>
                </div>
              </Collapse>
            </div>

            {gradingProvider === 'api' && <AIProfileSettings />}
          </>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden">
          {/* 「调试控制台」是**有意在设置里常驻**的开关（含桌面端），
              不要按环境隐藏它。历史上这里写的是 `{!isTauri() && ...}`，
              而当时 isTauri 恒为 false（用了 __TAURI__），所以它恰好总是显示；
              一旦把 isTauri 修成正确的 __TAURI_INTERNALS__，这个开关就会在
              打包后的桌面应用里消失 —— 那属于回归，不是修复。 */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">调试控制台</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={vconsoleEnabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setVconsoleEnabled(enabled);
                    if (enabled) {
                      initVConsole();
                      showSuccess('调试控制台已开启', 3000);
                    } else {
                      destroyVConsole();
                      showSuccess('调试控制台已关闭', 3000);
                    }
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              开启后可以在应用内查看调试日志和错误信息
            </p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Settings;

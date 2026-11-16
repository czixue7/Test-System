import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useQuestionBankStore } from './store/questionBankStore';
import { useRecordStore } from './store/recordStore';
import { useDutyScheduleStore } from './store/dutyScheduleStore';
import { autoLoadLastModel } from './utils/aiGrading';
import Toast from './components/Toast';
import DebugConsole from './components/DebugConsole';
import ErrorBoundary from './components/ErrorBoundary';
import AboutDialog from './components/AboutDialog';
import { useUpdaterStore } from './store/updaterStore';

const Home = lazy(() => import('./pages/Home'));
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/Settings'));
const Practice = lazy(() => import('./pages/Practice'));
const Exam = lazy(() => import('./pages/Exam'));
const Result = lazy(() => import('./pages/Result'));
const Records = lazy(() => import('./pages/Records'));
const Import = lazy(() => import('./pages/Import'));
const DownloadBanks = lazy(() => import('./pages/DownloadBanks'));
const ManageBanks = lazy(() => import('./pages/ManageBanks'));
const DutySchedule = lazy(() => import('./pages/DutySchedule'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const KnowledgeItemView = lazy(() => import('./pages/KnowledgeItemView'));

const App: React.FC = () => {
  const { loadBanks } = useQuestionBankStore();
  const { loadRecords } = useRecordStore();
  const { loadDuties } = useDutyScheduleStore();
  const [initializing, setInitializing] = useState(true);
  const [autoUpdateOpen, setAutoUpdateOpen] = useState(false);
  const checkForUpdate = useUpdaterStore(state => state.checkForUpdate);
  const updateInfo = useUpdaterStore(state => state.updateInfo);
  const promptedRef = React.useRef('');

  useEffect(() => {
    const init = async () => {
      try {
        // 设置最大加载时间，避免加载过久
        const maxWaitTime = new Promise(resolve => setTimeout(resolve, 3000));

        // 并行加载数据，但设置超时
        const loadData = Promise.all([
          loadBanks().catch(err => console.error('加载题库失败:', err)),
          loadRecords().catch(err => console.error('加载记录失败:', err)),
          loadDuties().catch(err => console.error('加载值班表失败:', err))
        ]);

        // 等待数据加载或超时（最多3秒）
        await Promise.race([loadData, maxWaitTime]);
        
        // 自动加载上次使用的 AI 模型（在后台静默加载，不阻塞应用启动）
        setTimeout(() => {
          console.log('[App] 尝试自动加载上次使用的 AI 模型...');
          autoLoadLastModel().catch(error => {
            console.log('[App] 自动加载模型失败:', error);
          });
        }, 100);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setInitializing(false);
      }
    };
    init();
  }, [loadBanks, loadRecords, loadDuties]);

  // 进入应用后自动检测一次更新，有可用更新才弹出「关于」弹窗
  useEffect(() => {
    if (initializing) return;
    const timer = setTimeout(() => {
      void checkForUpdate();
    }, 800);
    return () => clearTimeout(timer);
  }, [initializing, checkForUpdate]);

  useEffect(() => {
    if (!updateInfo?.hasUpdate) return;
    const key = `${updateInfo.latestVersion}-${updateInfo.versionHash || ''}`;
    if (promptedRef.current === key) return;
    promptedRef.current = key;
    setAutoUpdateOpen(true);
  }, [updateInfo]);

  if (initializing) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toast />
      <DebugConsole />
      <BrowserRouter
        future={{
          // 关闭 transition 包裹：页面 chunk 加载期间先显示加载态，
          // 否则懒加载失败/变慢时点击导航会“没有任何反应”
          v7_startTransition: false,
          v7_relativeSplatPath: true,
        }}
      >
        <ErrorBoundary>
        <Suspense fallback={
          <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        }>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/practice/:bankId/:mode" element={<Practice />} />
            <Route path="/exam/:bankId" element={<Exam />} />
            <Route path="/result/:id" element={<Result />} />
            <Route path="/records" element={<Records />} />
            <Route path="/import" element={<Import />} />
            <Route path="/download-banks" element={<DownloadBanks />} />
            <Route path="/manage-banks" element={<ManageBanks />} />
            <Route path="/duty" element={<DutySchedule />} />
            <Route path="/placeholder" element={<KnowledgeBase />} />
            <Route path="/knowledge-item/:id" element={<KnowledgeItemView />} />
            {/* 兜底路由：地址不匹配时也给提示，避免整页空白看不出原因 */}
            <Route path="*" element={
              <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">页面不存在或地址有误</p>
                <button
                  onClick={() => { window.location.href = '/'; }}
                  className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg">
                  返回首页
                </button>
              </div>
            } />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
      <AboutDialog open={autoUpdateOpen} onClose={() => setAutoUpdateOpen(false)} autoExpand />
    </>
  );
};

export default App;

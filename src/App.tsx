import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useQuestionBankStore } from './store/questionBankStore';
import { useRecordStore } from './store/recordStore';
import { autoLoadLastModel } from './utils/aiGrading';
import Toast from './components/Toast';

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

const App: React.FC = () => {
  const { loadBanks } = useQuestionBankStore();
  const { loadRecords } = useRecordStore();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        // 设置最大加载时间，避免加载过久
        const maxWaitTime = new Promise(resolve => setTimeout(resolve, 3000));
        
        // 并行加载数据，但设置超时
        const loadData = Promise.all([
          loadBanks().catch(err => console.error('加载题库失败:', err)),
          loadRecords().catch(err => console.error('加载记录失败:', err))
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
  }, [loadBanks, loadRecords]);

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
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
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
          </Routes>
        </Suspense>
      </BrowserRouter>
    </>
  );
};

export default App;

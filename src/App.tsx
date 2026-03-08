import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useQuestionBankStore } from './store/questionBankStore';
import { useRecordStore } from './store/recordStore';

const Home = lazy(() => import('./pages/Home'));
const Profile = lazy(() => import('./pages/Profile'));
const Practice = lazy(() => import('./pages/Practice'));
const Exam = lazy(() => import('./pages/Exam'));
const Result = lazy(() => import('./pages/Result'));
const Records = lazy(() => import('./pages/Records'));
const Import = lazy(() => import('./pages/Import'));

const App: React.FC = () => {
  const { loadBanks } = useQuestionBankStore();
  const { loadRecords } = useRecordStore();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([loadBanks(), loadRecords()]);
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
    <BrowserRouter>
      <Suspense fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      }>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/practice/:bankId/:mode" element={<Practice />} />
          <Route path="/exam/:bankId" element={<Exam />} />
          <Route path="/result/:id" element={<Result />} />
          <Route path="/records" element={<Records />} />
          <Route path="/import" element={<Import />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;

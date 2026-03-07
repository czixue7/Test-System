import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useQuestionBankStore } from './store/questionBankStore';
import { useRecordStore } from './store/recordStore';

const Home = lazy(() => import('./pages/Home'));
const QuestionBankDetail = lazy(() => import('./pages/QuestionBankDetail'));
const Exam = lazy(() => import('./pages/Exam'));
const Result = lazy(() => import('./pages/Result'));
const Records = lazy(() => import('./pages/Records'));
const Import = lazy(() => import('./pages/Import'));

const PageLoader: React.FC = () => (
  <div className="page-loading-fallback">
    <div className="page-loading-spinner"></div>
    <p className="text-gray-500 mt-4">加载中...</p>
  </div>
);

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
    return <PageLoader />;
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bank/:id" element={<QuestionBankDetail />} />
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

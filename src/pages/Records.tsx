import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRecordStore } from '../store/recordStore';
import ConfirmModal from '../components/ConfirmModal';
import { useSafeArea } from '../hooks/useSafeArea';

const Records: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { records, deleteRecord, clearRecords } = useRecordStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const safeArea = useSafeArea();

  const handleGoBack = () => {
    if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
      <header 
        className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="max-w-lg mx-auto px-4 pt-1 pb-1 flex items-center justify-between">
          <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-semibold">测试记录</h1>
          <button onClick={() => setShowClearConfirm(true)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </header>

      <div 
        className="max-w-lg mx-auto px-4 py-4 pb-24"
        style={{ paddingTop: safeArea.top + 48 }}
      >
        {records.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-8 text-center">
            <svg className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            <p className="text-gray-500 dark:text-gray-400">暂无测试记录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {records.map((record) => {
              const correctCount = record.answers.filter(a => a.isCorrect).length;
              const wrongCount = record.answers.filter(a => !a.isCorrect && a.answer !== '' && (!Array.isArray(a.answer) || a.answer.length > 0)).length;
              
              return (
                <div key={record.id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-4">
                  <div className="flex justify-between items-center">
                    <div className="flex-1 cursor-pointer" onClick={() => navigate(`/result/${record.id}`)}>
                      <div className="font-medium text-gray-800 dark:text-gray-200">{record.bankName || record.examName}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{new Date(record.finishedAt || record.submittedAt).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-bold text-blue-600 dark:text-blue-400">{record.percentage ?? Math.round((record.score / record.totalScore) * 100)}%</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{Math.floor((record.duration ?? record.timeSpent) / 60)}:{((record.duration ?? record.timeSpent) % 60).toString().padStart(2, '0')}</div>
                        <div className="text-xs mt-1">
                          <span className="text-green-600 dark:text-green-400">{correctCount}对</span>
                          <span className="text-gray-300 dark:text-gray-600 mx-1">·</span>
                          <span className="text-red-600 dark:text-red-400">{wrongCount}错</span>
                        </div>
                      </div>
                      <button onClick={async () => { await deleteRecord(record.id); }} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {records.length > 0 && (
        <div 
          className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4"
          style={{ paddingBottom: safeArea.bottom }}
        >
          <div className="max-w-lg mx-auto">
            <button onClick={() => setShowClearConfirm(true)} className="w-full py-2.5 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors">清空所有记录</button>
          </div>
        </div>
      )}

      {showClearConfirm && (
        <ConfirmModal
          message="确定要清空所有记录吗？此操作不可恢复。"
          onConfirm={async () => { await clearRecords(); setShowClearConfirm(false); }}
          onCancel={() => setShowClearConfirm(false)}
          confirmText="清空"
          cancelText="取消"
          type="danger"
        />
      )}
    </div>
  );
};

export default Records;

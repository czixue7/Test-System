import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { useThemeStore } from '../store/themeStore';
import { isBuiltInBank } from '../utils/builtInBanks';
import { Question } from '../types';
import { useSafeArea } from '../hooks/useSafeArea';

const STORAGE_KEY_CURRENT_BANK = 'current-bank-id';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { banks } = useQuestionBankStore();
  const { initTheme } = useThemeStore();
  const safeArea = useSafeArea();

  const [showAddModal, setShowAddModal] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [currentBankId, setCurrentBankId] = useState<string | null>(null);
  const [isBankListExpanded, setIsBankListExpanded] = useState(false);
  const [wrongQuestions, setWrongQuestions] = useState<Question[]>([]);
  const [favoriteQuestions, setFavoriteQuestions] = useState<Question[]>([]);
  const [commonQuestions, setCommonQuestions] = useState<Question[]>([]);

  useEffect(() => {
    if (showAddModal) {
      setIsClosing(false);
      const timer = setTimeout(() => setModalVisible(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsClosing(true);
      const timer = setTimeout(() => setModalVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [showAddModal]);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    const storedBankId = localStorage.getItem(STORAGE_KEY_CURRENT_BANK);
    if (storedBankId && banks.some(b => b.id === storedBankId)) {
      setCurrentBankId(storedBankId);
    } else if (banks.length > 0) {
      setCurrentBankId(banks[0].id);
      localStorage.setItem(STORAGE_KEY_CURRENT_BANK, banks[0].id);
    }
  }, [banks]);

  useEffect(() => {
    const stored = localStorage.getItem('practice-data-global');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setWrongQuestions(data.wrongQuestions || []);
        setFavoriteQuestions(data.favoriteQuestions || []);
        setCommonQuestions(data.commonQuestions || []);
      } catch {
        setWrongQuestions([]);
        setFavoriteQuestions([]);
        setCommonQuestions([]);
      }
    } else {
      setWrongQuestions([]);
      setFavoriteQuestions([]);
      setCommonQuestions([]);
    }
  }, []);

  const currentBank = banks.find(b => b.id === currentBankId);
  const totalQuestions = banks.reduce((sum, bank) => sum + bank.questions.length, 0);

  const handleSelectBank = (bankId: string) => {
    setCurrentBankId(bankId);
    localStorage.setItem(STORAGE_KEY_CURRENT_BANK, bankId);
    setIsBankListExpanded(false);
  };



  const handleStartPractice = (mode: string) => {
    if (!currentBank || currentBank.questions.length === 0) return;
    if (mode === 'wrong' && wrongQuestions.length === 0) return;
    if (mode === 'favorites' && favoriteQuestions.length === 0) return;
    if (mode === 'common' && commonQuestions.length === 0) return;
    navigate(`/practice/${currentBank.id}/${mode}`);
  };

  const handleStartExam = () => {
    if (!currentBank || currentBank.questions.length === 0) return;
    navigate(`/exam/${currentBank.id}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
      <header 
        className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="max-w-lg mx-auto px-4 pt-1 pb-1 flex items-center justify-between">
          <div className="w-8 h-8" />
          <h1 className="text-lg font-semibold">学习</h1>
          <button onClick={() => setShowAddModal(true)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          </button>
        </div>
      </header>

      <div 
        className="max-w-lg mx-auto px-4 py-4 pb-24"
        style={{ paddingTop: safeArea.top + 48 }}
      >
        {currentBank && (
          <div className="bg-white rounded-2xl shadow-md mb-6 border border-gray-100 relative dark:bg-gray-800 dark:border-gray-700">
            <div className="p-4 cursor-pointer" onClick={() => banks.length > 1 && setIsBankListExpanded(!isBankListExpanded)}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-gray-800 dark:text-white truncate">{currentBank.name}</h3>
                  {currentBank.description && <p className="text-xs text-gray-500 mt-1 dark:text-gray-400 break-words">{currentBank.description}</p>}
                </div>
                <div className="flex flex-col items-center gap-1 flex-shrink-0 -mt-2">
                  {isBuiltInBank(currentBank.id) && <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-full dark:bg-blue-900 dark:text-blue-300">内置</span>}
                  {banks.length > 1 && <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isBankListExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>}
                </div>
              </div>
            </div>
            {isBankListExpanded && banks.length > 1 && (
              <div className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-lg z-10 rounded-2xl" onWheel={(e) => e.stopPropagation()}>
                {banks.map((bank) => (
                  <button key={bank.id} onClick={() => handleSelectBank(bank.id)} className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-colors ${currentBankId === bank.id ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' : 'hover:bg-gray-50 text-gray-700 dark:hover:bg-gray-700 dark:text-gray-300'}`}>
                    {currentBankId === bank.id && <svg className="w-5 h-5 text-blue-500 dark:text-blue-300 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    <span className="font-medium flex-1 truncate">{bank.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm text-gray-400">{bank.questions.length} 题</span>
                      {isBuiltInBank(bank.id) && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 text-xs rounded dark:bg-blue-900 dark:text-blue-300">内置</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!currentBank && banks.length === 0 && (
          <div className="bg-white rounded-2xl shadow-md p-6 mb-6 text-center border border-gray-100 dark:bg-gray-800 dark:border-gray-700">
            <svg className="w-12 h-12 mx-auto text-gray-300 mb-3 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            <p className="text-gray-500 mb-3 dark:text-gray-400">暂无题库</p>
            <button onClick={() => setShowAddModal(true)} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors dark:bg-blue-600 dark:hover:bg-blue-700">添加题库</button>
          </div>
        )}

        {currentBank && (
          <div className="relative flex items-center justify-center py-8">
            <button onClick={() => handleStartPractice('sequential')} disabled={currentBank.questions.length === 0} className="w-32 h-32 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-full shadow-lg flex flex-col items-center justify-center hover:from-blue-600 hover:to-blue-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed dark:from-blue-600 dark:to-blue-700 dark:hover:from-blue-700 dark:hover:to-blue-800">
              <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
              <span className="text-sm font-medium">顺序练题</span>
              <span className="text-xs opacity-80">当前题库</span>
            </button>

            <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col gap-4">
              <button onClick={handleStartExam} disabled={currentBank.questions.length === 0} className="flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed relative">
                <div className="w-12 h-12 bg-orange-500 hover:bg-orange-600 text-white rounded-full shadow-md flex items-center justify-center transition-colors dark:bg-orange-600 dark:hover:bg-orange-700">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400">模拟考试</span>
              </button>
              <button onClick={() => handleStartPractice('wrong')} className="flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed relative">
                <div className="w-12 h-12 bg-green-500 hover:bg-green-600 text-white rounded-full shadow-md flex items-center justify-center transition-colors dark:bg-green-600 dark:hover:bg-green-700">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400">练易错题</span>
                {wrongQuestions.length > 0 && <span className="absolute -top-1 right-0 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{wrongQuestions.length > 99 ? '99+' : wrongQuestions.length}</span>}
              </button>
            </div>

            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col gap-4">
              <button onClick={() => handleStartPractice('view')} disabled={currentBank.questions.length === 0} className="flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed relative">
                <div className="w-12 h-12 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-md flex items-center justify-center transition-colors dark:bg-blue-600 dark:hover:bg-blue-700">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400">看题模式</span>
              </button>
              <button onClick={() => handleStartPractice('common')} className="flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed relative">
                <div className="w-12 h-12 bg-yellow-500 hover:bg-yellow-600 text-white rounded-full shadow-md flex items-center justify-center transition-colors dark:bg-yellow-600 dark:hover:bg-yellow-700">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400">收藏</span>
                {commonQuestions.length > 0 && <span className="absolute -top-1 right-0 bg-yellow-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{commonQuestions.length > 99 ? '99+' : commonQuestions.length}</span>}
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl p-3 text-center shadow-sm dark:bg-gray-800">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalQuestions}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">总题数</div>
          </div>
          <div className="bg-white rounded-xl p-3 text-center shadow-sm dark:bg-gray-800">
            <div className="text-2xl font-bold text-red-500 dark:text-red-400">{wrongQuestions.length}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">错题数</div>
          </div>
          <div className="bg-white rounded-xl p-3 text-center shadow-sm dark:bg-gray-800">
            <div className="text-2xl font-bold text-yellow-500 dark:text-yellow-400">{commonQuestions.length}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">收藏数</div>
          </div>
        </div>
      </div>

      <nav 
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg dark:bg-gray-800 dark:border-gray-700"
        style={{ paddingBottom: safeArea.bottom }}
      >
        <div className="max-w-lg mx-auto flex justify-around py-0.5">
          <button className="flex flex-col items-center py-1 px-6 text-blue-600 dark:text-blue-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            <span className="text-xs mt-0.5 font-medium">首页</span>
          </button>
          <button onClick={() => navigate('/profile')} className="flex flex-col items-center py-1 px-6 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            <span className="text-xs mt-0.5">我的</span>
          </button>
        </div>
      </nav>

      {(showAddModal || modalVisible) && (
        <div 
          className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${isClosing ? 'bg-opacity-0' : 'bg-opacity-50'}`}
          onClick={() => setShowAddModal(false)}
        >
          <div 
            className="bg-white rounded-2xl p-5 w-full max-w-sm dark:bg-gray-800 shadow-2xl transform transition-all duration-300 ease-in-out"
            style={{
              transform: isClosing || !modalVisible ? 'scale(0)' : 'scale(1)',
              opacity: isClosing || !modalVisible ? 0 : 1
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-4 dark:text-white">添加题库</h2>
            <div className="space-y-3">
              <button onClick={() => { setShowAddModal(false); navigate('/import'); }} className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all dark:border-gray-700 dark:hover:border-blue-400 dark:hover:bg-blue-900/30">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center dark:bg-green-900">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                </div>
                <div className="text-left">
                  <div className="font-medium text-gray-800 dark:text-white">导入题库</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">从 JSON 文件导入题库</div>
                </div>
              </button>
              <button onClick={() => { setShowAddModal(false); navigate('/download-banks'); }} className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-purple-500 hover:bg-purple-50 transition-all dark:border-gray-700 dark:hover:border-purple-400 dark:hover:bg-purple-900/30">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center dark:bg-purple-900">
                  <svg className="w-5 h-5 text-purple-600 dark:text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </div>
                <div className="text-left">
                  <div className="font-medium text-gray-800 dark:text-white">下载题库</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">从 GitHub 获取更多题库资源</div>
                </div>
              </button>
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors dark:text-gray-400 dark:hover:bg-gray-700">取消</button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};

export default Home;

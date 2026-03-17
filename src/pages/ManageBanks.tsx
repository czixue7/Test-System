import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { isBuiltInBank } from '../utils/builtInBanks';
import { useToast } from '../hooks/useToast';
import { QuestionBank, BankIndex, BankImageInfo } from '../types';
import { useSafeArea } from '../hooks/useSafeArea';
import { fetchBankIndex, checkBankUpdate, findBankInIndex } from '../utils/bankIndex';

const ManageBanks: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { banks, deleteBank, updateBankWithSha } = useQuestionBankStore();
  const { showSuccess, showWarning, showInfo, showError } = useToast();
  const safeArea = useSafeArea();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [bankToDelete, setBankToDelete] = useState<string | null>(null);
  const [bankIndex, setBankIndex] = useState<BankIndex | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [updatingBankId, setUpdatingBankId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<{ user: boolean; builtIn: boolean }>({
    user: true,
    builtIn: true
  });

  // 使用统一的 bank-index.json 获取远程题库信息
  const fetchRemoteBanks = useCallback(async () => {
    setLoadingRemote(true);
    try {
      const index = await fetchBankIndex();
      if (index) {
        setBankIndex(index);
      } else {
        showError('无法获取远程题库信息');
      }
    } catch (error) {
      console.error('Failed to fetch remote banks:', error);
      showError('获取远程题库信息失败');
    } finally {
      setLoadingRemote(false);
    }
  }, [showError]);

  useEffect(() => {
    fetchRemoteBanks();
  }, [fetchRemoteBanks]);

  const handleGoBack = () => {
    if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/profile');
    }
  };

  const toggleSection = (section: 'user' | 'builtIn') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleDeleteClick = (bankId: string) => {
    if (isBuiltInBank(bankId)) {
      showWarning('内置题库不能删除');
      return;
    }
    setBankToDelete(bankId);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = () => {
    if (bankToDelete) {
      const bank = banks.find(b => b.id === bankToDelete);
      deleteBank(bankToDelete);
      showSuccess(`题库「${bank?.name}」已删除`);
    }
    setShowDeleteModal(false);
    setBankToDelete(null);
  };

  const handleUpdateBank = async (bank: QuestionBank) => {
    if (!bankIndex || !bank.sourceFilename || !bank.sourceType) {
      showError('无法获取远程题库信息');
      return;
    }

    const remoteBank = findBankInIndex(bankIndex, bank.sourceFilename, bank.sourceType);

    if (!remoteBank) {
      showError('无法获取远程题库信息');
      return;
    }

    setUpdatingBankId(bank.id);
    showInfo(`正在更新「${bank.name}」...`);

    try {
      const response = await fetch(remoteBank.downloadUrl);

      if (!response.ok) {
        throw new Error('下载失败');
      }

      const data = await response.json();

      const updatedBank: Partial<QuestionBank> = {
        name: data.name || bank.name,
        description: data.description,
        questions: data.questions.map((q: any, qIndex: number) => ({
          id: `downloaded-${Date.now()}-${qIndex}`,
          type: q.type,
          content: q.content,
          options: q.options,
          correctAnswer: q.correctAnswer,
          score: q.score || 1,
          explanation: q.explanation,
          images: q.images,
          allowDisorder: q.allowDisorder
        })),
        sourceSha: remoteBank.sha,
        images: remoteBank.images,
        updatedAt: new Date().toISOString()
      };

      updateBankWithSha(bank.id, updatedBank, remoteBank.sha, remoteBank.images);
      showSuccess(`题库「${updatedBank.name}」更新成功！`);
    } catch (error) {
      showError(`更新失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setUpdatingBankId(null);
    }
  };

  const userBanks = banks.filter(b => !isBuiltInBank(b.id));
  const builtInBanks = banks.filter(b => isBuiltInBank(b.id));

  const renderBankItem = (bank: QuestionBank) => {
    const updateInfo = checkBankUpdate(bank, bankIndex);
    const isUpdating = updatingBankId === bank.id;
    const canUpdate = updateInfo.hasUpdate || updateInfo.hasImageUpdate;

    return (
      <div
        key={bank.id}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-3 border border-gray-100 dark:border-gray-700"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-medium text-gray-800 dark:text-white truncate text-sm">
              {bank.name}
            </h3>
            {bank.sourceType === 'system' && (
              <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded flex-shrink-0">
                系统
              </span>
            )}
            {bank.sourceType === 'user' && (
              <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs rounded flex-shrink-0">
                用户
              </span>
            )}
            {canUpdate && (
              <span className="px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 text-xs rounded flex-shrink-0">
                有更新
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {canUpdate && (
              <button
                onClick={() => handleUpdateBank(bank)}
                disabled={isUpdating}
                className="p-1.5 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-colors disabled:opacity-50"
                title="更新题库"
              >
                {isUpdating ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
              </button>
            )}
            {!isBuiltInBank(bank.id) && (
              <button
                onClick={() => handleDeleteClick(bank.id)}
                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                title="删除题库"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            {isBuiltInBank(bank.id) && (
              <div className="p-1.5 text-gray-300 dark:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
          <span className="truncate flex-1 mr-2">
            {bank.description || '暂无描述'}
          </span>
          <span className="flex-shrink-0">{bank.questions.length} 题</span>
        </div>
      </div>
    );
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
          <h1 className="text-lg font-semibold">题库管理</h1>
          <button
            onClick={fetchRemoteBanks}
            disabled={loadingRemote}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
            title="检查更新"
          >
            <svg
              className={`w-5 h-5 ${loadingRemote ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>
      </header>

      <div 
        className="max-w-lg mx-auto px-4 py-4 pb-24"
        style={{ paddingTop: safeArea.top + 48 }}
      >
        {userBanks.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => toggleSection('user')}
              className="w-full flex items-center justify-between mb-2 px-1"
            >
              <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                用户题库 ({userBanks.length})
              </h2>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expandedSections.user ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {expandedSections.user && (
              <div className="space-y-2">
                {userBanks.map(bank => renderBankItem(bank))}
              </div>
            )}
          </div>
        )}

        {builtInBanks.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => toggleSection('builtIn')}
              className="w-full flex items-center justify-between mb-2 px-1"
            >
              <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                内置题库 ({builtInBanks.length})
              </h2>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expandedSections.builtIn ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {expandedSections.builtIn && (
              <div className="space-y-2">
                {builtInBanks.map(bank => renderBankItem(bank))}
              </div>
            )}
          </div>
        )}

        {banks.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-6 text-center">
            <svg className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">暂无题库</p>
          </div>
        )}
      </div>

      {showDeleteModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowDeleteModal(false)}
        >
          <div 
            className="bg-white dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <div className="w-12 h-12 mx-auto mb-3 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">确认删除</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                确定要删除这个题库吗？此操作不可撤销。
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-all"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageBanks;

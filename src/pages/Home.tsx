import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { isBuiltInBank } from '../utils/builtInBanks';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { banks, addBank, deleteBank } = useQuestionBankStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [newBankDesc, setNewBankDesc] = useState('');

  const handleCreateBank = () => {
    if (!newBankName.trim()) return;
    const id = addBank({
      name: newBankName.trim(),
      description: newBankDesc.trim() || undefined,
      questions: []
    });
    setShowCreateModal(false);
    setNewBankName('');
    setNewBankDesc('');
    navigate(`/bank/${id}`);
  };

  const handleStartExam = (bankId: string) => {
    navigate(`/exam/${bankId}`);
  };

  const handleDeleteBank = (e: React.MouseEvent, bankId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm('确定要删除这个题库吗？')) {
      deleteBank(bankId);
    }
  };

  return (
    <div className="page-container">
      <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
          <h1 className="title-primary">题库管理</h1>
          <div className="flex gap-1.5 w-full sm:w-auto">
            <Link to="/import" className="btn-secondary flex-1 sm:flex-initial text-center">
              导入题库
            </Link>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex-1 sm:flex-initial"
            >
              新建题库
            </button>
          </div>
        </div>

        <div className="mb-3 sm:mb-4">
          <Link to="/records" className="btn-back">
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            测试记录
          </Link>
        </div>

        {banks.length === 0 ? (
          <div className="card text-center py-5 sm:py-6">
            <svg className="w-8 h-8 sm:w-10 sm:h-10 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-gray-500 mb-2 sm:mb-3 text-xs sm:text-sm">暂无题库，点击上方按钮创建</p>
          </div>
        ) : (
          <div className="grid gap-1.5 sm:gap-2 w-full">
            {banks.map((bank) => (
              <div
                key={bank.id}
                className="card cursor-pointer hover:shadow-lg w-full"
                onClick={() => navigate(`/bank/${bank.id}`)}
              >
                <div className="flex flex-col gap-1.5 sm:gap-2 w-full min-w-0">
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <h3 className="text-xs sm:text-sm md:text-base font-semibold text-gray-800 truncate">{bank.name}</h3>
                      {isBuiltInBank(bank.id) && (
                        <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full whitespace-nowrap">内置</span>
                      )}
                    </div>
                    {bank.description && (
                      <p className="text-gray-500 text-xs mb-0.5 truncate block">{bank.description}</p>
                    )}
                    <div className="flex items-center gap-2 sm:gap-3 text-xs text-gray-500">
                      <span>题目: {bank.questions.length}</span>
                      <span>创建: {new Date(bank.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 w-full">
                    {bank.questions.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartExam(bank.id);
                        }}
                        className="flex-1 px-2 py-1 sm:px-2.5 sm:py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-xs whitespace-nowrap"
                      >
                        开始测试
                      </button>
                    )}
                    <button
                      onClick={(e) => handleDeleteBank(e, bank.id)}
                      className={`px-1.5 py-1 sm:px-2 sm:py-1.5 rounded-lg transition-colors ${
                        isBuiltInBank(bank.id) 
                          ? 'text-gray-300 cursor-not-allowed' 
                          : 'text-red-500 hover:bg-red-50'
                      }`}
                      disabled={isBuiltInBank(bank.id)}
                    >
                      <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3">
            <div className="bg-white rounded-lg p-3 sm:p-4 w-full max-w-md">
              <h2 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3">新建题库</h2>
              <div className="space-y-2 sm:space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">
                    题库名称 *
                  </label>
                  <input
                    type="text"
                    value={newBankName}
                    onChange={(e) => setNewBankName(e.target.value)}
                    className="w-full px-2 py-1 sm:px-2.5 sm:py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs sm:text-sm"
                    placeholder="请输入题库名称"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">
                    题库描述
                  </label>
                  <textarea
                    value={newBankDesc}
                    onChange={(e) => setNewBankDesc(e.target.value)}
                    className="w-full px-2 py-1 sm:px-2.5 sm:py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs sm:text-sm"
                    rows={2}
                    placeholder="请输入题库描述（可选）"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-1.5 sm:gap-2 mt-3 sm:mt-4">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewBankName('');
                    setNewBankDesc('');
                  }}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateBank}
                  disabled={!newBankName.trim()}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;

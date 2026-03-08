import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useRecordStore } from '../store/recordStore';

const Result: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getRecord } = useRecordStore();
  const record = getRecord(id!);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  const handleGoBack = () => {
    if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  if (!record) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-gray-500 dark:text-gray-400 mb-4">测试记录不存在</p>
          <button onClick={handleGoBack} className="px-4 py-2 bg-blue-500 text-white rounded-lg">返回</button>
        </div>
      </div>
    );
  }

  const correctCount = record.answers.filter(a => a.isCorrect).length;
  const wrongCount = record.answers.filter(a => !a.isCorrect && a.answer !== '' && (!Array.isArray(a.answer) || a.answer.length > 0)).length;
  const unansweredCount = record.answers.filter(a => a.answer === '' || (Array.isArray(a.answer) && a.answer.length === 0)).length;

  useEffect(() => {
    if (navRef.current && showDetail) {
      const currentBtn = navRef.current.children[currentIndex] as HTMLElement;
      if (currentBtn) {
        currentBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [currentIndex, showDetail]);

  if (showDetail) {
    const currentQuestion = record.questions[currentIndex];
    const userAnswer = record.answers.find(a => a.questionId === currentQuestion?.id);

    const renderQuestionContent = () => {
      if (!currentQuestion) return null;

      return (
        <div className="space-y-4">
          <div className="text-lg font-medium text-gray-800 dark:text-gray-200 selectable">{currentQuestion.content}</div>
          {currentQuestion.images && currentQuestion.images.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {currentQuestion.images.map((img, idx) => (
                <img key={idx} src={img} alt="" className="rounded-lg max-h-40 object-contain" />
              ))}
            </div>
          )}

          {currentQuestion.type === 'single-choice' && currentQuestion.options && (
            <div className="space-y-2">
              {currentQuestion.options.map((option) => {
                const isSelected = userAnswer?.answer === option.id;
                const isCorrect = currentQuestion.correctAnswer === option.id;
                let bgClass = 'bg-gray-50 dark:bg-gray-800';
                if (isCorrect) bgClass = 'bg-green-50 border-green-500 dark:bg-green-900/30 dark:border-green-400';
                else if (isSelected && !isCorrect) bgClass = 'bg-red-50 border-red-500 dark:bg-red-900/30 dark:border-red-400';
                return (
                  <div
                    key={option.id}
                    className={`w-full p-3 rounded-lg text-left border-2 text-gray-800 dark:text-gray-200 ${bgClass}`}
                  >
                    <span className="font-medium mr-2">{option.id}.</span>
                    <span className="selectable">{option.content}</span>
                    {isCorrect && <span className="ml-2 text-green-600 dark:text-green-400 text-sm">✓ 正确答案</span>}
                    {isSelected && !isCorrect && <span className="ml-2 text-red-600 dark:text-red-400 text-sm">✗ 你的选择</span>}
                  </div>
                );
              })}
            </div>
          )}

          {currentQuestion.type === 'multiple-choice' && currentQuestion.options && (
            <div className="space-y-2">
              {currentQuestion.options.map((option) => {
                const selected = (userAnswer?.answer as string[]) || [];
                const isSelected = selected.includes(option.id);
                const correct = currentQuestion.correctAnswer as string[];
                const isCorrect = correct.includes(option.id);
                let bgClass = 'bg-gray-50 dark:bg-gray-800';
                if (isCorrect) bgClass = 'bg-green-50 border-green-500 dark:bg-green-900/30 dark:border-green-400';
                else if (isSelected && !isCorrect) bgClass = 'bg-red-50 border-red-500 dark:bg-red-900/30 dark:border-red-400';
                return (
                  <div
                    key={option.id}
                    className={`w-full p-3 rounded-lg text-left border-2 text-gray-800 dark:text-gray-200 ${bgClass}`}
                  >
                    <span className="font-medium mr-2">{option.id}.</span>
                    <span className="selectable">{option.content}</span>
                    {isCorrect && <span className="ml-2 text-green-600 dark:text-green-400 text-sm">✓ 正确答案</span>}
                    {isSelected && !isCorrect && <span className="ml-2 text-red-600 dark:text-red-400 text-sm">✗ 你的选择</span>}
                  </div>
                );
              })}
            </div>
          )}

          {currentQuestion.type === 'fill-in-blank' && (
            <div className="space-y-3">
              <div className="p-4 bg-green-50 border-2 border-green-500 rounded-lg dark:bg-green-900/30 dark:border-green-400">
                <div className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">正确答案</div>
                <div className="text-gray-800 dark:text-gray-200">
                  {(() => {
                    const answer = currentQuestion.correctAnswer;
                    if (typeof answer === 'object' && answer !== null && 'text' in answer) {
                      return answer.text;
                    }
                    return Array.isArray(answer) ? answer.join('、') : answer;
                  })()}
                </div>
              </div>
              <div className={`p-4 border-2 rounded-lg ${userAnswer?.isCorrect ? 'bg-green-50 border-green-500 dark:bg-green-900/30 dark:border-green-400' : 'bg-red-50 border-red-500 dark:bg-red-900/30 dark:border-red-400'}`}>
                <div className={`text-sm font-medium mb-1 ${userAnswer?.isCorrect ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {userAnswer?.isCorrect ? '你的答案（正确）' : '你的答案（错误）'}
                </div>
                <div className="text-gray-800 dark:text-gray-200">
                  {userAnswer?.answer && userAnswer.answer !== '' && (!Array.isArray(userAnswer.answer) || userAnswer.answer.length > 0)
                    ? (Array.isArray(userAnswer.answer) ? userAnswer.answer.join('、') : userAnswer.answer)
                    : '未作答'}
                </div>
              </div>
            </div>
          )}

          {currentQuestion.type === 'subjective' && (
            <div className="space-y-3">
              <div className="p-4 bg-green-50 border-2 border-green-500 rounded-lg dark:bg-green-900/30 dark:border-green-400">
                <div className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">参考答案</div>
                <div className="text-gray-800 dark:text-gray-200">
                  {typeof currentQuestion.correctAnswer === 'object' && currentQuestion.correctAnswer !== null && 'text' in currentQuestion.correctAnswer
                    ? currentQuestion.correctAnswer.text
                    : currentQuestion.correctAnswer}
                </div>
              </div>
              <div className={`p-4 border-2 rounded-lg ${userAnswer?.isCorrect ? 'bg-green-50 border-green-500 dark:bg-green-900/30 dark:border-green-400' : 'bg-red-50 border-red-500 dark:bg-red-900/30 dark:border-red-400'}`}>
                <div className={`text-sm font-medium mb-1 ${userAnswer?.isCorrect ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {userAnswer?.isCorrect ? '你的答案（正确）' : '你的答案（错误）'}
                </div>
                <div className="text-gray-800 dark:text-gray-200">
                  {userAnswer?.answer && userAnswer.answer !== '' && (!Array.isArray(userAnswer.answer) || userAnswer.answer.length > 0)
                    ? (Array.isArray(userAnswer.answer) ? userAnswer.answer.join('、') : userAnswer.answer)
                    : '未作答'}
                </div>
              </div>
            </div>
          )}

          {currentQuestion.explanation && (
            <div className="p-4 bg-blue-50 rounded-lg dark:bg-blue-900/30">
              <div className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-1">解析</div>
              <div className="text-gray-700 dark:text-gray-300">{currentQuestion.explanation}</div>
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
        <header className="bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg">
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
            <button onClick={() => setShowDetail(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">{currentIndex + 1}/{record.questions.length}</span>
            </div>
            <div className="w-8" />
          </div>
        </header>

        <div className="max-w-lg mx-auto px-4 py-4 pb-24">
          {renderQuestionContent()}
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="max-w-lg mx-auto">
            <div className="flex justify-between gap-2">
              <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50">上一题</button>
              <div ref={navRef} className="flex gap-1 overflow-x-auto max-w-[200px]">
                {record.questions.map((q, idx) => {
                  const ans = record.answers.find(a => a.questionId === q.id);
                  return (
                    <button
                      key={q.id}
                      onClick={() => setCurrentIndex(idx)}
                      className={`w-8 h-8 rounded text-xs font-medium flex-shrink-0 ${
                        idx === currentIndex
                          ? 'bg-blue-500 text-white'
                          : ans?.isCorrect
                            ? 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400'
                            : ans?.answer && ans.answer !== '' && (!Array.isArray(ans.answer) || ans.answer.length > 0)
                              ? 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400'
                              : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setCurrentIndex(Math.min(record.questions.length - 1, currentIndex + 1))} disabled={currentIndex === record.questions.length - 1} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50">下一题</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-semibold">考试结果</h1>
          <div className="w-8" />
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-6 text-center mb-4">
          <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-2xl font-bold text-white">{record.percentage}%</span>
          </div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-2">考试完成</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400">{record.totalScore}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">得分</div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-xl font-bold text-gray-600 dark:text-gray-400">{record.maxScore}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">满分</div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-xl font-bold text-gray-600 dark:text-gray-400">{Math.floor(record.duration / 60)}:{(record.duration % 60).toString().padStart(2, '0')}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">用时</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-green-50 dark:bg-green-900/30 rounded-lg">
              <div className="text-xl font-bold text-green-600 dark:text-green-400">{correctCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">正确</div>
            </div>
            <div className="p-3 bg-red-50 dark:bg-red-900/30 rounded-lg">
              <div className="text-xl font-bold text-red-600 dark:text-red-400">{wrongCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">错误</div>
            </div>
            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-xl font-bold text-gray-400 dark:text-gray-500">{unansweredCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">未答</div>
            </div>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {record.bankName} · {new Date(record.finishedAt).toLocaleString()}
          </div>
          <button onClick={() => setShowDetail(true)} className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all mb-2">
            查看答题详情
          </button>
          <button onClick={() => navigate('/')} className="w-full py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-all">
            返回首页
          </button>
        </div>
      </div>
    </div>
  );
};

export default Result;

import React, { useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useRecordStore } from '../store/recordStore';
import { useSwipeElement } from '../hooks/useSwipe';
import { useKeyboard } from '../hooks/useKeyboard';
import { useSafeArea } from '../hooks/useSafeArea';
import ImageViewer from '../components/ImageViewer';

const Result: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getRecord } = useRecordStore();
  const record = getRecord(id!);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [sourceRect, setSourceRect] = useState<DOMRect | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<HTMLDivElement>(null);
  const { isOpen: isKeyboardOpen, bottom: keyboardBottom } = useKeyboard();
  const safeArea = useSafeArea();

  const openImageViewer = (images: string[], initialIndex: number = 0, rect?: DOMRect) => {
    setViewerImages(images);
    setViewerInitialIndex(initialIndex);
    setSourceRect(rect || null);
  };

  const closeImageViewer = () => {
    setViewerImages(null);
    setViewerInitialIndex(0);
    setSourceRect(null);
  };

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
        <div className="text-center">
          <div className="text-gray-500 dark:text-gray-400">未找到考试记录</div>
          <button 
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  useSwipeElement(swipeRef, {
    onSwipeLeft: () => {
      if (showDetail) {
        setCurrentIndex(Math.min(record.questions.length - 1, currentIndex + 1));
      }
    },
    onSwipeRight: () => {
      if (showDetail) {
        setCurrentIndex(Math.max(0, currentIndex - 1));
      }
    },
    threshold: 50,
  });

  const correctCount = record.answers.filter(a => a.isCorrect).length;
  const wrongCount = record.answers.filter(a => !a.isCorrect && a.answer !== '' && (!Array.isArray(a.answer) || a.answer.length > 0)).length;
  const unansweredCount = record.answers.filter(a => a.answer === '' || (Array.isArray(a.answer) && a.answer.length === 0)).length;

  if (showDetail) {
    const currentQuestion = record.questions[currentIndex];
    const userAnswer = record.answers.find(a => a.questionId === currentQuestion?.id);

    const renderQuestionContent = () => {
      if (!currentQuestion) return null;

      return (
        <div className="space-y-4">
          <div className="text-lg font-medium text-gray-800 dark:text-gray-200 selectable">{currentQuestion.content}</div>

          {currentQuestion.type === 'single-choice' && currentQuestion.options && (
            <div className="space-y-2">
              {currentQuestion.options.map((option) => {
                const isSelected = userAnswer?.answer === option.id;
                const isCorrect = currentQuestion.correctAnswer === option.id;
                let bgClass = 'bg-gray-50 dark:bg-gray-800';
                if (isCorrect) bgClass = 'bg-green-50 border-green-500 dark:bg-green-900/30 dark:border-green-400';
                else if (isSelected) bgClass = 'bg-red-50 border-red-500 dark:bg-red-900/30 dark:border-red-400';
                
                return (
                  <div 
                    key={option.id}
                    className={`p-3 border-2 rounded-lg ${bgClass} ${isCorrect ? 'border-green-500' : isSelected ? 'border-red-500' : 'border-transparent'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${
                        isCorrect ? 'bg-green-500 text-white' : 
                        isSelected ? 'bg-red-500 text-white' : 
                        'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>
                        {option.id}
                      </span>
                      <span className="text-gray-800 dark:text-gray-200">{option.content}</span>
                    </div>
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
                else if (isSelected) bgClass = 'bg-red-50 border-red-500 dark:bg-red-900/30 dark:border-red-400';
                
                return (
                  <div 
                    key={option.id}
                    className={`p-3 border-2 rounded-lg ${bgClass} ${isCorrect ? 'border-green-500' : isSelected ? 'border-red-500' : 'border-transparent'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded flex items-center justify-center text-sm ${
                        isCorrect ? 'bg-green-500 text-white' : 
                        isSelected ? 'bg-red-500 text-white' : 
                        'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>
                        {isCorrect ? '✓' : isSelected ? '✗' : option.id}
                      </span>
                      <span className="text-gray-800 dark:text-gray-200">{option.content}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {currentQuestion.type === 'fill-in-blank' && (
            <div className="space-y-3">
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
              <div className="p-4 bg-green-50 border-2 border-green-500 rounded-lg dark:bg-green-900/30 dark:border-green-400">
                <div className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">参考答案</div>
                {/* 显示参考答案图片 */}
                {(() => {
                  const answer = currentQuestion.correctAnswer;
                  if (typeof answer === 'object' && answer !== null && 'images' in answer && Array.isArray(answer.images) && answer.images.length > 0) {
                    return (
                      <div className="mb-3 space-y-2">
                        {answer.images.map((img: string, idx: number) => (
                          <img 
                            key={idx} 
                            src={img} 
                            alt="" 
                            className="w-full rounded-lg object-contain cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={(e) => {
                              const rect = (e.target as HTMLImageElement).getBoundingClientRect();
                              openImageViewer(answer.images as string[], idx, rect);
                            }}
                          />
                        ))}
                      </div>
                    );
                  }
                  return null;
                })()}
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
            </div>
          )}

          {currentQuestion.type === 'subjective' && (
            <div className="space-y-3">
              <div className="p-4 bg-green-50 border-2 border-green-500 rounded-lg dark:bg-green-900/30 dark:border-green-400">
                <div className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">参考答案</div>
                {/* 显示参考答案图片 */}
                {(() => {
                  const answer = currentQuestion.correctAnswer;
                  if (typeof answer === 'object' && answer !== null && 'images' in answer && Array.isArray(answer.images) && answer.images.length > 0) {
                    return (
                      <div className="mb-3 space-y-2">
                        {answer.images.map((img: string, idx: number) => (
                          <img 
                            key={idx} 
                            src={img} 
                            alt="" 
                            className="w-full rounded-lg object-contain cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={(e) => {
                              const rect = (e.target as HTMLImageElement).getBoundingClientRect();
                              openImageViewer(answer.images as string[], idx, rect);
                            }}
                          />
                        ))}
                      </div>
                    );
                  }
                  return null;
                })()}
                <div className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  {(() => {
                    const answer = currentQuestion.correctAnswer;
                    if (typeof answer === 'object' && answer !== null && 'text' in answer) {
                      return answer.text;
                    }
                    return answer;
                  })()}
                </div>
              </div>
            </div>
          )}

          {currentQuestion.explanation && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg dark:bg-yellow-900/20 dark:border-yellow-700">
              <div className="text-sm font-medium text-yellow-700 dark:text-yellow-400 mb-1">解析</div>
              <div className="text-gray-700 dark:text-gray-300">{currentQuestion.explanation}</div>
            </div>
          )}
        </div>
      );
    };

    return (
      <div 
        ref={swipeRef}
        className="min-h-screen bg-gray-50 dark:bg-gray-900"
      >
        <header 
          className="fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors"
          style={{ paddingTop: safeArea.top }}
        >
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
            <button onClick={() => setShowDetail(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-lg font-semibold">答题详情</h1>
            <div className="w-8 h-8" />
          </div>
        </header>

        <div 
          className="max-w-lg mx-auto px-4 py-6"
          style={{ paddingTop: safeArea.top + 72, paddingBottom: safeArea.bottom + 100 }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-500 dark:text-gray-400">第 {currentIndex + 1} 题 / 共 {record.questions.length} 题</span>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                userAnswer?.isCorrect 
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400' 
                  : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400'
              }`}>
                {userAnswer?.isCorrect ? '正确' : '错误'}
              </span>
            </div>
            
            {renderQuestionContent()}
          </div>
        </div>

        <div 
          className="fixed left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-2 transition-all duration-300"
          style={{ 
            bottom: isKeyboardOpen ? keyboardBottom : 0,
            paddingBottom: safeArea.bottom
          }}
        >
          <div className="max-w-lg mx-auto">
            <div 
              ref={navRef} 
              className="flex gap-1 overflow-x-auto mb-2 scrollbar-hide" 
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              onWheel={(e) => {
                e.stopPropagation();
                const delta = e.deltaY;
                if (navRef.current) {
                  navRef.current.scrollLeft += delta;
                }
              }}
            >
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
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
            
            <div className="flex justify-between items-center gap-2 mb-1">
              <button 
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} 
                disabled={currentIndex === 0} 
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50"
              >
                上一题
              </button>
              <button 
                onClick={() => setCurrentIndex(Math.min(record.questions.length - 1, currentIndex + 1))} 
                disabled={currentIndex === record.questions.length - 1} 
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50"
              >
                下一题
              </button>
            </div>
          </div>
        </div>
        
        {/* 图片查看器 */}
        {viewerImages && (
          <ImageViewer 
            images={viewerImages} 
            onClose={closeImageViewer}
            initialIndex={viewerInitialIndex}
            sourceRect={sourceRect}
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header 
        className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-semibold">考试结果</h1>
          <div className="w-8 h-8" />
        </div>
      </header>

      <div 
        className="max-w-lg mx-auto px-4 py-6"
        style={{ paddingTop: safeArea.top + 48 }}
      >
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
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            {record.bankName} · {new Date(record.finishedAt).toLocaleString()}
          </div>
          <div className="mb-4">
            {(() => {
              const modeCounts: Record<string, number> = {};
              record.answers.forEach(ans => {
                const mode = ans.gradingMode || record.gradingMode || 'fixed';
                modeCounts[mode] = (modeCounts[mode] || 0) + 1;
              });
              
              const hasMixedModes = Object.keys(modeCounts).length > 1;
              
              if (hasMixedModes) {
                return (
                  <div className="flex flex-wrap justify-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">混合判题模式：</span>
                    {modeCounts['ai'] && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">
                        AI 智能判题 {modeCounts['ai']}题
                      </span>
                    )}
                    {modeCounts['fixed'] && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                        固定规则判题 {modeCounts['fixed']}题
                      </span>
                    )}
                    {modeCounts['ai-fallback'] && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300">
                        AI降级判题 {modeCounts['ai-fallback']}题
                      </span>
                    )}
                  </div>
                );
              }
              
              const singleMode = record.gradingMode || 'fixed';
              return (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  singleMode === 'ai'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300'
                    : singleMode === 'ai-fallback'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                }`}>
                  {singleMode === 'ai' ? 'AI 智能判题' : singleMode === 'ai-fallback' ? 'AI降级判题' : '固定规则判题'}
                </span>
              );
            })()}
          </div>
          
          {record.aiEvaluation && (
            <div className="mb-4 p-4 bg-purple-50 dark:bg-purple-900/30 rounded-xl border border-purple-200 dark:border-purple-700">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span className="text-sm font-medium text-purple-700 dark:text-purple-400">AI 考试评价</span>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{record.aiEvaluation}</p>
            </div>
          )}
          
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

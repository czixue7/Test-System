import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { useExamStore } from '../store/examStore';
import { Question, QuestionBank, PracticeMode } from '../types';
import { useSwipeElement } from '../hooks/useSwipe';
import { useKeyboard } from '../hooks/useKeyboard';
import { useSafeArea } from '../hooks/useSafeArea';
import ImageViewer from '../components/ImageViewer';

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};



const Practice: React.FC = () => {
  const { bankId, mode } = useParams<{ bankId: string; mode: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getBank } = useQuestionBankStore();
  const { setAnswer, getAnswer, confirmAnswer, getResult, startExam } = useExamStore();

  const [practiceQuestions, setPracticeQuestions] = useState<Question[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [wrongQuestions, setWrongQuestions] = useState<Question[]>([]);
  const [favoriteQuestions, setFavoriteQuestions] = useState<Question[]>([]);
  const [commonQuestions, setCommonQuestions] = useState<Question[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
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

  const bank = getBank(bankId!);
  const practiceMode = mode as PracticeMode;

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
    }
  }, []);

  useEffect(() => {
    setIsInitialized(false);
  }, [bankId, practiceMode]);

  useEffect(() => {
    if (!bank || !practiceMode || isInitialized) return;

    const getQuestionsForMode = (mode: PracticeMode, bank: QuestionBank): Question[] => {
      switch (mode) {
        case 'sequential':
        case 'view':
          return [...bank.questions];
        case 'wrong':
          return wrongQuestions.length > 0 ? shuffleArray([...wrongQuestions]) : [];
        case 'favorites':
        case 'common':
          return commonQuestions.length > 0 ? [...commonQuestions] : [];
        default:
          return [...bank.questions];
      }
    };

    const questions = getQuestionsForMode(practiceMode, bank);
    
    if (questions.length === 0 && (practiceMode === 'wrong' || practiceMode === 'common')) {
      return;
    }
    
    setPracticeQuestions(questions);
    setPracticeIndex(0);
    setShowAnswer(false);
    startExam(bank.id, bank.name, questions);
    setIsInitialized(true);
  }, [bank, practiceMode, wrongQuestions, commonQuestions, isInitialized, startExam]);

  useEffect(() => {
    if (navRef.current && practiceQuestions.length > 0) {
      const currentBtn = navRef.current.children[practiceIndex] as HTMLElement;
      if (currentBtn) {
        currentBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [practiceIndex]);

  const savePracticeData = useCallback((wrong: Question[], favorites: Question[], common: Question[]) => {
    localStorage.setItem('practice-data-global', JSON.stringify({
      wrongQuestions: wrong,
      favoriteQuestions: favorites,
      commonQuestions: common
    }));
  }, []);

  const handleGoBack = () => {
    if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleConfirmAnswer = async () => {
    const question = practiceQuestions[practiceIndex];
    if (!question) return;

    const useAI = practiceMode !== 'wrong' && practiceMode !== 'sequential';
    await confirmAnswer(question.id, useAI);
    setShowAnswer(true);

    const result = getResult(question.id);

    if (practiceMode === 'wrong') {
      if (result && result.isCorrect) {
        const newWrong = wrongQuestions.filter(q => q.id !== question.id);
        setWrongQuestions(newWrong);
        savePracticeData(newWrong, favoriteQuestions, commonQuestions);
      }
    } else {
      if (result && !result.isCorrect) {
        const newWrong = [...wrongQuestions];
        if (!newWrong.find(q => q.id === question.id)) {
          newWrong.push(question);
          setWrongQuestions(newWrong);
          savePracticeData(newWrong, favoriteQuestions, commonQuestions);
        }
      }
    }
  };

  const handleNextQuestion = () => {
    if (practiceIndex < practiceQuestions.length - 1) {
      const nextQuestion = practiceQuestions[practiceIndex + 1];
      const nextResult = getResult(nextQuestion.id);
      setPracticeIndex(practiceIndex + 1);
      setShowAnswer(nextResult?.isConfirmed || false);
    }
  };

  const handlePrevQuestion = () => {
    if (practiceIndex > 0) {
      const prevQuestion = practiceQuestions[practiceIndex - 1];
      const prevResult = getResult(prevQuestion.id);
      setPracticeIndex(practiceIndex - 1);
      setShowAnswer(prevResult?.isConfirmed || false);
    }
  };

  const handleGoToQuestion = (index: number) => {
    const question = practiceQuestions[index];
    const result = getResult(question.id);
    setPracticeIndex(index);
    setShowAnswer(result?.isConfirmed || false);
  };

  useSwipeElement(swipeRef, {
    onSwipeLeft: () => {
      if (practiceIndex < practiceQuestions.length - 1) {
        handleNextQuestion();
      }
    },
    onSwipeRight: () => {
      if (practiceIndex > 0) {
        handlePrevQuestion();
      }
    },
    threshold: 50,
  });

  const handleToggleCommon = (question: Question) => {
    const newCommon = commonQuestions.find(q => q.id === question.id)
      ? commonQuestions.filter(q => q.id !== question.id)
      : [...commonQuestions, question];
    setCommonQuestions(newCommon);
    savePracticeData(wrongQuestions, favoriteQuestions, newCommon);
  };

  const getModeTitle = () => {
    switch (practiceMode) {
      case 'sequential': return '顺序练题';
      case 'wrong': return '错题练习';
      case 'favorites': return '收藏';
      case 'common': return '收藏';
      case 'view': return '看题模式';
      default: return '练习';
    }
  };

  const currentQuestion = practiceQuestions[practiceIndex];
  const isViewMode = practiceMode === 'view';

  if (!bank) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-gray-500 dark:text-gray-400 mb-4">题库不存在</p>
          <button onClick={handleGoBack} className="px-4 py-2 bg-blue-500 text-white rounded-lg">返回</button>
        </div>
      </div>
    );
  }

  if (practiceQuestions.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
        <header className="sticky top-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors">
          <div className="max-w-lg mx-auto px-4 pt-1 pb-1 flex items-center justify-between">
            <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-lg font-semibold">{getModeTitle()}</h1>
            <div className="w-8 h-8" />
          </div>
        </header>
        <div className="max-w-lg mx-auto px-4 py-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">暂无题目</p>
        </div>
      </div>
    );
  }

  const renderQuestionContent = () => {
    if (!currentQuestion) return null;
    const currentAnswer = getAnswer(currentQuestion.id);
    const result = getResult(currentQuestion.id);
    const isConfirmed = result?.isConfirmed || false;

    return (
      <div className="space-y-4">
        <div className="text-lg font-medium text-gray-800 dark:text-gray-100 selectable">{currentQuestion.content}</div>

        {currentQuestion.type === 'single-choice' && currentQuestion.options && (
          <div className="space-y-2">
            {currentQuestion.options.map((option) => {
              const isSelected = currentAnswer === option.id;
              const isCorrect = currentQuestion.correctAnswer === option.id;
              let bgClass = 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700';
              let textClass = 'text-gray-800 dark:text-gray-100';
              if (isViewMode) {
                if (isCorrect) bgClass = 'bg-green-50 border-green-500 dark:bg-green-900/30 dark:border-green-500';
              } else if (isConfirmed) {
                if (isCorrect) bgClass = 'bg-green-50 border-green-500 dark:bg-green-900/30 dark:border-green-500';
                else if (isSelected && !isCorrect) bgClass = 'bg-red-50 border-red-500 dark:bg-red-900/30 dark:border-red-500';
              } else if (isSelected) {
                bgClass = 'bg-blue-50 border-blue-500 dark:bg-blue-900/30 dark:border-blue-500';
              }
              return (
                <button
                  key={option.id}
                  onClick={() => !isConfirmed && !isViewMode && setAnswer(currentQuestion.id, option.id)}
                  disabled={isViewMode || isConfirmed}
                  className={`w-full p-3 rounded-lg text-left border-2 transition-all ${textClass} ${bgClass}`}
                >
                  <span className="font-medium mr-2">{option.id}.</span>
                  <span className="selectable">{option.content}</span>
                </button>
              );
            })}
          </div>
        )}

        {currentQuestion.type === 'multiple-choice' && currentQuestion.options && (
          <div className="space-y-2">
            {currentQuestion.options.map((option) => {
              const selected = (currentAnswer as string[]) || [];
              const isSelected = selected.includes(option.id);
              const correct = currentQuestion.correctAnswer as string[];
              const isCorrect = correct.includes(option.id);
              let bgClass = 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700';
              let textClass = 'text-gray-800 dark:text-gray-100';
              if (isViewMode) {
                if (isCorrect) bgClass = 'bg-green-50 border-green-500 dark:bg-green-900/30 dark:border-green-500';
              } else if (isConfirmed) {
                if (isCorrect) bgClass = 'bg-green-50 border-green-500 dark:bg-green-900/30 dark:border-green-500';
                else if (isSelected && !isCorrect) bgClass = 'bg-red-50 border-red-500 dark:bg-red-900/30 dark:border-red-500';
              } else if (isSelected) {
                bgClass = 'bg-blue-50 border-blue-500 dark:bg-blue-900/30 dark:border-blue-500';
              }
              return (
                <button
                  key={option.id}
                  onClick={() => {
                    if (isConfirmed || isViewMode) return;
                    const newSelected = isSelected
                      ? selected.filter(id => id !== option.id)
                      : [...selected, option.id];
                    setAnswer(currentQuestion.id, newSelected);
                  }}
                  disabled={isViewMode || isConfirmed}
                  className={`w-full p-3 rounded-lg text-left border-2 transition-all ${textClass} ${bgClass}`}
                >
                  <span className="font-medium mr-2">{option.id}.</span>
                  <span className="selectable">{option.content}</span>
                </button>
              );
            })}
          </div>
        )}

        {currentQuestion.type === 'fill-in-blank' && (
          <div className="space-y-2">
            {isViewMode ? (
              <div className="p-4 bg-green-50 border-2 border-green-500 rounded-lg dark:bg-green-900/30 dark:border-green-500">
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
                <div className="text-gray-800 dark:text-gray-100">
                  {(() => {
                    const answer = currentQuestion.correctAnswer;
                    if (typeof answer === 'object' && answer !== null && 'text' in answer) {
                      return answer.text as string;
                    }
                    if (Array.isArray(answer)) {
                      return answer.join('、');
                    }
                    return String(answer);
                  })()}
                </div>
              </div>
            ) : (
              Array.isArray(currentQuestion.correctAnswer) && currentQuestion.correctAnswer.map((correctAns, idx) => {
                const userAnswer = (currentAnswer as string[])?.[idx] || '';
                const hasInput = userAnswer.trim().length > 0;
                const allowDisorder = currentQuestion.allowDisorder ?? false;
                
                let isMatch = false;
                if (allowDisorder) {
                  const correctAnswers = currentQuestion.correctAnswer as string[];
                  const trimmedUserAnswer = userAnswer.trim();
                  isMatch = correctAnswers.some(ans => String(ans).trim() === trimmedUserAnswer);
                } else {
                  isMatch = userAnswer.trim() === String(correctAns).trim();
                }
                
                let inputClass = 'w-full p-3 border-2 border-transparent rounded-lg text-gray-800 dark:text-gray-100 dark:placeholder-gray-400 transition-colors duration-300 outline-none focus:border-blue-300 focus:outline-none';
                
                if (isConfirmed) {
                  // 提交后根据当前空是否匹配显示颜色
                  if (isMatch) {
                    inputClass += ' border-green-500 bg-green-50 dark:bg-green-900/30 dark:border-green-500';
                  } else {
                    inputClass += ' border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-500';
                  }
                } else if (hasInput) {
                  if (isMatch) {
                    inputClass += ' border-green-500 bg-green-50 dark:bg-green-900/30 dark:border-green-500';
                  } else {
                    inputClass += ' border-orange-400 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-500';
                  }
                } else {
                  inputClass += ' bg-gray-100 dark:bg-gray-700';
                }
                
                return (
                  <input
                    key={idx}
                    type="text"
                    value={userAnswer}
                    onChange={(e) => {
                      const answers = (currentAnswer as string[]) || [];
                      const newAnswers = [...answers];
                      newAnswers[idx] = e.target.value;
                      setAnswer(currentQuestion.id, newAnswers);
                    }}
                    disabled={isConfirmed}
                    placeholder={`第${idx + 1}空`}
                    className={inputClass}
                  />
                );
              })
            )}
          </div>
        )}

        {currentQuestion.type === 'subjective' && (
          isViewMode ? (
            <div className="p-4 bg-green-50 border-2 border-green-500 rounded-lg dark:bg-green-900/30 dark:border-green-500">
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
              <div className="text-gray-800 dark:text-gray-100">
                {typeof currentQuestion.correctAnswer === 'object' && currentQuestion.correctAnswer !== null && 'text' in currentQuestion.correctAnswer
                  ? (currentQuestion.correctAnswer as any).text
                  : currentQuestion.correctAnswer}
              </div>
            </div>
          ) : (() => {
            const userAnswer = currentAnswer as string || '';
            const hasInput = userAnswer.trim().length > 0;
            
            let textareaClass = 'w-full p-3 border-2 border-transparent rounded-lg text-gray-800 dark:text-gray-100 dark:placeholder-gray-400 transition-colors duration-300 outline-none focus:border-blue-300 focus:outline-none';
            
            if (isConfirmed) {
              if (result?.isCorrect) {
                textareaClass += ' border-green-500 bg-green-50 dark:bg-green-900/30 dark:border-green-500';
              } else {
                textareaClass += ' border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-500';
              }
            } else if (hasInput) {
              textareaClass += ' border-orange-400 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-500';
            } else {
              textareaClass += ' bg-gray-100 dark:bg-gray-700';
            }
            
            return (
              <textarea
                value={userAnswer}
                onChange={(e) => setAnswer(currentQuestion.id, e.target.value)}
                disabled={isConfirmed}
                placeholder="请输入答案"
                rows={4}
                className={textareaClass}
              />
            );
          })()
        )}

        {isViewMode && currentQuestion.explanation && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg dark:bg-gray-800">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">解析: </span>
              {currentQuestion.explanation}
            </div>
          </div>
        )}

        {!isViewMode && showAnswer && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg dark:bg-gray-800">
            <div className="flex items-center gap-2 mb-2">
              {(() => {
                if (!isConfirmed) {
                  return <span className="text-gray-600 dark:text-gray-300 font-medium">未作答</span>;
                }
                return result?.isCorrect ? (
                  <span className="text-green-600 dark:text-green-400 font-medium">✓ 正确</span>
                ) : (
                  <span className="text-red-600 dark:text-red-400 font-medium">✗ 错误</span>
                );
              })()}
              {isConfirmed && <span className="text-gray-500 dark:text-gray-400">得分: {result?.score}/{currentQuestion.score}</span>}
            </div>
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
            <div className="text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">参考答案: </span>
              {Array.isArray(currentQuestion.correctAnswer)
                ? currentQuestion.correctAnswer.join(', ')
                : typeof currentQuestion.correctAnswer === 'object'
                  ? (currentQuestion.correctAnswer as any).text
                  : currentQuestion.correctAnswer}
            </div>
            {currentQuestion.explanation && (
              <div className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                <span className="font-medium">解析: </span>
                {currentQuestion.explanation}
              </div>
            )}
            {(result?.aiFeedback || result?.aiExplanation) && (
              <div className={`mt-4 p-3 rounded-lg border ${
                result?.gradingMode === 'ai'
                  ? 'bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-700'
                  : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <svg className={`w-4 h-4 ${
                    result?.gradingMode === 'ai' ? 'text-purple-600 dark:text-purple-400' : 'text-gray-600 dark:text-gray-400'
                  }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span className={`text-sm font-medium ${
                    result?.gradingMode === 'ai' ? 'text-purple-700 dark:text-purple-400' : 'text-gray-700 dark:text-gray-400'
                  }`}>
                    {result?.gradingMode === 'ai' ? 'AI 智能判题解析' : '判题解析'}
                  </span>
                </div>
                {result?.aiExplanation ? (
                  <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{result.aiExplanation}</div>
                ) : (
                  <div className="text-sm text-gray-700 dark:text-gray-300">{result?.aiFeedback}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header flex flex-col">
      <header 
        className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors flex-shrink-0"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="max-w-lg mx-auto px-4 pt-1 pb-1 flex items-center justify-between">
          <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-lg font-semibold">{getModeTitle()}</h1>
          <div className="w-8 h-8" />
        </div>
      </header>

      <div ref={swipeRef} className="flex-1 overflow-y-auto touch-pan-y">
        <div 
          className={`max-w-lg mx-auto px-4 py-4 transition-all duration-300 ${isKeyboardOpen ? 'pb-24' : 'pb-40'}`}
          style={{ paddingTop: safeArea.top + 48 }}
        >
          {renderQuestionContent()}
        </div>
      </div>

      <div 
        className="fixed left-0 right-0 bg-white border-t border-gray-200 p-2 dark:bg-gray-800 dark:border-gray-700 transition-all duration-300"
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
            {practiceQuestions.map((q, idx) => {
              const result = getResult(q.id);
              const isConfirmed = result?.isConfirmed;
              return (
                <button
                  key={q.id}
                  onClick={() => handleGoToQuestion(idx)}
                  className={`w-8 h-8 rounded text-xs font-medium flex-shrink-0 ${
                    idx === practiceIndex
                      ? 'bg-blue-500 text-white'
                      : isConfirmed
                        ? result?.isCorrect
                          ? 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400'
                          : 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400'
                        : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between items-center gap-2 mb-1">
            <button onClick={handlePrevQuestion} disabled={practiceIndex === 0} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200">上一题</button>
            <div className="flex items-center gap-2">
              <button onClick={() => currentQuestion && handleToggleCommon(currentQuestion)} className={`px-3 py-2 rounded-lg ${commonQuestions.find(q => q.id === currentQuestion?.id) ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/50 dark:text-yellow-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>
                <svg className="w-5 h-5" fill={commonQuestions.find(q => q.id === currentQuestion?.id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              </button>
            </div>
            {(!isViewMode && !getResult(currentQuestion?.id || '')?.isConfirmed) ? (
              <button
                onClick={handleConfirmAnswer}
                className="px-4 py-2 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors"
              >
                提交
              </button>
            ) : (
              <button onClick={handleNextQuestion} disabled={practiceIndex === practiceQuestions.length - 1} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200">下一题</button>
            )}
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
};

export default Practice;

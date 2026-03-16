import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { useExamStore } from '../store/examStore';
import { useRecordStore } from '../store/recordStore';
import { useSettingsStore } from '../store/settingsStore';

import { Question } from '../types';
import ConfirmModal from '../components/ConfirmModal';
import { useSwipeElement } from '../hooks/useSwipe';
import { useSafeArea } from '../hooks/useSafeArea';
import { useKeyboard } from '../hooks/useKeyboard';

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const GradingText: React.FC<{ 
  isConnecting: boolean; 
  isProcessing: boolean; 
  isGenerating: boolean;
  progressText?: string;
}> = ({ 
  isConnecting, 
  isProcessing, 
  isGenerating,
  progressText
}) => {
  const [displayText, setDisplayText] = React.useState('正在准备判题...');
  const [isAnimating, setIsAnimating] = React.useState(false);

  React.useEffect(() => {
    let text = '';
    if (progressText) {
      // 优先显示进度文字（如"已解析5题"）
      text = progressText;
    } else if (isConnecting) {
      text = '正在连接AI服务...';
    } else if (isProcessing) {
      text = '正在智能判题中...';
    } else if (isGenerating) {
      text = '正在生成判题结果...';
    } else {
      text = '正在准备判题...';
    }
    
    setDisplayText(text);
    setIsAnimating(true);
    
    const timer = setTimeout(() => setIsAnimating(false), 200);
    return () => clearTimeout(timer);
  }, [isConnecting, isProcessing, isGenerating, progressText]);

  return (
    <p className={`text-sm font-medium text-blue-700 dark:text-blue-300 transition-all duration-200 ${isAnimating ? 'opacity-0' : 'opacity-100'}`}>
      {displayText}
    </p>
  );
};

const Exam: React.FC = () => {
  const { bankId } = useParams<{ bankId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getBank } = useQuestionBankStore();
  const { startExam, examState, setAnswer, getAnswer, nextQuestion, prevQuestion, goToQuestion, getCurrentQuestion, resetExam, finishExam, setResult } = useExamStore();
  const { addRecord } = useRecordStore();

  const [examStartTime, setExamStartTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitType, setSubmitType] = useState<'partial' | 'complete' | null>(null);
  const [isGrading, setIsGrading] = useState(false);
  const [gradingPhase, setGradingPhase] = useState<'connecting' | 'processing' | 'generating'>('connecting');
  const [progressText, setProgressText] = useState<string>('');
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<HTMLDivElement>(null);
  const safeArea = useSafeArea();
  const { isOpen: isKeyboardOpen, height: keyboardHeight } = useKeyboard();

  const bank = getBank(bankId!);

  useEffect(() => {
    if (bank && bank.questions.length > 0) {
      const shuffledQuestions = shuffleArray(bank.questions);
      startExam(bank.id, bank.name, shuffledQuestions);
      setExamStartTime(Date.now());
      setElapsedTime(0);
    }
  }, [bank, startExam]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (examState && !examState.isFinished && examStartTime > 0) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - examStartTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [examState?.isFinished, examStartTime]);

  useEffect(() => {
    if (navRef.current && examState) {
      const currentBtn = navRef.current.children[examState.currentIndex] as HTMLElement;
      if (currentBtn) {
        currentBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [examState?.currentIndex]);

  useSwipeElement(swipeRef, {
    onSwipeLeft: () => {
      if (examState && examState.currentIndex < examState.questions.length - 1) {
        nextQuestion();
      }
    },
    onSwipeRight: () => {
      if (examState && examState.currentIndex > 0) {
        prevQuestion();
      }
    },
    threshold: 50,
  });

  const handleGoBack = () => {
    setShowExitConfirm(true);
  };

  const handleExitConfirm = () => {
    resetExam();
    if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const handleExitCancel = () => {
    setShowExitConfirm(false);
  };

  const handleFinishExam = () => {
    const answeredCount = examState?.answers.size || 0;
    const totalCount = examState?.questions.length || 0;
    const unansweredCount = totalCount - answeredCount;

    if (unansweredCount > 0) {
      setSubmitType('partial');
    } else {
      setSubmitType('complete');
    }
    setShowSubmitConfirm(true);
  };

  const handleSubmitConfirm = async () => {
    setShowSubmitConfirm(false);
    setIsGrading(true);
    setGradingPhase('connecting');
    setProgressText('');
    
    // 清除之前的定时器
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    
    try {
      const questions = examState?.questions || [];
      
      // 短暂显示连接状态，然后进入处理状态
      setTimeout(() => setGradingPhase('processing'), 500);
      
      // 使用 finishExam 进行批量判题（包含快速预检和批量AI判题）
      // 传入进度回调函数，实时更新已解析题数
      // 传入 onQuestionGraded 回调，每道题判题完成后立即更新状态
      const userAnswers = await finishExam(
        true, 
        (current, total) => {
          setProgressText(`已解析 ${current}/${total} 题`);
          
          // 清除之前的定时器
          if (progressTimerRef.current) {
            clearTimeout(progressTimerRef.current);
          }
          
          // 1.5秒后恢复到默认状态文字
          progressTimerRef.current = setTimeout(() => {
            setProgressText('');
          }, 1500);
        },
        (questionId, result) => {
          // 每道题判题完成后立即更新到 store
          setResult(questionId, result);
        }
      );
      
      // 清除最后的定时器
      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      
      // 判题完成，进入生成结果状态
      setGradingPhase('generating');
      
      const maxScore = questions.reduce((sum, q) => sum + q.score, 0) || 0;
      
      const wrongQuestionsInExam: Question[] = [];
      userAnswers.forEach((answer) => {
        const hasAnswered = answer.answer !== '' && 
          (!Array.isArray(answer.answer) || answer.answer.length > 0);
        if (hasAnswered && !answer.isCorrect) {
          const question = questions.find(q => q.id === answer.questionId);
          if (question) {
            wrongQuestionsInExam.push(question);
          }
        }
      });
      
      if (wrongQuestionsInExam.length > 0) {
        const stored = localStorage.getItem('practice-data-global');
        let existingWrong: Question[] = [];
        if (stored) {
          try {
            const data = JSON.parse(stored);
            existingWrong = data.wrongQuestions || [];
          } catch {}
        }
        
        const mergedWrong = [...existingWrong];
        wrongQuestionsInExam.forEach(q => {
          if (!mergedWrong.find(existing => existing.id === q.id)) {
            mergedWrong.push(q);
          }
        });
        
        const storedData = stored ? JSON.parse(stored) : {};
        localStorage.setItem('practice-data-global', JSON.stringify({
          ...storedData,
          wrongQuestions: mergedWrong
        }));
      }
      
      const recordId = addRecord(
        examState?.bankId || '',
        examState?.bankName || '',
        questions,
        userAnswers,
        elapsedTime,
        maxScore,
        useSettingsStore.getState().gradingMode
      );
      resetExam();
      navigate(`/result/${recordId}`);
    } finally {
      setIsGrading(false);
      setGradingPhase('connecting');
    }
  };

  if (!bank) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-gray-500 dark:text-gray-400 mb-4">题库不存在</p>
          <button onClick={() => navigate('/')} className="px-4 py-2 bg-blue-500 text-white rounded-lg">返回首页</button>
        </div>
      </div>
    );
  }

  if (bank.questions.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-gray-500 dark:text-gray-400 mb-4">题库中没有题目</p>
          <button onClick={() => navigate('/')} className="px-4 py-2 bg-blue-500 text-white rounded-lg">返回首页</button>
        </div>
      </div>
    );
  }

  const currentQuestion = getCurrentQuestion();
  const minutes = Math.floor(elapsedTime / 60);
  const seconds = elapsedTime % 60;

  if (!examState || !currentQuestion) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">加载中...</p>
      </div>
    );
  }

  const renderQuestionContent = () => {
    const currentAnswer = getAnswer(currentQuestion.id);
    const currentResult = examState.results.get(currentQuestion.id);

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

        {/* 显示判题结果 */}
        {currentResult && (
          <div className={`p-4 rounded-lg border-2 ${
            currentResult.isCorrect === 2 
              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700' 
              : currentResult.isCorrect === 1
                ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-700'
                : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`font-bold ${
                currentResult.isCorrect === 2 
                  ? 'text-green-700 dark:text-green-400' 
                  : currentResult.isCorrect === 1
                    ? 'text-yellow-700 dark:text-yellow-400'
                    : 'text-red-700 dark:text-red-400'
              }`}>
                {currentResult.isCorrect === 2 ? '✓ 正确' : currentResult.isCorrect === 1 ? '◐ 部分正确' : '✗ 错误'}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                得分: {currentResult.score}/{currentQuestion.score}
              </span>
            </div>
            
            {/* 逐空结果（填空题） */}
            {currentResult.blankResults && currentResult.blankResults.length > 0 && (
              <div className="space-y-1 mb-3">
                {currentResult.blankResults.map((blank, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                      blank.isCorrect 
                        ? 'bg-green-100 text-green-600 dark:bg-green-900/50' 
                        : 'bg-red-100 text-red-600 dark:bg-red-900/50'
                    }`}>
                      {blank.isCorrect ? '✓' : '✗'}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">第{idx + 1}空:</span>
                    <span className="text-gray-800 dark:text-gray-200">{blank.userAnswer || '(未填写)'}</span>
                  </div>
                ))}
              </div>
            )}
            
            {/* AI 解析 */}
            {currentResult.aiExplanation && (
              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{currentResult.aiExplanation}</div>
              </div>
            )}
            
            {/* 判题模式标识 */}
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-500">
              判题方式: {currentResult.gradingMode === 'ai' ? 'AI智能判题' : currentResult.gradingMode === 'ai-fallback' ? 'AI降级判题' : '固定规则判题'}
            </div>
          </div>
        )}

        {currentQuestion.type === 'single-choice' && currentQuestion.options && (
          <div className="space-y-2">
            {currentQuestion.options.map((option) => {
              const isSelected = currentAnswer === option.id;
              let bgClass = 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700';
              if (isSelected) bgClass = 'bg-blue-50 border-blue-500 dark:bg-blue-900/30 dark:border-blue-400';
              return (
                <button
                  key={option.id}
                  onClick={() => !isGrading && setAnswer(currentQuestion.id, option.id)}
                  disabled={isGrading}
                  className={`w-full p-3 rounded-lg text-left border-2 transition-all text-gray-800 dark:text-gray-200 ${bgClass} ${isGrading ? 'cursor-not-allowed opacity-70' : ''}`}
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
              let bgClass = 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700';
              if (isSelected) bgClass = 'bg-blue-50 border-blue-500 dark:bg-blue-900/30 dark:border-blue-400';
              return (
                <button
                  key={option.id}
                  onClick={() => {
                    if (isGrading) return;
                    const newSelected = isSelected
                      ? selected.filter(id => id !== option.id)
                      : [...selected, option.id];
                    setAnswer(currentQuestion.id, newSelected);
                  }}
                  disabled={isGrading}
                  className={`w-full p-3 rounded-lg text-left border-2 transition-all text-gray-800 dark:text-gray-200 ${bgClass} ${isGrading ? 'cursor-not-allowed opacity-70' : ''}`}
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
            {Array.isArray(currentQuestion.correctAnswer) && currentQuestion.correctAnswer.map((_, idx) => (
              <input
                key={idx}
                type="text"
                value={(currentAnswer as string[])?.[idx] || ''}
                onChange={(e) => {
                  if (isGrading) return;
                  const answers = (currentAnswer as string[]) || [];
                  const newAnswers = [...answers];
                  newAnswers[idx] = e.target.value;
                  setAnswer(currentQuestion.id, newAnswers);
                }}
                disabled={isGrading}
                placeholder={`空 ${idx + 1}`}
                className={`w-full p-3 border-2 border-transparent rounded-lg bg-gray-100 dark:bg-gray-700 focus:border-blue-300 focus:outline-none text-gray-800 dark:text-gray-200 transition-colors duration-300 ${isGrading ? 'cursor-not-allowed opacity-70' : ''}`}
              />
            ))}
          </div>
        )}

        {currentQuestion.type === 'subjective' && (
          <textarea
            value={currentAnswer as string || ''}
            onChange={(e) => !isGrading && setAnswer(currentQuestion.id, e.target.value)}
            disabled={isGrading}
            placeholder="请输入答案"
            rows={4}
            className={`w-full p-3 border-2 border-transparent rounded-lg bg-gray-100 dark:bg-gray-700 focus:border-blue-300 focus:outline-none text-gray-800 dark:text-gray-200 transition-colors duration-300 ${isGrading ? 'cursor-not-allowed opacity-70' : ''}`}
          />
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
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">{examState.currentIndex + 1}/{examState.questions.length}</span>
            <span className="text-sm font-medium">{minutes}:{seconds.toString().padStart(2, '0')}</span>
          </div>
          <button onClick={handleFinishExam} disabled={isGrading} className={`px-3 py-1.5 text-white text-sm rounded-lg font-medium transition-colors ${isGrading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'}`}>交卷</button>
        </div>
      </header>

      <div ref={swipeRef} className="flex-1 overflow-y-auto touch-pan-y">
        <div 
          className={`max-w-lg mx-auto px-4 py-4 transition-all duration-300 ${isKeyboardOpen ? 'pb-32' : 'pb-24'}`}
          style={{ paddingTop: safeArea.top + 48 }}
        >
          {isGrading && (
            <div className="mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg overflow-hidden relative">
              {/* 动态扫描效果 */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-200/50 to-transparent dark:via-blue-500/30 w-full h-full animate-scan" />
              <div className="relative z-10 flex items-center justify-center gap-2">
                {/* 加载动画点 */}
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <GradingText 
                  isConnecting={gradingPhase === 'connecting'} 
                  isProcessing={gradingPhase === 'processing'} 
                  isGenerating={gradingPhase === 'generating'} 
                  progressText={progressText}
                />
              </div>
            </div>
          )}
          {renderQuestionContent()}
        </div>
      </div>

      <div 
        className="fixed left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-2 transition-all duration-300"
        style={{ 
          bottom: isKeyboardOpen ? keyboardHeight : 0,
          paddingBottom: safeArea.bottom 
        }}
      >
        <div className="max-w-lg mx-auto">
          {/* 题号导航 */}
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
            {examState.questions.map((q, idx) => {
              const hasAnswer = examState.answers.has(q.id);
              return (
                <button
                  key={q.id}
                  onClick={() => goToQuestion(idx)}
                  className={`w-8 h-8 rounded text-xs font-medium flex-shrink-0 ${
                    idx === examState.currentIndex
                      ? 'bg-blue-500 text-white'
                      : hasAnswer
                        ? 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400'
                        : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
          
          {/* 快捷切题按钮 */}
          <div className="flex justify-between items-center gap-2 mb-1">
            <button 
              onClick={prevQuestion} 
              disabled={examState.currentIndex === 0} 
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50"
            >
              上一题
            </button>
            <button 
              onClick={nextQuestion} 
              disabled={examState.currentIndex === examState.questions.length - 1} 
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50"
            >
              下一题
            </button>
          </div>
        </div>
      </div>

      {showExitConfirm && (
        <ConfirmModal
          message="确定要退出考试吗？"
          onConfirm={handleExitConfirm}
          onCancel={handleExitCancel}
          confirmText="退出"
          cancelText="继续答题"
          type="warning"
        />
      )}

      {showSubmitConfirm && (
        <ConfirmModal
          message={submitType === 'partial' ? `您还有部分题目未作答，确定要交卷吗？` : `您已答完所有题目，确定要提交吗？`}
          onConfirm={handleSubmitConfirm}
          onCancel={() => setShowSubmitConfirm(false)}
          confirmText="交卷"
          cancelText="继续答题"
          type={submitType === 'partial' ? 'warning' : 'info'}
        />
      )}
    </div>
  );
};

export default Exam;

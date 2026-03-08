import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { useExamStore } from '../store/examStore';
import { useRecordStore } from '../store/recordStore';
import { Question } from '../types';
import ConfirmModal from '../components/ConfirmModal';

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const Exam: React.FC = () => {
  const { bankId } = useParams<{ bankId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getBank } = useQuestionBankStore();
  const { startExam, examState, setAnswer, getAnswer, nextQuestion, prevQuestion, goToQuestion, finishExam, getCurrentQuestion, resetExam } = useExamStore();
  const { addRecord } = useRecordStore();

  const [examStartTime, setExamStartTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitType, setSubmitType] = useState<'partial' | 'complete' | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

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
    let interval: NodeJS.Timeout;
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

  const handleSubmitConfirm = () => {
    setShowSubmitConfirm(false);
    const answers = finishExam();
    const maxScore = examState?.questions.reduce((sum, q) => sum + q.score, 0) || 0;
    
    const wrongQuestionsInExam: Question[] = [];
    answers.forEach((answer) => {
      const hasAnswered = answer.answer !== '' && 
        (!Array.isArray(answer.answer) || answer.answer.length > 0);
      if (hasAnswered && !answer.isCorrect) {
        const question = examState?.questions.find(q => q.id === answer.questionId);
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
      examState?.questions || [],
      answers,
      elapsedTime,
      maxScore
    );
    resetExam();
    navigate(`/result/${recordId}`);
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
              const isSelected = currentAnswer === option.id;
              let bgClass = 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700';
              if (isSelected) bgClass = 'bg-blue-50 border-blue-500 dark:bg-blue-900/30 dark:border-blue-400';
              return (
                <button
                  key={option.id}
                  onClick={() => setAnswer(currentQuestion.id, option.id)}
                  className={`w-full p-3 rounded-lg text-left border-2 transition-all text-gray-800 dark:text-gray-200 ${bgClass}`}
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
                    const newSelected = isSelected
                      ? selected.filter(id => id !== option.id)
                      : [...selected, option.id];
                    setAnswer(currentQuestion.id, newSelected);
                  }}
                  className={`w-full p-3 rounded-lg text-left border-2 transition-all text-gray-800 dark:text-gray-200 ${bgClass}`}
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
                  const answers = (currentAnswer as string[]) || [];
                  const newAnswers = [...answers];
                  newAnswers[idx] = e.target.value;
                  setAnswer(currentQuestion.id, newAnswers);
                }}
                placeholder={`空 ${idx + 1}`}
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-800 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600"
              />
            ))}
          </div>
        )}

        {currentQuestion.type === 'subjective' && (
          <textarea
            value={currentAnswer as string || ''}
            onChange={(e) => setAnswer(currentQuestion.id, e.target.value)}
            placeholder="请输入答案"
            rows={4}
            className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-800 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600"
          />
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 safe-header">
      <header className="bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">{examState.currentIndex + 1}/{examState.questions.length}</span>
            <span className="text-sm font-medium">{minutes}:{seconds.toString().padStart(2, '0')}</span>
          </div>
          <button onClick={handleFinishExam} className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg font-medium hover:bg-orange-600 transition-colors">交卷</button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 pb-24">
        {renderQuestionContent()}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
        <div className="max-w-lg mx-auto">
          <div className="flex justify-between gap-2">
            <button onClick={prevQuestion} disabled={examState.currentIndex === 0} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50">上一题</button>
            <div 
              ref={navRef} 
              className="flex gap-1 overflow-x-auto max-w-[200px] py-1 scrollbar-hide" 
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
            <button onClick={nextQuestion} disabled={examState.currentIndex === examState.questions.length - 1} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50">下一题</button>
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

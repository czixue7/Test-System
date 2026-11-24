import React, { useState, useEffect, useRef } from 'react';
import { useBackNavigation } from '../hooks/useBackNavigation';
import QuestionStem from '../components/QuestionStem';
import QuestionWorkspace from '../components/QuestionWorkspace';
import QuestionFields from '../components/QuestionFields';
import GradingResultCard from '../components/GradingResultCard';
import ImageViewer from '../components/ImageViewer';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { useExamStore, SavedProgress } from '../store/examStore';
import { useRecordStore } from '../store/recordStore';
import { useSettingsStore } from '../store/settingsStore';

import { Question } from '../types';
import ConfirmModal from '../components/ConfirmModal';
import ExitConfirmModal from '../components/ExitConfirmModal';
import ResumePromptModal from '../components/ResumePromptModal';
import { useSwipeElement } from '../hooks/useSwipe';
import { useToast } from '../hooks/useToast';
import { isEmptyAnswer } from '../utils/answerUtils';

const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * 把「当前答案」统一成数组再按下标读写。
 * 历史缺陷：直接写 `(currentAnswer as string[])?.[idx]`，
 * 当 currentAnswer 实际是字符串时会取到**单个字符**。
 */

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
  const { getBank } = useQuestionBankStore();
  const { startExam, examState, setAnswer, getAnswer, nextQuestion, prevQuestion, goToQuestion, getCurrentQuestion, resetExam, finishExam, setResult, loadExamProgress, saveExamProgress, restoreExamProgress, clearExamProgress } = useExamStore();
  const { addRecord } = useRecordStore();
  const { showError } = useToast();

  const [isInitialized, setIsInitialized] = useState(false);
  // 开启「避免重复做题」后，题库里已没有未做过的题
  const [isBankExhausted, setIsBankExhausted] = useState(false);
  const [examStartTime, setExamStartTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitType, setSubmitType] = useState<'partial' | 'complete' | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumeData, setResumeData] = useState<SavedProgress | null>(null);
  const [isGrading, setIsGrading] = useState(false);
  const [gradingPhase, setGradingPhase] = useState<'connecting' | 'processing' | 'generating'>('connecting');
  const [progressText, setProgressText] = useState<string>('');
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 判题期间用户选择「不保存退出」时置位，避免判题结束后仍写入记录并强行跳转
  const cancelledRef = useRef(false);
  const [viewer, setViewer] = useState<{ images: string[]; index: number; rect: DOMRect } | null>(null);
  const openImages = (images: string[], index: number, rect: DOMRect) => setViewer({ images, index, rect });
  const swipeRef = useRef<HTMLDivElement>(null);

  const bank = getBank(bankId!);

  useEffect(() => {
    if (bank && bank.questions.length > 0 && !isInitialized) {
      const init = async () => {
        // 检查是否存在本题库的考试进度
        const saved = await loadExamProgress();
        if (saved && saved.mode === 'exam' && saved.bankId === bank.id) {
          // 匹配：立即完整恢复（题目、位置、答案、计时器），弹窗询问继续/重新开始
          await restoreExamProgress(saved);
          setExamStartTime(Date.now() - saved.elapsedTime * 1000);
          setElapsedTime(saved.elapsedTime);
          setResumeData(saved);
          setShowResumePrompt(true);
          setIsInitialized(true);
          return;
        }
        // 无进度，正常开始：按设置跳过已做过的题，并限制每轮题量
        const { avoidRepeatQuestions, questionsPerRound, doneQuestionIds } = useSettingsStore.getState();
        const doneSet = new Set(avoidRepeatQuestions ? (doneQuestionIds[bank.id] ?? []) : []);
        const pool = avoidRepeatQuestions
          ? bank.questions.filter(q => !doneSet.has(q.id))
          : [...bank.questions];
        if (pool.length === 0) {
          setIsBankExhausted(true);
          setIsInitialized(true);
          return;
        }
        const shuffledQuestions = shuffleArray(pool).slice(0, questionsPerRound);
        startExam(bank.id, bank.name, shuffledQuestions);
        setExamStartTime(Date.now());
        setElapsedTime(0);
        setIsInitialized(true);
      };
      init();
    }
  }, [bank, startExam, isInitialized, loadExamProgress, restoreExamProgress]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (examState && !examState.isFinished && examStartTime > 0 && !showResumePrompt) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - examStartTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [examState?.isFinished, examStartTime, showResumePrompt]);

  // 卸载时清理判题相关的定时器（避免对已卸载组件 setState）
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    };
  }, []);

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

  const goBack = useBackNavigation('/');

  const handleSaveAndExit = async () => {
    await saveExamProgress('exam', elapsedTime);
    goBack();
  };

  const handleExitWithoutSave = async () => {
    cancelledRef.current = true;
    await clearExamProgress();
    resetExam();
    goBack();
  };

  const handleResumeProgress = () => {
    setShowResumePrompt(false);
    setResumeData(null);
  };

  const handleStartFresh = async () => {
    await clearExamProgress();
    setShowResumePrompt(false);
    setResumeData(null);
    setIsInitialized(false);
  };

  const handleFinishExam = () => {
    // 只有「真的填了内容」才算已作答：多选题取消全部选项会写入 []，
    // 主观题/填空题输入后再删空会写入 ''，这些都不该算作答。
    const answeredCount = examState
      ? examState.questions.filter((q) => !isEmptyAnswer(examState.answers.get(q.id))).length
      : 0;
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
    // 重入保护：弹窗关闭动画期间按钮仍可能被点到，
    // 双击会造成重复判题 + 生成两条记录（头部的 disabled 管不到弹窗按钮）
    if (isGrading) return;
    setShowSubmitConfirm(false);
    setIsGrading(true);
    setGradingPhase('connecting');
    setProgressText('');
    
    // 清除之前的定时器
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    
    try {
      const questions = examState?.questions || [];
      
      // 短暂显示连接状态，然后进入处理状态（保存句柄以便在 finally 中清理）
      phaseTimerRef.current = setTimeout(() => setGradingPhase('processing'), 500);
      
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

      // 用户在判题期间已选择「不保存退出」：不要再写记录、也不要把用户
      // 从首页强行拉回结果页
      if (cancelledRef.current) {
        console.warn('[Exam] 用户已在判题期间退出，跳过成绩写入');
        return;
      }
      
      const maxScore = questions.reduce((sum, q) => sum + q.score, 0) || 0;
      
      // 错题本更新属于「次要副作用」：即使 localStorage 里是脏数据或已超配额，
      // 也绝不能让异常冒泡出去 —— 否则 addRecord 与 navigate 都不会执行，
      // 用户交卷后看不到成绩、也没有任何提示，整场考试永远提交不了。
      try {
        const wrongQuestionsInExam: Question[] = [];
        userAnswers.forEach((answer) => {
          if (!isEmptyAnswer(answer.answer) && answer.isCorrect !== 2) {
            const question = questions.find(q => q.id === answer.questionId);
            if (question) {
              wrongQuestionsInExam.push(question);
            }
          }
        });

        if (wrongQuestionsInExam.length > 0) {
          // 只解析一次，且解析失败时安全降级为空对象
          let storedData: Record<string, unknown> = {};
          try {
            const stored = localStorage.getItem('practice-data-global');
            if (stored) {
              const parsed: unknown = JSON.parse(stored);
              if (parsed && typeof parsed === 'object') {
                storedData = parsed as Record<string, unknown>;
              }
            }
          } catch (e) {
            console.warn('[Exam] 错题本数据损坏，已忽略并重建:', e);
          }

          const existingWrong: Question[] = Array.isArray(storedData.wrongQuestions)
            ? (storedData.wrongQuestions as Question[])
            : [];

          const mergedWrong = [...existingWrong];
          wrongQuestionsInExam.forEach(q => {
            if (!mergedWrong.find(existing => existing.id === q.id)) {
              mergedWrong.push(q);
            }
          });

          try {
            localStorage.setItem('practice-data-global', JSON.stringify({
              ...storedData,
              wrongQuestions: mergedWrong
            }));
          } catch (e) {
            console.warn('[Exam] 写入错题本失败（可能是存储配额已满），不影响本次成绩保存:', e);
          }
        }
      } catch (e) {
        console.warn('[Exam] 更新错题本失败，已跳过:', e);
      }
      
      const recordId = await addRecord(
        examState?.bankId || '',
        examState?.bankName || '',
        questions,
        userAnswers,
        elapsedTime,
        maxScore,
        useSettingsStore.getState().gradingMode
      );
      // 记录这些题已考过，开启去重后下一场不再出现
      useSettingsStore.getState().markQuestionsDone(
        examState?.bankId || '',
        questions.map(q => q.id)
      );
      // 交卷成功，清除已保存的进度
      await clearExamProgress();
      resetExam();
      // 交卷后考试页已重置，用 replace 顶掉，结果页的返回键不会再回到一场已结束的考试
      navigate(`/result/${recordId}`, { replace: true });
    } catch (error) {
      // 之前这里只有 try/finally：任何异常都会让交卷静默失败
      // （无成绩、无跳转、无提示），用户只能「不保存退出」从而丢掉整场答案。
      console.error('[Exam] 交卷失败:', error);
      showError(
        error instanceof Error ? `交卷失败：${error.message}` : '交卷失败，请重试',
        5000
      );
    } finally {
      // 定时器必须在所有路径（含异常）上清理，
      // 否则 1.5s / 500ms 后仍会对已卸载组件 setState，判题很快时还会把
      // 已经设好的 'generating' 文案又改回 'processing'
      if (progressTimerRef.current) {
        clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (phaseTimerRef.current) {
        clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
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

  if (isBankExhausted) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            本题库的题目都已考过，已按设置跳过重复题目
          </p>
          <button
            onClick={() => {
              useSettingsStore.getState().resetDoneQuestions(bank.id);
              setIsBankExhausted(false);
              setIsInitialized(false);
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg mr-3"
          >
            重置已做记录并重新开始
          </button>
          <button onClick={() => navigate('/')} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg">
            返回首页
          </button>
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

  const answer = getAnswer(currentQuestion.id);
  const result = examState.results.get(currentQuestion.id);

  return (
    <>
      <QuestionWorkspace
        timer={`${minutes}:${seconds.toString().padStart(2, '0')}`}
        backLabel="返回"
        onBack={handleGoBack}
        headerAction={<button type="button" onClick={handleFinishExam} disabled={isGrading}
          className="rounded-lg bg-green-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-60">交卷</button>}
        index={examState.currentIndex}
        questions={examState.questions.map(question => ({
          id: question.id,
          tone: isEmptyAnswer(examState.answers.get(question.id)) ? 'idle' : 'answered',
        }))}
        onSelect={goToQuestion}
        contentRef={swipeRef}
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
        <div className="space-y-4">
          <QuestionStem question={currentQuestion} onImageClick={openImages} />
          <QuestionFields question={currentQuestion} answer={answer}
            onChange={isGrading ? undefined : value => setAnswer(currentQuestion.id, value)} />
          {result && <GradingResultCard question={currentQuestion} answer={answer} result={result}
            isConfirmed={!isEmptyAnswer(answer)} onOpenImages={openImages} />}
        </div>
      </QuestionWorkspace>
      {viewer && <ImageViewer images={viewer.images} initialIndex={viewer.index} sourceRect={viewer.rect}
        onClose={() => setViewer(null)} />}

      {showExitConfirm && (
        <ExitConfirmModal
          title="退出考试"
          message="退出后未保存的答题进度将丢失，是否保存当前进度？"
          onSave={handleSaveAndExit}
          onExitWithoutSave={handleExitWithoutSave}
          onCancel={() => setShowExitConfirm(false)}
        />
      )}

      {showResumePrompt && resumeData && (
        <ResumePromptModal
          mode="exam"
          currentQuestion={resumeData.currentIndex}
          totalQuestions={resumeData.questions.length}
          elapsedSeconds={resumeData.elapsedTime}
          onResume={handleResumeProgress}
          onRestart={handleStartFresh}
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
    </>
  );
};

export default Exam;

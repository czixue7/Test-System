import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useBackNavigation } from '../hooks/useBackNavigation';
import QuestionStem from '../components/QuestionStem';
import QuestionWorkspace from '../components/QuestionWorkspace';
import QuestionFields, { isChoiceQuestion, ReferenceAnswer } from '../components/QuestionFields';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { useExamStore, SavedProgress } from '../store/examStore';
import { useRecordStore } from '../store/recordStore';
import { useSettingsStore } from '../store/settingsStore';
import { Question, QuestionBank, PracticeMode, UserAnswer } from '../types';
import { useSwipeElement } from '../hooks/useSwipe';
import { useToast } from '../hooks/useToast';
import ImageViewer from '../components/ImageViewer';
import ExitConfirmModal from '../components/ExitConfirmModal';
import ResumePromptModal from '../components/ResumePromptModal';
import GradingResultCard from '../components/GradingResultCard';
import { isEmptyAnswer } from '../utils/answerUtils';

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
  const { getBank } = useQuestionBankStore();
  const { setAnswer, getAnswer, confirmAnswer, getResult, startExam, loadExamProgress, saveExamProgress, restoreExamProgress, clearExamProgress } = useExamStore();
  const { addRecord } = useRecordStore();
  const { markQuestionsDone, resetDoneQuestions } = useSettingsStore();
  const { showSuccess } = useToast();

  const [practiceQuestions, setPracticeQuestions] = useState<Question[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  // 顺序练题开启「避免重复做题」后，题库已无剩余题目
  const [isBankExhausted, setIsBankExhausted] = useState(false);
  // 一轮练习只能写一条测试记录（防止完成/退出两条路径重复写入）
  const roundRecordSavedRef = useRef(false);
  const [showAnswer, setShowAnswer] = useState(false);
  // 判题进行中（AI 判题可能数秒）：期间禁止切题，避免答案面板显示到别的题上
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 用 ref 读取「最新」的题号，供 await 之后判断用户是否还停在原题
  const practiceIndexRef = useRef(practiceIndex);
  const [wrongQuestions, setWrongQuestions] = useState<Question[]>([]);
  const [favoriteQuestions, setFavoriteQuestions] = useState<Question[]>([]);
  const [commonQuestions, setCommonQuestions] = useState<Question[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [sourceRect, setSourceRect] = useState<DOMRect | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [practiceStartTime, setPracticeStartTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumeData, setResumeData] = useState<SavedProgress | null>(null);
  const swipeRef = useRef<HTMLDivElement>(null);

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
    setIsBankExhausted(false);
    roundRecordSavedRef.current = false;
  }, [bankId, practiceMode]);

  useEffect(() => {
    if (!bank || !practiceMode || isInitialized) return;

    const init = async () => {
      // 仅顺序练题模式支持进度保存/恢复
      const isProgressMode = practiceMode === 'sequential';

      if (isProgressMode) {
        const saved = await loadExamProgress();
        if (saved && saved.mode === 'practice' && saved.bankId === bank.id && saved.practiceMode === practiceMode) {
          // 匹配：立即完整恢复（题目、位置、答案、计时器），弹窗询问继续/重新开始
          await restoreExamProgress(saved);
          setPracticeQuestions(saved.questions);
          setPracticeIndex(saved.currentIndex);
          setShowAnswer(false);
          setPracticeStartTime(Date.now() - saved.elapsedTime * 1000);
          setElapsedTime(saved.elapsedTime);
          setResumeData(saved);
          setShowResumePrompt(true);
          setIsInitialized(true);
          return;
        }
      }

      const getQuestionsForMode = (mode: PracticeMode, bank: QuestionBank): Question[] => {
        switch (mode) {
          case 'sequential': {
            // 顺序练题：按题库顺序取题；开启「避免重复做题」时跳过已做过的题目，并按设置的每轮题量截取
            const { avoidRepeatQuestions, questionsPerRound, doneQuestionIds } = useSettingsStore.getState();
            const doneSet = new Set(avoidRepeatQuestions ? (doneQuestionIds[bank.id] ?? []) : []);
            const pool = avoidRepeatQuestions
              ? bank.questions.filter(q => !doneSet.has(q.id))
              : [...bank.questions];
            return pool.slice(0, questionsPerRound);
          }
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

      // 顺序练题：库里的题都已做过，不再重复出题
      if (practiceMode === 'sequential' && questions.length === 0) {
        setPracticeQuestions([]);
        setIsBankExhausted(true);
        setIsInitialized(true);
        return;
      }

      roundRecordSavedRef.current = false;
      setIsBankExhausted(false);
      setPracticeQuestions(questions);
      setPracticeIndex(0);
      setShowAnswer(false);
      setPracticeStartTime(Date.now());
      setElapsedTime(0);
      startExam(bank.id, bank.name, questions);
      setIsInitialized(true);
    };

    init();
  }, [bank, practiceMode, wrongQuestions, commonQuestions, isInitialized, startExam, loadExamProgress, restoreExamProgress]);

  // 计时器：顺序练题显示（与模拟考试画风统一）
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (practiceMode === 'sequential' && isInitialized && practiceStartTime > 0 && !showResumePrompt) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - practiceStartTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [practiceMode, isInitialized, practiceStartTime, showResumePrompt]);

  const savePracticeData = useCallback((wrong: Question[], favorites: Question[], common: Question[]) => {
    localStorage.setItem('practice-data-global', JSON.stringify({
      wrongQuestions: wrong,
      favoriteQuestions: favorites,
      commonQuestions: common
    }));
  }, []);

  /**
   * 顺序练题：把本轮题目、作答、得分、用时写成一条测试记录，
   * 并把这些题标记为「已做」，下一轮开启去重时不再出现。
   * 一题都没作答（只翻看）时不算一轮，既不写记录也不标记。
   */
  const saveRoundRecord = async (questions: Question[]) => {
    if (practiceMode !== 'sequential' || roundRecordSavedRef.current || !bank || questions.length === 0) return;

    const state = useExamStore.getState().examState;
    const answers: UserAnswer[] = questions.map(question => {
      const result = state?.results.get(question.id);
      const answer = state?.answers.get(question.id) ?? '';
      if (result) {
        return {
          questionId: question.id,
          answer: result.answer ?? answer,
          score: result.score,
          isCorrect: result.isCorrect,
          aiFeedback: result.aiFeedback,
          aiExplanation: result.aiExplanation,
          gradingMode: result.gradingMode,
          blankResults: result.blankResults,
        };
      }
      return { questionId: question.id, answer, score: 0, isCorrect: 0 };
    });

    if (!answers.some(item => !isEmptyAnswer(item.answer))) return;

    roundRecordSavedRef.current = true;
    const maxScore = questions.reduce((sum, q) => sum + q.score, 0);
    try {
      // 顺序练题的提交走固定判题（confirmAnswer 未启用 AI）
      await addRecord(bank.id, bank.name, questions, answers, elapsedTime, maxScore, 'fixed');
      markQuestionsDone(bank.id, questions.map(q => q.id));
    } catch (error) {
      console.error('[Practice] 写入练题记录失败:', error);
    }
  };

  /** 完成本轮：写记录后返回，下一轮自动跳过这些题 */
  const handleFinishRound = async () => {
    if (isSubmitting) return;
    await saveRoundRecord(practiceQuestions);
    await clearExamProgress();
    showSuccess('本轮已结束，测试记录已保存', 2500);
    goBack();
  };

  /** 题目都做过了：重置本题库的已做记录，重新开始一轮 */
  const handleResetDoneQuestions = () => {
    if (!bank) return;
    resetDoneQuestions(bank.id);
    roundRecordSavedRef.current = false;
    setIsBankExhausted(false);
    setIsInitialized(false);
  };

  const goBack = useBackNavigation('/');

  const handleGoBack = () => {
    // 仅顺序练题模式弹窗提醒保存；其他模式直接退出
    if (practiceMode === 'sequential') {
      setShowExitConfirm(true);
    } else {
      goBack();
    }
  };

  const handleSaveAndExit = async () => {
    // 保存进度表示本轮还没结束，下次可继续，不写测试记录
    await saveExamProgress('practice', elapsedTime, practiceMode);
    goBack();
  };

  const handleExitWithoutSave = async () => {
    // 中途直接退出也算本轮结束：写出记录并标记已做，避免下次重复出题
    await saveRoundRecord(practiceQuestions);
    await clearExamProgress();
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

  useEffect(() => {
    practiceIndexRef.current = practiceIndex;
  }, [practiceIndex]);

  const handleConfirmAnswer = async () => {
    const question = practiceQuestions[practiceIndex];
    if (!question || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const useAI = practiceMode !== 'wrong' && practiceMode !== 'sequential';
      await confirmAnswer(question.id, useAI);

      // ⚠️ 只有用户仍停留在被提交的那道题上时才自动展开答案面板。
      // 旧实现在 await 之后无条件 setShowAnswer(true)，AI 判题要几秒，
      // 期间用户切到下一题就会把参考答案/解析显示到那道新题上（提前泄题）。
      const stillOnSameQuestion = practiceQuestions[practiceIndexRef.current]?.id === question.id;
      if (stillOnSameQuestion) {
        setShowAnswer(true);
      }

      const result = getResult(question.id);

      if (practiceMode === 'wrong') {
        if (result && result.isCorrect === 2) {
          const newWrong = wrongQuestions.filter(q => q.id !== question.id);
          setWrongQuestions(newWrong);
          savePracticeData(newWrong, favoriteQuestions, commonQuestions);
        }
      } else {
        if (result && result.isCorrect !== 2) {
          const newWrong = [...wrongQuestions];
          if (!newWrong.find(q => q.id === question.id)) {
            newWrong.push(question);
            setWrongQuestions(newWrong);
            savePracticeData(newWrong, favoriteQuestions, commonQuestions);
          }
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoToQuestion = (index: number) => {
    const question = practiceQuestions[index];
    if (isSubmitting || !question) return;
    setPracticeIndex(index);
    setShowAnswer(getResult(question.id)?.isConfirmed || false);
  };

  useSwipeElement(swipeRef, {
    onSwipeLeft: () => {
      if (practiceIndex < practiceQuestions.length - 1) {
        handleGoToQuestion(practiceIndex + 1);
      }
    },
    onSwipeRight: () => {
      if (practiceIndex > 0) {
        handleGoToQuestion(practiceIndex - 1);
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
          <div className="max-w-lg mx-auto px-4 h-9 flex items-center justify-between">
            <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-base font-semibold">{getModeTitle()}</h1>
            <div className="w-8 h-8" />
          </div>
        </header>
        <div className="max-w-lg mx-auto px-4 py-8 text-center">
          {isBankExhausted ? (
            <>
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                本题库的题目都已练过，已按设置跳过重复题目
              </p>
              <button
                onClick={handleResetDoneQuestions}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
              >
                重置已做记录并重新开始
              </button>
            </>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">暂无题目</p>
          )}
        </div>
      </div>
    );
  }

  const answer = getAnswer(currentQuestion.id);
  const result = getResult(currentQuestion.id);
  const confirmed = !!result?.isConfirmed;
  const timed = practiceMode === 'sequential';

  return (
    <>
      <QuestionWorkspace
        title={timed ? undefined : getModeTitle()}
        timer={timed ? `${Math.floor(elapsedTime / 60)}:${String(elapsedTime % 60).padStart(2, '0')}` : undefined}
        backLabel="返回"
        onBack={handleGoBack}
        index={practiceIndex}
        questions={practiceQuestions.map(question => {
          const grade = getResult(question.id);
          return { id: question.id, tone: !grade?.isConfirmed ? 'idle'
            : grade.isCorrect === 2 ? 'correct' : grade.isCorrect === 1 ? 'partial' : 'wrong' };
        })}
        onSelect={handleGoToQuestion}
        contentRef={swipeRef}
        footerCenter={
              <button type="button" aria-label="标记常用题" onClick={() => handleToggleCommon(currentQuestion)} className={`px-3 py-2 rounded-lg ${commonQuestions.find(q => q.id === currentQuestion?.id) ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/50 dark:text-yellow-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>
                <svg className="w-5 h-5" fill={commonQuestions.find(q => q.id === currentQuestion?.id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              </button>
        }
        footerAction={!isViewMode && !confirmed ? (
          <button type="button" onClick={handleConfirmAnswer} disabled={isSubmitting}
            className="rounded-lg bg-green-500 px-4 py-2 font-medium text-white hover:bg-green-600 disabled:opacity-60">
            {isSubmitting ? '判题中...' : '提交'}
          </button>
        ) : timed && practiceIndex === practiceQuestions.length - 1 ? (
          <button type="button" onClick={handleFinishRound} disabled={isSubmitting}
            className="rounded-lg bg-blue-500 px-4 py-2 font-medium text-white hover:bg-blue-600 disabled:opacity-60">
            完成本轮
          </button>
        ) : undefined}
      >
        <div className="space-y-4">
          <QuestionStem question={currentQuestion} onImageClick={openImageViewer} />
          {isViewMode && !isChoiceQuestion(currentQuestion)
            ? <ReferenceAnswer answer={currentQuestion.correctAnswer} onOpenImages={openImageViewer} />
            : <QuestionFields question={currentQuestion} answer={isViewMode ? undefined : answer}
                result={result} reveal={isViewMode || confirmed} practiceFeedback
                onChange={isViewMode || confirmed ? undefined : value => setAnswer(currentQuestion.id, value)} />}
          {isViewMode && currentQuestion.explanation && (
            <div className="selectable whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-4 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <span className="font-medium">解析: </span>{currentQuestion.explanation}
            </div>
          )}
          {!isViewMode && showAnswer && <GradingResultCard question={currentQuestion} answer={answer}
            result={result} isConfirmed={confirmed} onOpenImages={openImageViewer} />}
        </div>
      </QuestionWorkspace>

      {/* 图片查看器 */}
      {viewerImages && (
        <ImageViewer 
          images={viewerImages} 
          onClose={closeImageViewer}
          initialIndex={viewerInitialIndex}
          sourceRect={sourceRect}
        />
      )}

      {showExitConfirm && (
        <ExitConfirmModal
          message="退出后未保存的答题进度将丢失，是否保存当前进度？"
          onSave={handleSaveAndExit}
          onExitWithoutSave={handleExitWithoutSave}
          onCancel={() => setShowExitConfirm(false)}
        />
      )}

      {showResumePrompt && resumeData && (
        <ResumePromptModal
          mode="practice"
          currentQuestion={resumeData.currentIndex}
          totalQuestions={resumeData.questions.length}
          elapsedSeconds={resumeData.elapsedTime}
          onResume={handleResumeProgress}
          onRestart={handleStartFresh}
        />
      )}
    </>
  );
};

export default Practice;

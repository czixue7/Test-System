import React, { useState, useRef } from 'react';
import { useBackNavigation } from '../hooks/useBackNavigation';
import QuestionStem from '../components/QuestionStem';
import QuestionWorkspace from '../components/QuestionWorkspace';
import QuestionFields, { isChoiceQuestion } from '../components/QuestionFields';
import GradingResultCard from '../components/GradingResultCard';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useRecordStore } from '../store/recordStore';
import { useSwipeElement } from '../hooks/useSwipe';
import { useSafeArea } from '../hooks/useSafeArea';
import ImageViewer from '../components/ImageViewer';
import { countAnswerStats, isEmptyAnswer, normalizeGrade } from '../utils/answerUtils';

const Result: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { getRecord } = useRecordStore();
  const record = getRecord(id!);
  const [currentIndex, setCurrentIndex] = useState(0);
  const showDetail = (location.state as { answerDetail?: boolean } | null)?.answerDetail === true;
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const [sourceRect, setSourceRect] = useState<DOMRect | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
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

  const handleGoBack = useBackNavigation('/records');
  const closeAnswerDetail = useBackNavigation(location.pathname + location.search);

  // ⚠️ 所有 Hook 必须在提前 return 之前调用。
  // 旧代码把 useSwipeElement 放在 `if (!record) return ...` **之后**：
  // 记录尚未加载时少调一个 Hook，记录到达后同一次挂载内 Hook 数量发生变化，
  // React 会抛 "Rendered more hooks than during the previous render" 并整屏白
  //（而本项目没有 ErrorBoundary）。
  useSwipeElement(contentRef, {
    onSwipeLeft: () => {
      if (showDetail && record) {
        setCurrentIndex(Math.min(record.questions.length - 1, currentIndex + 1));
      }
    },
    onSwipeRight: () => {
      if (showDetail && record) {
        setCurrentIndex(Math.max(0, currentIndex - 1));
      }
    },
    threshold: 50,
  });

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

  // 统一的三态统计（与 Records / recordStore 共用同一实现，避免同一份记录
  // 在两个页面显示不同的数字）
  const { correct: correctCount, partial: partialCount, wrong: wrongCount, unanswered: unansweredCount } =
    countAnswerStats(record.answers);

  // 旧记录可能没有 percentage 字段；分母必须用 maxScore（recordStore 里的
  // score/totalScore 都是「已得总分」，用它们相除恒等于 100%）。
  const displayPercentage =
    record.percentage ??
    (record.maxScore && record.maxScore > 0
      ? Math.min(100, Math.round((record.totalScore / record.maxScore) * 100))
      : 0);

  if (showDetail) {
    const currentQuestion = record.questions[currentIndex];
    const answers = new Map(record.answers.map(answer => [answer.questionId, answer]));
    const answer = currentQuestion && answers.get(currentQuestion.id);
    const grade = normalizeGrade(answer?.isCorrect);
    const result = answer ? { ...answer, isCorrect: grade, score: answer.score ?? 0 } : undefined;

    return (
      <>
        <QuestionWorkspace title="答题详情" backLabel="返回成绩" onBack={closeAnswerDetail}
          index={currentIndex} onSelect={setCurrentIndex} contentRef={contentRef}
          questions={record.questions.map(question => {
            const saved = answers.get(question.id);
            const score = normalizeGrade(saved?.isCorrect);
            return { id: question.id, tone: isEmptyAnswer(saved?.answer) ? 'idle'
              : score === 2 ? 'correct' : score === 1 ? 'partial' : 'wrong' };
          })}
        >
          {currentQuestion && <div className="space-y-4">
            <QuestionStem question={currentQuestion} onImageClick={openImageViewer} />
            {isChoiceQuestion(currentQuestion) && (
              <QuestionFields question={currentQuestion} answer={answer?.answer} reveal />
            )}
            {currentQuestion.type === 'subjective' && !isEmptyAnswer(answer?.answer) && (
              <QuestionFields question={currentQuestion} answer={answer?.answer} result={result} reveal />
            )}
            <GradingResultCard question={currentQuestion} answer={answer?.answer} result={result}
              isConfirmed={!isEmptyAnswer(answer?.answer)} onOpenImages={openImageViewer} />
          </div>}
        </QuestionWorkspace>
        {viewerImages && <ImageViewer images={viewerImages} onClose={closeImageViewer}
          initialIndex={viewerInitialIndex} sourceRect={sourceRect} />}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header 
        className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800 transition-colors"
        style={{ paddingTop: safeArea.top }}
      >
        <div className="max-w-lg mx-auto px-4 h-9 flex items-center justify-between">
          <button onClick={handleGoBack} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-base font-semibold">考试结果</h1>
          <div className="w-8 h-8" />
        </div>
      </header>

      <div
        className="max-w-lg mx-auto px-4 py-6"
        style={{ paddingTop: safeArea.contentTop, paddingBottom: safeArea.bottom + 20 }}
      >
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-6 text-center mb-4">
          <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-2xl font-bold text-white">{displayPercentage}%</span>
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
              <div className="text-xl font-bold text-gray-600 dark:text-gray-400">{Math.floor((record.duration ?? record.timeSpent) / 60)}:{((record.duration ?? record.timeSpent) % 60).toString().padStart(2, '0')}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">用时</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-4">
            <div className="p-2 bg-green-50 dark:bg-green-900/30 rounded-lg">
              <div className="text-xl font-bold text-green-600 dark:text-green-400">{correctCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">正确</div>
            </div>
            <div className="p-2 bg-orange-50 dark:bg-orange-900/30 rounded-lg">
              <div className="text-xl font-bold text-orange-500 dark:text-orange-400">{partialCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">部分正确</div>
            </div>
            <div className="p-2 bg-red-50 dark:bg-red-900/30 rounded-lg">
              <div className="text-xl font-bold text-red-600 dark:text-red-400">{wrongCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">错误</div>
            </div>
            <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="text-xl font-bold text-gray-400 dark:text-gray-500">{unansweredCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">未答</div>
            </div>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            {record.bankName || record.examName} · {new Date(record.finishedAt || record.submittedAt).toLocaleString()}
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
              
              const singleMode = (record.gradingMode || 'fixed') as 'ai' | 'fixed' | 'ai-fallback';
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
          
          <button onClick={() => navigate(location.pathname + location.search, { state: { answerDetail: true } })} className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all mb-2">
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

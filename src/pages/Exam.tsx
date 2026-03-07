import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useExamStore } from '../store/examStore';
import { useQuestionBankStore } from '../store/questionBankStore';
import { useRecordStore } from '../store/recordStore';
import { Question, AnswerWithImages } from '../types';

function isAnswerWithImages(answer: unknown): answer is AnswerWithImages {
  return typeof answer === 'object' && answer !== null && 'text' in answer;
}

function getAnswerText(correctAnswer: string | string[] | AnswerWithImages): string {
  if (isAnswerWithImages(correctAnswer)) {
    return correctAnswer.text;
  }
  if (Array.isArray(correctAnswer)) {
    return correctAnswer.join(', ');
  }
  return String(correctAnswer);
}

function getAnswerImages(correctAnswer: string | string[] | AnswerWithImages): string[] | undefined {
  if (isAnswerWithImages(correctAnswer)) {
    return correctAnswer.images;
  }
  return undefined;
}

function formatReferenceAnswer(text: string): React.ReactNode {
  const lines: React.ReactNode[] = [];
  let key = 0;
  
  const segments = text.split(/\n/).filter(Boolean);
  
  if (segments.length <= 1 && !text.match(/[；;]/)) {
    return text;
  }
  
  segments.forEach((segment) => {
    const trimmed = segment.trim();
    if (!trimmed) return;
    
    const isChineseHeader = /^[一二三四五六七八九十]+、/.test(trimmed);
    
    if (isChineseHeader) {
      lines.push(<div key={key++} className="font-medium mt-2">{trimmed}</div>);
    } else {
      const parts = trimmed.split(/(?<![（(])(?=[；;])/g).filter(Boolean);
      
      if (parts.length > 1) {
        const items: React.ReactNode[] = [];
        parts.forEach((part) => {
          const content = part.replace(/^[；;]/, '').trim();
          if (content) {
            items.push(<li key={key++}>{content}</li>);
          }
        });
        if (items.length > 0) {
          lines.push(
            <ul key={key++} className="list-disc list-inside ml-4 my-1">
              {items}
            </ul>
          );
        }
      } else {
        lines.push(<div key={key++} className="my-1">{trimmed}</div>);
      }
    }
  });
  
  if (lines.length === 0) {
    return text;
  }
  
  return <>{lines}</>;
}

const Exam: React.FC = () => {
  const { bankId } = useParams<{ bankId: string }>();
  const navigate = useNavigate();
  const { getBank } = useQuestionBankStore();
  const { 
    examState, 
    startExam, 
    setAnswer, 
    getAnswer, 
    confirmAnswer, 
    getResult,
    getQuestionStatus,
    nextQuestion, 
    prevQuestion, 
    goToQuestion, 
    finishExam, 
    resetExam,
    getStatistics,
    isAllConfirmed
  } = useExamStore();
  const { addRecord } = useRecordStore();
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [showConfirmFinish, setShowConfirmFinish] = useState(false);

  const bank = getBank(bankId!);

  useEffect(() => {
    if (bank && bank.questions.length > 0 && !examState) {
      startExam(bank.id, bank.name, bank.questions);
    }
  }, [bank, examState, startExam]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (examState && !examState.isFinished) {
        setTimeElapsed(Math.floor((Date.now() - examState.startTime) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [examState]);

  const handleFinish = useCallback(() => {
    const answers = finishExam();
    const maxScore = bank!.questions.reduce((sum, q) => sum + q.score, 0);
    const recordId = addRecord(bank!.id, bank!.name, answers, timeElapsed, maxScore);
    navigate(`/result/${recordId}`);
  }, [finishExam, bank, timeElapsed, addRecord, navigate]);

  useEffect(() => {
    if (examState && isAllConfirmed() && !examState.isFinished) {
      const timer = setTimeout(() => {
        handleFinish();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [examState, isAllConfirmed, handleFinish]);

  useEffect(() => {
    return () => {
      resetExam();
    };
  }, [resetExam]);

  if (!bank) {
    return (
      <div className="page-container">
        <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
          <div className="card text-center py-8">
            <p className="text-gray-500">题库不存在</p>
            <Link to="/" className="btn-primary mt-4 inline-block">返回首页</Link>
          </div>
        </div>
      </div>
    );
  }

  if (bank.questions.length === 0) {
    return (
      <div className="page-container">
        <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
          <div className="card text-center py-8">
            <p className="text-gray-500">题库中没有题目</p>
            <Link to={`/bank/${bank.id}`} className="btn-primary mt-4 inline-block">添加题目</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!examState) {
    return (
      <div className="page-container">
        <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
          <div className="card text-center py-8">
            <div className="page-loading-spinner mx-auto"></div>
            <p className="text-gray-500 mt-4">加载中...</p>
          </div>
        </div>
      </div>
    );
  }

  const currentQuestion = examState.questions[examState.currentIndex];

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSingleChoiceSelect = (questionId: string, optionId: string) => {
    const result = getResult(questionId);
    if (result?.isConfirmed) return;
    
    setAnswer(questionId, optionId);
    setTimeout(() => {
      confirmAnswer(questionId);
    }, 100);
  };

  const handleMultipleChoiceConfirm = (questionId: string) => {
    const result = getResult(questionId);
    if (result?.isConfirmed) return;
    confirmAnswer(questionId);
  };

  const handleFillBlankConfirm = (questionId: string) => {
    const result = getResult(questionId);
    if (result?.isConfirmed) return;
    confirmAnswer(questionId);
  };

  const handleSubjectiveConfirm = (questionId: string) => {
    const result = getResult(questionId);
    if (result?.isConfirmed) return;
    confirmAnswer(questionId);
  };

  const renderQuestion = (question: Question) => {
    const answer = getAnswer(question.id);
    const result = getResult(question.id);
    const isConfirmed = result?.isConfirmed || false;

    switch (question.type) {
      case 'single-choice':
        return (
          <div className="space-y-2">
            {question.options?.map((option) => {
              const isSelected = answer === option.id;
              const isCorrectOption = question.correctAnswer === option.id;
              
              let optionClassName = 'option-label';
              if (isConfirmed) {
                if (isCorrectOption) {
                  optionClassName += ' border-green-500 bg-green-50';
                } else if (isSelected && !isCorrectOption) {
                  optionClassName += ' border-red-500 bg-red-50';
                }
              } else if (isSelected) {
                optionClassName += ' option-label-selected';
              } else {
                optionClassName += ' option-label-unselected';
              }
              
              return (
                <label
                  key={option.id}
                  className={optionClassName}
                >
                  <input
                    type="radio"
                    name={`question-${question.id}`}
                    value={option.id}
                    checked={isSelected}
                    onChange={() => handleSingleChoiceSelect(question.id, option.id)}
                    disabled={isConfirmed}
                    className="radio-styled"
                  />
                  <span className="font-medium text-gray-700">{option.id}.</span>
                  <span className="ml-1 text-gray-800">{option.content}</span>
                  {isConfirmed && isCorrectOption && (
                    <span className="ml-2 text-green-600 font-medium">✓ 正确答案</span>
                  )}
                </label>
              );
            })}
            {isConfirmed && (
              <div className={`mt-4 p-3 rounded-lg ${result?.isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                <p className="font-medium">
                  {result?.isCorrect ? '✓ 回答正确！' : '✗ 回答错误'}
                </p>
                {!result?.isCorrect && (
                  <p className="text-sm mt-1">正确答案: {getAnswerText(question.correctAnswer)}</p>
                )}
                {question.explanation && (
                  <p className="text-sm mt-2 text-gray-700">解析: {question.explanation}</p>
                )}
              </div>
            )}
          </div>
        );

      case 'multiple-choice':
        const selectedOptions = (answer as string[]) || [];
        const correctOptions = question.correctAnswer as string[];
        
        return (
          <div className="space-y-2">
            {question.options?.map((option) => {
              const isSelected = selectedOptions.includes(option.id);
              const isCorrectOption = correctOptions.includes(option.id);
              
              let optionClassName = 'option-label';
              if (isConfirmed) {
                if (isCorrectOption) {
                  optionClassName += ' border-green-500 bg-green-50';
                }
                if (isSelected && !isCorrectOption) {
                  optionClassName += ' border-red-500 bg-red-50';
                }
              } else if (isSelected) {
                optionClassName += ' option-label-selected';
              } else {
                optionClassName += ' option-label-unselected';
              }
              
              return (
                <label
                  key={option.id}
                  className={optionClassName}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      if (isConfirmed) return;
                      const newSelection = e.target.checked
                        ? [...selectedOptions, option.id]
                        : selectedOptions.filter(id => id !== option.id);
                      setAnswer(question.id, newSelection);
                    }}
                    disabled={isConfirmed}
                    className="checkbox-styled"
                  />
                  <span className="font-medium text-gray-700">{option.id}.</span>
                  <span className="ml-1 text-gray-800">{option.content}</span>
                  {isConfirmed && isCorrectOption && (
                    <span className="ml-2 text-green-600 font-medium">✓</span>
                  )}
                </label>
              );
            })}
            
            {!isConfirmed && selectedOptions.length > 0 && (
              <button
                onClick={() => handleMultipleChoiceConfirm(question.id)}
                className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                确认答案
              </button>
            )}
            
            {isConfirmed && (
              <div className={`mt-4 p-3 rounded-lg ${result?.isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                <p className="font-medium">
                  {result?.isCorrect ? '✓ 回答正确！' : '✗ 回答错误'}
                </p>
                {!result?.isCorrect && (
                  <p className="text-sm mt-1">正确答案: {(question.correctAnswer as string[]).join(', ')}</p>
                )}
                {question.explanation && (
                  <p className="text-sm mt-2 text-gray-700">解析: {question.explanation}</p>
                )}
              </div>
            )}
          </div>
        );

      case 'fill-in-blank':
        const rawCorrectAnswers = question.correctAnswer;
        const correctAnswers: string[] = Array.isArray(rawCorrectAnswers) 
          ? rawCorrectAnswers.filter((a): a is string => typeof a === 'string')
          : (typeof rawCorrectAnswers === 'string' ? [rawCorrectAnswers] : []);
        const blankAnswers = Array.isArray(answer) ? answer : [];
        const allowDisorder = question.allowDisorder ?? false;
        
        const getBlankMatchResult = () => {
          const normalizedCorrect = correctAnswers.map(a => a.toLowerCase().trim());
          const normalizedUser = blankAnswers.map(a => (a as string).toLowerCase().trim());
          
          if (allowDisorder) {
            const matched: { userIdx: number; correctIdx: number }[] = [];
            const usedCorrectIdx = new Set<number>();
            
            for (let uIdx = 0; uIdx < normalizedUser.length; uIdx++) {
              for (let cIdx = 0; cIdx < normalizedCorrect.length; cIdx++) {
                if (!usedCorrectIdx.has(cIdx) && normalizedUser[uIdx] === normalizedCorrect[cIdx]) {
                  matched.push({ userIdx: uIdx, correctIdx: cIdx });
                  usedCorrectIdx.add(cIdx);
                  break;
                }
              }
            }
            return { matched: matched as { userIdx: number; correctIdx: number }[], usedCorrectIdx, isOrderMode: false };
          } else {
            const matched: { userIdx: number; correctIdx: number }[] = [];
            for (let i = 0; i < normalizedCorrect.length; i++) {
              if (normalizedUser[i] === normalizedCorrect[i]) {
                matched.push({ userIdx: i, correctIdx: i });
              }
            }
            return { matched, usedCorrectIdx: new Set<number>(), isOrderMode: true };
          }
        };
        
        return (
          <div className="space-y-3">
            {correctAnswers.map((_, idx) => {
              const { matched, isOrderMode } = isConfirmed ? getBlankMatchResult() : { matched: [], isOrderMode: false };
              const userMatch = matched.find(m => m.userIdx === idx);
              const isThisCorrect = isConfirmed && userMatch !== undefined;
              const displayCorrectAnswer = isOrderMode 
                ? correctAnswers[idx] 
                : (userMatch ? correctAnswers[userMatch.correctIdx] : correctAnswers.find((_, cIdx) => !matched.find(m => m.correctIdx === cIdx)) || correctAnswers[idx]);
              
              return (
                <div key={idx} className="flex flex-col gap-1">
                  <input
                    type="text"
                    value={(blankAnswers[idx] as string) || ''}
                    onChange={(e) => {
                      if (isConfirmed) return;
                      const newAnswers = [...blankAnswers];
                      newAnswers[idx] = e.target.value;
                      setAnswer(question.id, newAnswers);
                    }}
                    disabled={isConfirmed}
                    className={`input-styled py-3 ${isConfirmed ? 'bg-gray-100' : ''}`}
                    placeholder={`答案 ${idx + 1}`}
                  />
                  {isConfirmed && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">正确答案: </span>
                      <span className="text-sm font-medium text-green-600">{displayCorrectAnswer}</span>
                      {isThisCorrect ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-red-600">✗</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            
            {!isConfirmed && blankAnswers.some(a => a && (a as string).trim()) && (
              <button
                onClick={() => handleFillBlankConfirm(question.id)}
                className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                确认答案
              </button>
            )}
            
            {isConfirmed && (
              <div className={`mt-4 p-3 rounded-lg ${result?.isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                <p className="font-medium">
                  {result?.isCorrect ? '✓ 回答正确！' : '✗ 回答错误'}
                </p>
                {question.explanation && (
                  <p className="text-sm mt-2 text-gray-700">解析: {question.explanation}</p>
                )}
              </div>
            )}
          </div>
        );

      case 'subjective':
        const answerImages = getAnswerImages(question.correctAnswer);
        const answerText = getAnswerText(question.correctAnswer);
        
        return (
          <div>
            <textarea
              value={(answer as string) || ''}
              onChange={(e) => {
                if (isConfirmed) return;
                setAnswer(question.id, e.target.value);
              }}
              disabled={isConfirmed}
              className={`input-styled py-3 ${isConfirmed ? 'bg-gray-100' : ''}`}
              rows={6}
              placeholder="请输入答案"
            />
            
            {!isConfirmed && (answer as string)?.trim() && (
              <button
                onClick={() => handleSubjectiveConfirm(question.id)}
                className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                确认答案
              </button>
            )}
            
            {isConfirmed && (
              <div className="mt-4 p-3 rounded-lg bg-blue-50 text-blue-800">
                <p className="font-medium mb-2">参考答案:</p>
                <div className="text-sm">{formatReferenceAnswer(answerText)}</div>
                {answerImages && answerImages.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {answerImages.map((img, idx) => (
                      <img 
                        key={idx} 
                        src={img} 
                        alt={`参考图${idx + 1}`} 
                        className="max-w-full rounded border border-blue-200"
                      />
                    ))}
                  </div>
                )}
                {question.explanation && (
                  <p className="text-sm mt-2 text-gray-700">解析: {question.explanation}</p>
                )}
                <div className="mt-3 pt-3 border-t border-blue-200">
                  <p className="text-sm">
                    得分: <span className="font-bold">{result?.score}</span> / {question.score} 分
                  </p>
                </div>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  const getQuestionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'fill-in-blank': '填空题',
      'single-choice': '单选题',
      'multiple-choice': '多选题',
      'subjective': '主观题'
    };
    return labels[type];
  };

  const statistics = getStatistics();

  return (
    <div className="page-container">
      <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 sm:gap-3 mb-2 sm:mb-3">
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <Link to="/" className="btn-back" onClick={resetExam}>
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              退出
            </Link>
            <h1 className="title-secondary truncate">{bank.name}</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <div className="text-sm sm:text-base font-medium text-gray-700">
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatTime(timeElapsed)}
            </div>
            <button
              onClick={() => setShowConfirmFinish(true)}
              className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-xs sm:text-sm"
            >
              交卷
            </button>
          </div>
        </div>

        <div className="card mb-2 sm:mb-3">
          <div className="flex flex-col gap-2 sm:gap-3">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-gray-600">得分:</span>
                <span className="font-bold text-base sm:text-lg text-blue-600">{statistics.totalScore}</span>
                <span className="text-gray-500">/ {statistics.maxScore}</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-gray-600">正确:</span>
                <span className="font-medium text-green-600">{statistics.correct}</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-gray-600">错误:</span>
                <span className="font-medium text-red-600">{statistics.incorrect}</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-gray-600">已答:</span>
                <span className="font-medium">{statistics.correct + statistics.incorrect}</span>
                <span className="text-gray-500">/ {examState.questions.length}</span>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row items-start gap-2 sm:gap-4 min-w-0 w-full">
              <div className="flex-1 w-full">
                <h3 className="font-semibold text-gray-700 mb-1.5 sm:mb-2 text-xs sm:text-sm">答题卡</h3>
                <div className="answer-grid">
                  {examState.questions.map((q, index) => {
                    const status = getQuestionStatus(q.id);
                    const isCurrent = index === examState.currentIndex;
                    
                    let btnClassName = 'answer-btn';
                    if (status === 'correct') {
                      btnClassName += ' bg-green-500 text-white border-green-500';
                    } else if (status === 'incorrect') {
                      btnClassName += ' bg-red-500 text-white border-red-500';
                    } else {
                      btnClassName += ' answer-btn-unanswered';
                    }
                    
                    if (isCurrent) {
                      btnClassName += ' ring-2 ring-blue-500 ring-offset-1';
                    }
                    
                    return (
                      <button
                        key={q.id}
                        onClick={() => goToQuestion(index)}
                        className={btnClassName}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="text-xs text-gray-500 flex sm:flex-col gap-2 sm:gap-0 sm:pt-6">
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded bg-green-500"></div>
                  <span>正确 {statistics.correct}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded bg-red-500"></div>
                  <span>错误 {statistics.incorrect}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded bg-gray-100 border"></div>
                  <span>未答 {examState.questions.length - statistics.correct - statistics.incorrect}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center mb-2 sm:mb-3">
          <button
            onClick={prevQuestion}
            disabled={examState.currentIndex === 0}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed text-xs"
          >
            上一题
          </button>
          <span className="text-gray-500 text-xs sm:text-sm">
            {examState.currentIndex + 1} / {examState.questions.length}
          </span>
          <button
            onClick={nextQuestion}
            disabled={examState.currentIndex === examState.questions.length - 1}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed text-xs"
          >
            下一题
          </button>
        </div>

        <div className="card">
          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 mb-1.5 sm:mb-2">
            <span className="badge badge-info">第 {examState.currentIndex + 1} 题</span>
            <span className="badge badge-success">{getQuestionTypeLabel(currentQuestion.type)}</span>
            <span className="text-xs text-gray-500">{currentQuestion.score} 分</span>
          </div>

          <div className="text-sm sm:text-base text-gray-800 mb-2 sm:mb-3 whitespace-pre-wrap">
            {currentQuestion.content}
          </div>

          {renderQuestion(currentQuestion)}
        </div>

        {showConfirmFinish && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3">
            <div className="bg-white rounded-lg p-3 sm:p-4 w-full max-w-md">
              <h2 className="text-base sm:text-lg font-semibold mb-1.5 sm:mb-2">确认交卷</h2>
              <p className="text-gray-600 mb-1.5 text-xs sm:text-sm">
                您已完成 {statistics.correct + statistics.incorrect} / {examState.questions.length} 题
              </p>
              {statistics.correct + statistics.incorrect < examState.questions.length && (
                <p className="text-orange-500 text-xs mb-2 sm:mb-3">
                  还有 {examState.questions.length - statistics.correct - statistics.incorrect} 题未作答
                </p>
              )}
              <div className="flex justify-end gap-1.5 sm:gap-2">
                <button
                  onClick={() => setShowConfirmFinish(false)}
                  className="btn-secondary"
                >
                  继续答题
                </button>
                <button
                  onClick={handleFinish}
                  className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-xs sm:text-sm"
                >
                  确认交卷
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Exam;

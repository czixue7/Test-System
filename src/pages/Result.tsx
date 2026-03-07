import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRecordStore } from '../store/recordStore';
import { useQuestionBankStore } from '../store/questionBankStore';
import { AnswerWithImages } from '../types';

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

const Result: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { getRecord } = useRecordStore();
  const { getBank } = useQuestionBankStore();
  const record = getRecord(id!);

  if (!record) {
    return (
      <div className="page-container">
        <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
          <div className="card text-center py-12">
            <p className="text-gray-500">测试记录不存在</p>
            <Link to="/" className="btn-primary mt-4 inline-block">返回首页</Link>
          </div>
        </div>
      </div>
    );
  }

  const bank = getBank(record.bankId);
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  };

  const getScoreColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-500';
    if (percentage >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getQuestionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'fill-in-blank': '填空题',
      'single-choice': '单选题',
      'multiple-choice': '多选题',
      'subjective': '主观题'
    };
    return labels[type] || type;
  };

  return (
    <div className="page-container">
      <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
        <div className="mb-2 sm:mb-3">
          <Link to="/" className="btn-back">
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回首页
          </Link>
        </div>

        <div className="card mb-2 sm:mb-3">
          <div className="text-center">
            <h1 className="title-primary mb-0.5 sm:mb-1">{record.bankName}</h1>
            <p className="text-gray-500 mb-2 sm:mb-3 text-xs sm:text-sm">测试结果</p>
            
            <div className={`text-2xl sm:text-3xl md:text-4xl font-bold ${getScoreColor(record.percentage)} mb-0.5 sm:mb-1`}>
              {record.totalScore} / {record.maxScore}
            </div>
            <div className={`text-base sm:text-lg font-semibold ${getScoreColor(record.percentage)} mb-2 sm:mb-3`}>
              {record.percentage}%
            </div>

            <div className="flex justify-center gap-3 sm:gap-4 md:gap-6 text-gray-600 overflow-x-auto">
              <div className="stat-card bg-gray-50 rounded-lg flex-shrink-0">
                <div className="stat-value text-blue-500">{record.answers.length}</div>
                <div className="stat-label">总题数</div>
              </div>
              <div className="stat-card bg-gray-50 rounded-lg flex-shrink-0">
                <div className="stat-value text-green-500">
                  {record.answers.filter(a => (a.score ?? 0) > 0).length}
                </div>
                <div className="stat-label">正确</div>
              </div>
              <div className="stat-card bg-gray-50 rounded-lg flex-shrink-0">
                <div className="stat-value text-red-500">
                  {record.answers.filter(a => (a.score ?? 0) === 0).length}
                </div>
                <div className="stat-label">错误</div>
              </div>
              <div className="stat-card bg-gray-50 rounded-lg flex-shrink-0">
                <div className="stat-value text-purple-500">{formatDuration(record.duration)}</div>
                <div className="stat-label">用时</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="title-secondary mb-1.5 sm:mb-2">答题详情</h2>
          <div className="space-y-1.5 sm:space-y-2">
            {bank && record.answers.map((answer, index) => {
              const question = bank.questions.find(q => q.id === answer.questionId);
              if (!question) return null;

              const isCorrect = (answer.score ?? 0) > 0;

              return (
                <div
                  key={answer.questionId}
                  className={`question-card ${isCorrect ? 'question-card-correct' : 'question-card-wrong'}`}
                >
                  <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 mb-1">
                    <span className="badge badge-info">第 {index + 1} 题</span>
                    <span className="badge badge-success">{getQuestionTypeLabel(question.type)}</span>
                    <span className="text-xs text-gray-500">{question.score} 分</span>
                    <span className={`ml-auto badge ${isCorrect ? 'badge-success' : 'bg-red-100 text-red-800'}`}>
                      得分: {answer.score ?? 0}
                    </span>
                  </div>

                  <p className="text-gray-800 mb-1 sm:mb-1.5 text-xs sm:text-sm">{question.content}</p>

                  {question.options && (
                    <div className="space-y-0.5 sm:space-y-1 mb-1 sm:mb-1.5">
                      {question.options.map((option) => {
                        const isCorrectOption = 
                          (question.type === 'single-choice' && question.correctAnswer === option.id) ||
                          (question.type === 'multiple-choice' && (question.correctAnswer as string[]).includes(option.id));
                        const isSelected =
                          (question.type === 'single-choice' && answer.answer === option.id) ||
                          (question.type === 'multiple-choice' && (answer.answer as string[]).includes(option.id));

                        return (
                          <div
                            key={option.id}
                            className={`p-1 sm:p-1.5 rounded text-xs ${
                              isCorrectOption
                                ? 'bg-green-100 border border-green-300'
                                : isSelected
                                ? 'bg-red-100 border border-red-300'
                                : 'bg-gray-50'
                            }`}
                          >
                            <span className="font-medium">{option.id}.</span> {option.content}
                            {isCorrectOption && <span className="ml-1 text-green-600 text-xs">(正确答案)</span>}
                            {isSelected && !isCorrectOption && <span className="ml-1 text-red-600 text-xs">(您的选择)</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!question.options && (
                    <div className="space-y-0.5 sm:space-y-1 mb-1 sm:mb-1.5">
                      {question.type === 'fill-in-blank' && Array.isArray(question.correctAnswer) ? (
                        <>
                          <div className="p-1 sm:p-1.5 bg-gray-50 rounded">
                            <span className="text-gray-500 text-xs">您的答案: </span>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {(Array.isArray(answer.answer) ? answer.answer : [answer.answer]).map((ans, idx) => {
                                const correctAnswers = question.correctAnswer as string[];
                                const normalizedAns = (ans as string).toLowerCase().trim();
                                const isMatch = correctAnswers.some(ca => ca.toLowerCase().trim() === normalizedAns);
                                return (
                                  <span key={idx} className={`px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded text-xs ${isMatch ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    {ans || '未填'}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                          <div className="p-1 sm:p-1.5 bg-green-50 rounded">
                            <span className="text-gray-500 text-xs">正确答案: </span>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {(question.correctAnswer as string[]).map((ans, idx) => (
                                <span key={idx} className="px-1.5 py-0.5 sm:px-2 sm:py-0.5 bg-green-200 text-green-800 rounded text-xs">
                                  {ans}
                                </span>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="p-1 sm:p-1.5 bg-gray-50 rounded">
                            <span className="text-gray-500 text-xs">您的答案: </span>
                            <span className={`text-xs ${isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                              {Array.isArray(answer.answer) ? answer.answer.join(', ') : answer.answer || '未作答'}
                            </span>
                          </div>
                          <div className="p-1 sm:p-1.5 bg-green-50 rounded">
                            <span className="text-gray-500 text-xs">正确答案: </span>
                            <span className="text-green-600 text-xs">
                              {getAnswerText(question.correctAnswer)}
                            </span>
                            {(() => {
                              const images = getAnswerImages(question.correctAnswer);
                              return images && images.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {images.map((img, idx) => (
                                    <img 
                                      key={idx} 
                                      src={img} 
                                      alt={`参考图${idx + 1}`} 
                                      className="max-w-full rounded border border-green-200 max-h-48"
                                    />
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        </>
                      )}
                      {question.type === 'subjective' && answer.similarity !== undefined && (
                        <div className="p-1 sm:p-1.5 bg-blue-50 rounded">
                          <span className="text-gray-500 text-xs">相似度: </span>
                          <span className="text-blue-600 text-xs">{Math.round(answer.similarity * 100)}%</span>
                          {answer.similarity < 0.4 && (
                            <span className="ml-1 text-red-500 text-xs">(低于40%，得0分)</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {question.explanation && (
                    <div className="text-xs text-gray-500 bg-gray-50 p-1 sm:p-1.5 rounded mt-1 sm:mt-1.5">
                      解析: {question.explanation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Result;

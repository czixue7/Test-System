import React from 'react';
import type { Question, QuestionResult } from '../types';
import { getGradedBlankResults } from '../utils/practiceGrading';

interface Props {
  question: Question;
  answer?: string | string[];
  result?: QuestionResult;
  isConfirmed: boolean;
  onOpenImages: (images: string[], index: number, rect: DOMRect) => void;
}

// 主层级：状态与得分 → 逐空结果 → 解析 → 判题方式；沿用现有主题与 4/8/12/16 间距。
export default function GradingResultCard({ question, answer, result, isConfirmed, onOpenImages }: Props) {
  const status = !isConfirmed ? 'unanswered' : result?.isCorrect === 2 ? 'correct' : result?.isCorrect === 1 ? 'partial' : 'wrong';
  const labels = { unanswered: '未作答', correct: '正确', partial: '部分正确', wrong: '错误' };
  const icons = { unanswered: '–', correct: '✓', partial: '◐', wrong: '✗' };
  const rows = question.type === 'fill-in-blank' ? getGradedBlankResults(question, answer, result) : [];
  const correctCount = rows.filter(row => row.isCorrect === true).length;
  const known = rows.every(row => row.isCorrect !== null);
  const mode = result?.gradingMode;
  const explanation = (result?.aiExplanation || result?.aiFeedback || '').replace(/^\s*【(?:综合解析|固定判题模式|AI降级判题模式)】\s*/, '');
  const summary = !isConfirmed ? '对照参考答案查看各空内容。' : rows.length && known
    ? correctCount === rows.length ? '答案完全正确' : `${correctCount}个空正确，${rows.length - correctCount}个空错误`
    : status === 'correct' ? '答案完全正确' : rows.length ? '未提供逐空判定，请结合参考答案查看。' : '请对照参考答案查看。';
  const reference = Array.isArray(question.correctAnswer) ? question.correctAnswer.join('、')
    : typeof question.correctAnswer === 'object' ? question.correctAnswer.text : question.correctAnswer;
  const images = typeof question.correctAnswer === 'object' && !Array.isArray(question.correctAnswer) ? question.correctAnswer.images || [] : [];

  return (
    <section className={`grading-card grading-card--${status}`} aria-label="判题结果">
      <div className="grading-card-header">
        <strong className="grading-card-status"><span aria-hidden="true">{icons[status]}</span> {labels[status]}</strong>
        {isConfirmed && <span className="grading-card-score">得分: {result?.score ?? 0}/{question.score}</span>}
      </div>
      {rows.length > 0 && <ol className="grading-card-blanks">
        {rows.map((row, index) => {
          const state = !isConfirmed || row.isCorrect === null ? 'unknown' : row.isCorrect ? 'correct' : 'wrong';
          return <li key={index} className="grading-card-blank">
            <span className={`grading-card-mark grading-card-mark--${state}`} aria-label={state === 'unknown' ? '未判定' : state === 'correct' ? '正确' : '错误'}>{state === 'unknown' ? '–' : state === 'correct' ? '✓' : '✗'}</span>
            <div className="grading-card-blank-content">
              <div><span className="grading-card-label">第{index + 1}空: </span>{isConfirmed ? row.userAnswer || '未作答' : row.correctAnswer}</div>
              {isConfirmed && row.isCorrect !== true && <div className="grading-card-reference">参考答案: {row.correctAnswer}</div>}
            </div>
          </li>;
        })}
      </ol>}
      {images.length > 0 && <div className="grading-card-images">{images.map((image, index) =>
        <button type="button" key={index} onClick={event => onOpenImages(images, index, event.currentTarget.getBoundingClientRect())} aria-label={`放大参考答案图片${index + 1}`}>
          <img src={image} alt={`参考答案图片${index + 1}`} />
        </button>
      )}</div>}
      {!rows.length && <div className="grading-card-answer"><span className="grading-card-label">参考答案: </span>{reference}</div>}
      <div className="grading-card-analysis">
        <div>{mode === 'fixed' ? '【固定判题模式】' : mode === 'ai-fallback' ? '【AI降级判题模式】' : '【综合解析】'}</div>
        <p>{explanation || summary}</p>
        {question.explanation && <div className="grading-card-question-explanation"><span className="grading-card-label">题目解析: </span>{question.explanation}</div>}
      </div>
      {isConfirmed && <footer className="grading-card-method">判题方式: {mode === 'ai' ? 'AI智能判题' : mode === 'fixed' ? '固定规则判题' : mode === 'ai-fallback' ? '固定规则判题（AI降级）' : '未记录'}</footer>}
    </section>
  );
}

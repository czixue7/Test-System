import type { Question, QuestionResult } from '../types';
import { getBlankAnswers, getMultipleChoiceIds, matchDisorderBlanks, matchOrderedBlanks } from '../utils/answerUtils';
import { getGradedBlankResults } from '../utils/practiceGrading';

const answerRow = 'w-full rounded-lg border-2 p-3 text-left text-gray-800 dark:text-gray-100';
const neutral = 'border-transparent bg-gray-50 dark:bg-gray-800';
const correct = 'border-green-500 bg-green-50 dark:border-green-500 dark:bg-green-900/30';
const wrong = 'border-red-400 bg-red-50 dark:border-red-500 dark:bg-red-900/20';
const pending = 'border-orange-400 bg-orange-50 dark:border-orange-500 dark:bg-orange-900/20';
const selected = 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/30';
const emptyField = 'border-transparent bg-gray-100 dark:bg-gray-700';
const field = `${answerRow} outline-none focus:border-blue-300 dark:placeholder-gray-400`;

type Answer = string | string[];
type OpenImages = (images: string[], index: number, rect: DOMRect) => void;
interface Props {
  question: Question;
  answer?: Answer;
  onChange?: (answer: Answer) => void;
  result?: QuestionResult;
  reveal?: boolean;
  practiceFeedback?: boolean;
}

export function isChoiceQuestion(question: Question) {
  return question.type === 'single-choice' || question.type === 'multiple-choice' || question.type === 'true-false';
}

export default function QuestionFields({ question, answer, onChange, result, reveal, practiceFeedback }: Props) {
  const values = Array.isArray(answer) ? answer : typeof answer === 'string' ? [answer] : [];
  if (isChoiceQuestion(question)) {
    const answers = reveal ? getMultipleChoiceIds(question.correctAnswer) : [];
    const multiple = question.type === 'multiple-choice';
    return (
      <div className="space-y-2" aria-label="选项">
        {question.options?.map(option => {
          const picked = values.includes(option.id);
          const right = answers.includes(option.id);
          const style = right ? correct : picked ? (reveal ? wrong : selected) : neutral;
          const content = <>
            <span className="shrink-0 font-medium">{option.id}.</span>
            <span className="min-w-0 selectable whitespace-pre-wrap break-words">{option.content}</span>
            {reveal && (right || picked) && (
              <span className="ml-auto shrink-0 text-sm" aria-label={right ? '参考选项' : '选错'}>{right ? '✓' : '✗'}</span>
            )}
          </>;
          const row = `${answerRow} ${style} flex items-start gap-2`;
          return onChange ? (
            <button type="button" key={option.id} aria-pressed={picked}
              className={`question-choice ${row} focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500`}
              onClick={() => onChange(multiple ? (picked ? values.filter(id => id !== option.id) : [...values, option.id]) : option.id)}>
              {content}
            </button>
          ) : <div key={option.id} className={row}>{content}</div>;
        })}
      </div>
    );
  }

  if (question.type === 'fill-in-blank') {
    const blanks = getBlankAnswers(question.correctAnswer);
    const matches = reveal ? getGradedBlankResults(question, answer, result) : practiceFeedback
      ? (question.allowDisorder ? matchDisorderBlanks(values, blanks) : matchOrderedBlanks(values, blanks)).blankResults
      : [];
    return (
      <div className="space-y-2">
        {blanks.map((_, index) => {
          const value = values[index] ?? '';
          const match = matches[index]?.isCorrect;
          const style = reveal ? (match === true ? correct : match === false ? wrong : emptyField)
            : practiceFeedback && value.trim() ? (match ? correct : pending) : emptyField;
          return <input key={index} type="text" value={value} readOnly={!onChange}
            aria-label={`第${index + 1}空`} placeholder={`第${index + 1}空`} className={`${field} ${style}`}
            onChange={onChange && (event => {
              const next = [...values];
              next[index] = event.target.value;
              onChange(next);
            })} />;
        })}
      </div>
    );
  }

  if (question.type !== 'subjective') return null;
  const value = values.join('、');
  const style = reveal ? (result?.isCorrect === 2 ? correct : result?.isCorrect === 1 ? pending : wrong)
    : practiceFeedback && value.trim() ? pending : emptyField;
  return <textarea value={value} readOnly={!onChange} placeholder="请输入答案" aria-label="答案" rows={4}
    className={`${field} ${style}`} onChange={onChange && (event => onChange(event.target.value))} />;
}

export function ReferenceAnswer({ answer, onOpenImages }: { answer: Question['correctAnswer']; onOpenImages: OpenImages }) {
  const isImageAnswer = typeof answer === 'object' && answer !== null && !Array.isArray(answer);
  const images = isImageAnswer ? answer.images ?? [] : [];
  const text = isImageAnswer ? answer.text : Array.isArray(answer) ? answer.join('、') : answer;
  return <div className={`rounded-lg border-2 p-4 ${correct}`}>
    <div className="mb-1 text-sm font-medium text-green-700 dark:text-green-400">参考答案</div>
    {images.map((src, index) => <button key={index} type="button" className="mb-2 block"
      onClick={event => onOpenImages(images, index, event.currentTarget.getBoundingClientRect())}>
      <img src={src} className="w-full rounded-lg object-contain" alt={`参考答案图片 ${index + 1}`} />
    </button>)}
    <div className="selectable whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100">{text}</div>
  </div>;
}

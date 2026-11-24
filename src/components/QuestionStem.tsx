import type { Question } from '../types';
import { getQuestionTypeLabel } from '../utils/answerUtils';

interface QuestionStemProps {
  question: Question;
  onImageClick?: (images: string[], index: number, rect: DOMRect) => void;
}

export default function QuestionStem({ question, onImageClick }: QuestionStemProps) {
  const images = question.images ?? [];
  return (
    <>
      <div className="selectable break-words whitespace-pre-wrap text-lg font-medium text-gray-800 dark:text-gray-100">
        <span className="mr-2 text-sm font-normal text-gray-600 dark:text-gray-400">
          {getQuestionTypeLabel(question.type)}
        </span>
        {question.content ?? question.question}
      </div>
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {images.map((src, index) => {
            const image = <img key={index} src={src} alt={`题目图片 ${index + 1}`} className="max-h-40 rounded-lg object-contain" />;
            return onImageClick ? (
              <button key={index} type="button" className="min-w-0 justify-self-start"
                onClick={(event) => onImageClick(images, index, event.currentTarget.getBoundingClientRect())}>
                {image}
              </button>
            ) : image;
          })}
        </div>
      )}
    </>
  );
}

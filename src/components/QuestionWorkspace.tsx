import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useKeyboard } from '../hooks/useKeyboard';
import { useSafeArea } from '../hooks/useSafeArea';

const numberStyles = {
  idle: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  correct: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400',
  partial: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-400',
  wrong: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
  answered: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400',
} as const;

export type QuestionTone = keyof typeof numberStyles;
interface Props {
  title?: string;
  timer?: string;
  backLabel: string;
  onBack: () => void;
  headerAction?: ReactNode;
  footerCenter?: ReactNode;
  footerAction?: ReactNode;
  index: number;
  questions: { id: string; tone: QuestionTone }[];
  onSelect: (index: number) => void;
  contentRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}

const stepButton = 'px-4 py-2 rounded-lg bg-gray-100 text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200';

export default function QuestionWorkspace({
  title, timer, backLabel, onBack, headerAction, footerCenter, footerAction,
  index, questions, onSelect, contentRef, children,
}: Props) {
  const navRef = useRef<HTMLDivElement>(null);
  const { isOpen, height } = useKeyboard();
  const safeArea = useSafeArea();
  const questionId = questions[index]?.id;

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    const nav = navRef.current;
    const button = nav?.children[index];
    if (!nav || !button) return;
    const bounds = nav.getBoundingClientRect();
    const active = button.getBoundingClientRect();
    nav.scrollLeft += active.left - bounds.left + (active.width - bounds.width) / 2;
  }, [contentRef, index, questionId]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900"
      style={{ height: `calc(100dvh - ${isOpen ? height : 0}px)` }}>
      <header className="shrink-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg dark:from-blue-700 dark:to-blue-800"
        style={{ paddingTop: safeArea.top }}>
        <div className="mx-auto grid h-9 max-w-lg grid-cols-[1fr_auto_1fr] items-center px-4">
          <button type="button" onClick={onBack} aria-label={backLabel}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-4 text-sm font-medium tabular-nums">
            {title && <h1 className="text-base font-semibold">{title}</h1>}
            <span>{questions.length ? index + 1 : 0}/{questions.length}</span>
            {timer && <span>{timer}</span>}
          </div>
          <div className="justify-self-end">{headerAction}</div>
        </div>
      </header>

      <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}>
        <div key={questionId} className="mx-auto max-w-lg px-4 py-4 pb-6">{children}</div>
      </div>

      <div className="shrink-0 border-t border-gray-200 bg-white px-4 pt-2 dark:border-gray-700 dark:bg-gray-800"
        style={{ paddingBottom: Math.max(isOpen ? 8 : safeArea.bottom, 8) }}>
        <div className="mx-auto max-w-lg">
          <div ref={navRef} className="mb-2 flex gap-1 overflow-x-auto scrollbar-hide"
            role="group" aria-label="选题"
            onWheel={(event) => { event.currentTarget.scrollLeft += event.deltaY; }}>
            {questions.map(({ id, tone }, position) => (
              <button type="button" key={id} onClick={() => onSelect(position)} aria-current={position === index ? 'step' : undefined}
                className={`h-8 w-8 shrink-0 rounded text-xs font-medium ${position === index ? 'bg-blue-500 text-white' : numberStyles[tone]}`}>
                {position + 1}
              </button>
            ))}
          </div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <button type="button" onClick={() => onSelect(index - 1)} disabled={index <= 0} className={stepButton}>上一题</button>
            {footerCenter}
            {footerAction ?? <button type="button" onClick={() => onSelect(index + 1)}
              disabled={index >= questions.length - 1} className={stepButton}>下一题</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

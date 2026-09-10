import React, { useState } from 'react';
import Modal from './Modal';

interface ResumePromptModalProps {
  mode: 'practice' | 'exam';
  currentQuestion: number;
  totalQuestions: number;
  elapsedSeconds: number;
  onResume: () => void;
  onRestart: () => void;
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const ResumePromptModal: React.FC<ResumePromptModalProps> = ({
  mode,
  currentQuestion,
  totalQuestions,
  elapsedSeconds,
  onResume,
  onRestart
}) => {
  const [open, setOpen] = useState(true);

  const handleResume = () => {
    setOpen(false);
    setTimeout(onResume, 240);
  };

  const handleRestart = () => {
    setOpen(false);
    setTimeout(onRestart, 240);
  };

  const modeText = mode === 'practice' ? '练习' : '考试';

  return (
    <Modal open={open} onClose={() => {}} overlayClose={false} className="rounded-3xl p-6 w-full max-w-sm">
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 bg-blue-500 text-white rounded-full flex items-center justify-center mb-4 shadow-lg">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <p className="text-gray-800 dark:text-gray-200 text-base font-medium mb-1 leading-relaxed">
          发现未完成的{modeText}进度
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
          上次做到第 {Math.min(currentQuestion + 1, totalQuestions)}/{totalQuestions} 题，已用时 {formatTime(elapsedSeconds)}
        </p>

        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={handleResume}
            className="w-full py-2.5 px-4 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-all duration-200 active:scale-95 shadow-md"
          >
            继续{modeText}
          </button>
          <button
            onClick={handleRestart}
            className="w-full py-2.5 px-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 active:scale-95"
          >
            重新开始
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ResumePromptModal;

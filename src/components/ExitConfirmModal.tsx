import React, { useEffect, useState } from 'react';

interface ExitConfirmModalProps {
  title?: string;
  message: string;
  onSave: () => void;
  onExitWithoutSave: () => void;
  onCancel: () => void;
  saveText?: string;
  exitText?: string;
  cancelText?: string;
}

const ExitConfirmModal: React.FC<ExitConfirmModalProps> = ({
  title = '退出提醒',
  message,
  onSave,
  onExitWithoutSave,
  onCancel,
  saveText = '保存并退出',
  exitText = '不保存退出',
  cancelText = '继续答题'
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const handleSave = () => {
    setVisible(false);
    setTimeout(onSave, 300);
  };

  const handleExit = () => {
    setVisible(false);
    setTimeout(onExitWithoutSave, 300);
  };

  const handleCancel = () => {
    setVisible(false);
    setTimeout(onCancel, 300);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div
        className={`bg-white dark:bg-gray-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl transform transition-all duration-300 ease-out ${
          visible ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
        }`}
      >
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 bg-blue-500 text-white rounded-full flex items-center justify-center mb-4 shadow-lg">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          </div>

          <p className="text-gray-800 dark:text-gray-200 text-base font-medium mb-1 leading-relaxed">
            {title}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
            {message}
          </p>

          <div className="flex flex-col gap-2 w-full">
            <button
              onClick={handleSave}
              className="w-full py-2.5 px-4 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-all duration-200 active:scale-95 shadow-md"
            >
              {saveText}
            </button>
            <button
              onClick={handleExit}
              className="w-full py-2.5 px-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 active:scale-95"
            >
              {exitText}
            </button>
            <button
              onClick={handleCancel}
              className="w-full py-2.5 px-4 text-gray-500 dark:text-gray-400 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all duration-200 active:scale-95"
            >
              {cancelText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExitConfirmModal;

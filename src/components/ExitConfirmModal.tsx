import React, { useRef, useState } from 'react';
import Modal from './Modal';

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
  const [open, setOpen] = useState(true);

  // 关闭动画期间按钮仍可点击（Modal 要等 duration 后才 visible=false）。
  // 不加锁的话：连点「不保存退出」会执行两次 goBack()（navigate(-1) 连退两层）；
  // 先点「保存并退出」再点「不保存退出」会先保存后删除。
  const firedRef = useRef(false);

  const fire = (callback: () => void) => {
    if (firedRef.current) return;
    firedRef.current = true;
    setOpen(false);
    setTimeout(callback, 240);
  };

  const handleSave = () => fire(onSave);

  const handleExit = () => fire(onExitWithoutSave);

  const handleCancel = () => fire(onCancel);

  return (
    <Modal open={open} onClose={() => {}} overlayClose={false} className="rounded-3xl p-6 w-full max-w-sm">
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
            disabled={!open}
            className="w-full py-2.5 px-4 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-all duration-200 active:scale-95 shadow-md"
          >
            {saveText}
          </button>
          <button
            onClick={handleExit}
            disabled={!open}
            className="w-full py-2.5 px-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 active:scale-95"
          >
            {exitText}
          </button>
          <button
            onClick={handleCancel}
            disabled={!open}
            className="w-full py-2.5 px-4 text-gray-500 dark:text-gray-400 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all duration-200 active:scale-95"
          >
            {cancelText}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ExitConfirmModal;

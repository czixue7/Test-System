import React, { useEffect, useState } from 'react';

/**
 * 通用确认弹窗：复用项目已有 modal-fade / modal-pop 动效，
 * 打开与关闭动效对称（关闭使用 modal-fade-out / modal-pop-out）。
 */
const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, message, confirmText = '删除', cancelText = '取消', onConfirm, onCancel }) => {
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) setClosing(false);
  }, [open]);

  if (!open) return null;

  const handleCancel = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => { setClosing(false); onCancel(); }, 180);
  };

  const handleConfirm = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => { setClosing(false); onConfirm(); }, 180);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      style={{ animation: closing ? 'modal-fade-out 0.18s ease-in forwards' : 'modal-fade 0.2s ease-out' }}
      onClick={handleCancel}>
      <div
        className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-xl"
        style={{ animation: closing ? 'modal-pop-out 0.18s ease-in forwards' : 'modal-pop 0.25s ease-out' }}
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-800 dark:text-white">{title}</h3>
        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{message}</div>
        <div className="mt-5 flex gap-3">
          <button
            onClick={handleCancel}
            className="flex-1 py-2.5 text-sm rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 text-sm rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors">
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

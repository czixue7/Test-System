import React from 'react';
import Modal from './Modal';

/**
 * 通用确认弹窗：统一使用 Modal 毛玻璃封装（与"关于"弹窗同款遮罩渐变 + 本体动效）。
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
  return (
    <Modal open={open} onClose={onCancel} zIndex={70} className="w-full max-w-sm rounded-2xl p-5 shadow-xl">
      <h3 className="text-base font-semibold text-gray-800 dark:text-white">{title}</h3>
      <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{message}</div>
      <div className="mt-5 flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 text-sm rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
          {cancelText}
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-2.5 text-sm rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors">
          {confirmText}
        </button>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;

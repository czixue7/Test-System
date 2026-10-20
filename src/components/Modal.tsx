import React, { useEffect, useState } from 'react';

interface ModalProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调（点击遮罩 / 外部触发关闭时调用） */
  onClose: () => void;
  /** 弹窗内容 */
  children: React.ReactNode;
  /** 弹窗卡片附加类（宽度 / 圆角 / 内边距等，背景由 app-modal-card 统一毛玻璃） */
  className?: string;
  /** 遮罩容器附加类（如 items-end 底部抽屉、items-start 顶部弹层） */
  containerClassName?: string;
  /** 层级，默认 50 */
  zIndex?: number;
  /** 是否允许点击遮罩关闭，默认 true */
  overlayClose?: boolean;
  /** 进出动画时长（ms），默认 220 */
  duration?: number;
}

/**
 * 统一弹窗组件：遮罩背景虚化 + 淡入淡出渐变，本体毛玻璃 + 缩放弹出/收起。
 * 所有页面弹窗统一调用本组件，保证动效一致（与"关于"弹窗效果相同）。
 */
const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  children,
  className = '',
  containerClassName = '',
  zIndex = 50,
  overlayClose = true,
  duration = 220,
}) => {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setClosing(false);
      setVisible(true);
    } else {
      setClosing(true);
      const t = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, duration);
      return () => clearTimeout(t);
    }
  }, [open, duration]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 app-modal-overlay ${containerClassName}`}
      style={{
        zIndex,
        animation: closing
          ? `modal-fade-out ${duration}ms ease-in forwards`
          : `modal-fade ${duration}ms ease-out`,
      }}
      onClick={() => {
        if (overlayClose) onClose();
      }}
    >
      <div
        className={`app-modal-card ${className}`}
        style={{
          animation: closing
            ? `modal-pop-out ${duration}ms ease-in forwards`
            : `modal-pop ${duration}ms ease-out`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

export default Modal;

import { useCallback } from 'react';
import { useToastStore, ToastType } from '../components/Toast';

export interface UseToastReturn {
  showToast: (message: string, type?: ToastType, duration?: number) => string;
  showSuccess: (message: string, duration?: number) => string;
  showError: (message: string, duration?: number) => string;
  showWarning: (message: string, duration?: number) => string;
  showInfo: (message: string, duration?: number) => string;
  removeToast: (id: string) => void;
  clearAllToasts: () => void;
}

export const useToast = (): UseToastReturn => {
  const { addToast, removeToast, clearToasts } = useToastStore();

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration?: number): string => {
      return addToast(message, type, duration);
    },
    [addToast]
  );

  const showSuccess = useCallback(
    (message: string, duration?: number): string => {
      return addToast(message, 'success', duration);
    },
    [addToast]
  );

  const showError = useCallback(
    (message: string, duration?: number): string => {
      return addToast(message, 'error', duration);
    },
    [addToast]
  );

  const showWarning = useCallback(
    (message: string, duration?: number): string => {
      return addToast(message, 'warning', duration);
    },
    [addToast]
  );

  const showInfo = useCallback(
    (message: string, duration?: number): string => {
      return addToast(message, 'info', duration);
    },
    [addToast]
  );

  const clearAllToasts = useCallback(() => {
    clearToasts();
  }, [clearToasts]);

  return {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    removeToast,
    clearAllToasts,
  };
};

export default useToast;

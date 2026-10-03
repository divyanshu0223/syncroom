import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextType {
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type, title, description }: Omit<ToastMessage, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      setToasts((prev) => [...prev, { id, type, title, description }]);

      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ showToast, removeToast }}>
      {children}

      {/* Toast Notification Container */}
      <div
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start justify-between gap-3 p-3.5 rounded-xl bg-neutral-900/95 border border-neutral-800 shadow-2xl backdrop-blur-xl text-neutral-100 transition-all animate-in slide-in-from-bottom-2 fade-in"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <span className="shrink-0 mt-0.5">
                {toast.type === 'success' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                )}
                {toast.type === 'error' && (
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                )}
                {toast.type === 'info' && (
                  <Info className="w-4 h-4 text-sky-400" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-neutral-100">{toast.title}</p>
                {toast.description && (
                  <p className="text-[11px] text-neutral-400 mt-0.5">{toast.description}</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="text-neutral-500 hover:text-neutral-300 p-0.5 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

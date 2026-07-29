"use client";

import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastTone = "info" | "success" | "warning" | "danger";

type ToastInput = {
  title: string;
  body?: string;
  tone?: ToastTone;
  durationMs?: number;
};

type Toast = Required<Omit<ToastInput, "body">> & { id: string; body?: string };

type ToastContextValue = {
  notify: (toast: ToastInput) => void;
};

const toneStyles: Record<ToastTone, string> = {
  info: "border-border bg-surface-raised text-foreground",
  success: "border-accent/30 bg-surface-raised text-foreground",
  warning: "border-warning/30 bg-surface-raised text-foreground",
  danger: "border-danger/30 bg-surface-raised text-foreground",
};

const toneIconStyles: Record<ToastTone, string> = {
  info: "text-ring",
  success: "text-accent",
  warning: "text-warning",
  danger: "text-danger",
};

const toneIcons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: CircleAlert,
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback((input: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toast: Toast = {
      id,
      title: input.title,
      body: input.body,
      tone: input.tone ?? "info",
      durationMs: input.durationMs ?? 5000,
    };
    setToasts((current) => [...current.slice(-2), toast]);
    timers.current.set(
      id,
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id));
        timers.current.delete(id);
      }, toast.durationMs),
    );
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:right-6 md:left-auto md:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const Icon = toneIcons[toast.tone];
          return (
            <div
              key={toast.id}
              className={`toast-enter pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border p-4 shadow-xl ${toneStyles[toast.tone]}`}
              role={toast.tone === "danger" ? "alert" : "status"}
            >
              <Icon className={`mt-0.5 size-5 shrink-0 ${toneIconStyles[toast.tone]}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.body && <p className="mt-1 text-sm leading-5 text-muted-foreground">{toast.body}</p>}
              </div>
              <button
                className="focus-ring -m-1 grid size-8 shrink-0 place-items-center rounded-control text-muted-foreground hover:text-foreground"
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={`Dismiss ${toast.title}`}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider.");
  return value;
}

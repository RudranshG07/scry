"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncStatus = "loading" | "ready" | "error";

export type AsyncResult<T> = {
  status: AsyncStatus;
  data: T | null;
  error: Error | null;
  isRefreshing: boolean;
  retry: () => void;
  setData: (updater: (current: T | null) => T | null) => void;
};

type AsyncOptions = {
  refreshMs?: number;
  enabled?: boolean;
};

function toError(value: unknown) {
  if (value instanceof Error) return value;
  return new Error("Request failed.");
}

function isAbort(value: unknown) {
  return value instanceof DOMException && value.name === "AbortError";
}

export function useAsync<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
  options: AsyncOptions = {},
): AsyncResult<T> {
  const { refreshMs = 0, enabled = true } = options;
  const loaderRef = useRef(loader);

  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [data, setState] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isRefreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    const controller = new AbortController();

    async function run(background: boolean) {
      if (background) setRefreshing(true);
      else {
        setStatus("loading");
        setError(null);
      }
      try {
        const result = await loaderRef.current(controller.signal);
        if (!active) return;
        setState(result);
        setError(null);
        setStatus("ready");
      } catch (cause) {
        if (!active || isAbort(cause) || controller.signal.aborted) return;
        setError(toError(cause));
        if (!background) setStatus("error");
      } finally {
        if (active) setRefreshing(false);
      }
    }

    void run(false);

    const timer = refreshMs > 0 ? window.setInterval(() => void run(true), refreshMs) : null;
    return () => {
      active = false;
      controller.abort();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [key, attempt, refreshMs, enabled]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const setDataDirect = useCallback((updater: (current: T | null) => T | null) => {
    setState((current) => updater(current));
  }, []);

  return {
    status: enabled ? status : "ready",
    data,
    error,
    isRefreshing,
    retry,
    setData: setDataDirect,
  };
}

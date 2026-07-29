"use client";

import { useSyncExternalStore } from "react";

type ClockListener = () => void;

const listeners = new Set<ClockListener>();

let snapshot = 0;
let timer: number | null = null;

function publish() {
  snapshot = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: ClockListener) {
  listeners.add(listener);
  if (timer === null) {
    snapshot = Date.now();
    timer = window.setInterval(publish, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

function readSnapshot() {
  return snapshot;
}

function readServerSnapshot() {
  return 0;
}

export function useNow() {
  return useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
}

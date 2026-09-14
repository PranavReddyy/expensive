"use client";

import { useCallback, useEffect, useRef } from "react";
import { createLatestRequest } from "./latest-request.mjs";

export function useLatestRequest(task) {
  const request = useRef(null);
  if (!request.current) request.current = createLatestRequest();
  // Loaders only capture stable setters; each invocation uses the current task.
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });
  useEffect(() => () => request.current.cancel(), []);
  return useCallback((...args) => request.current.run(taskRef.current, ...args), []);
}

// Keep realtime subscriptions connected while their current query arguments change.
export function useEventCallback(callback) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });
  return useCallback((...args) => callbackRef.current(...args), []);
}

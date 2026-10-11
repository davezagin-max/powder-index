"use client";

import { useSyncExternalStore } from "react";

/**
 * The selected date and resort live in the URL (`?date=2026-02-19&resort=alta`), so a
 * reload or a shared link lands on the same view. The URL is the single source of
 * truth: components read it through `useSearch` and write it with `setParams`. There is
 * no copy of this state in React or in localStorage to fall out of step with it.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/** The current query string. Empty on the server and during hydration. */
export function useSearch(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
}

/** Sets or removes (null) query parameters without adding a history entry. */
export function setParams(updates: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(updates)) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  window.history.replaceState(window.history.state, "", url);
  listeners.forEach((listener) => listener());
}

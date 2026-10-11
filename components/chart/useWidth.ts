"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks an element's width so an SVG chart can be drawn at real pixel size (crisp
 * text, hairlines that stay one pixel) instead of being stretched by a viewBox.
 * `fallback` is used for the server render and the first client render.
 */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

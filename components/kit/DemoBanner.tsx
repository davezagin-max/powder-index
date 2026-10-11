"use client";

import { useKey } from "./KeyProvider";

interface DemoBannerProps {
  /**
   * True while the fixtures are hand-written samples rather than recorded
   * model runs. The banner says so plainly instead of implying a real run.
   */
  placeholder?: boolean;
  /** Set to false for projects whose core features need no key at all. */
  aiRequired?: boolean;
}

export function DemoBanner({ placeholder = false, aiRequired = true }: DemoBannerProps) {
  const { isLive, openKeyModal } = useKey();

  if (isLive) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-success" />
          Live. Your questions go to Claude Opus 5.5 with your key.
        </span>
        <button type="button" onClick={openKeyModal} className="underline underline-offset-2">
          Change key
        </button>
      </div>
    );
  }

  // The dashboard itself needs no key and shows real pipeline data either way. Only
  // "Ask the data" changes: presets replay bundled answers, and the wording says which kind.
  const short = placeholder
    ? "Demo mode: real snow data, sample answers for the preset questions."
    : "Demo mode: real snow data, recorded Claude answers for the preset questions.";
  const message = !aiRequired
    ? "Everything here works without a key. Add one to turn on the Claude Opus 5.5 features."
    : placeholder
      ? "Demo mode. The snow data is real; the preset questions show sample SQL until a real Claude Opus 5.5 run is recorded. Add your key to ask your own."
      : "Demo mode. The snow data is real, and the preset questions replay recorded Claude Opus 5.5 answers. Add your key to ask your own.";

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-2 text-sm"
    >
      {aiRequired ? (
        <>
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{message}</span>
        </>
      ) : (
        <span>{message}</span>
      )}
      <button
        type="button"
        onClick={openKeyModal}
        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90"
      >
        Add key
      </button>
    </div>
  );
}

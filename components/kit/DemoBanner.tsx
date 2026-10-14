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
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-surface-2/70 px-4 py-1.5 text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-success" />
          Live: your questions go to Claude Opus 5.5 with your key.
        </span>
        <button type="button" onClick={openKeyModal} className="font-medium text-fg underline underline-offset-2">
          Change key
        </button>
      </div>
    );
  }

  // The dashboard itself needs no key and shows real pipeline data either way. Only
  // "Ask the data" changes: presets replay bundled answers, and the wording says which kind.
  // One calm line: it is a note about the demo, not a warning.
  const short = placeholder ? "Demo: real snow data, pre-written AI answers." : "Demo: real snow data, recorded AI answers.";
  const message = !aiRequired
    ? "Everything here works without a key. Add one to turn on the Claude Opus 5.5 features."
    : placeholder
      ? "Demo: the snow data is real; the AI answers are pre-written examples. Add your Anthropic API key to run it live."
      : "Demo: the snow data is real; the AI answers replay recorded Claude Opus 5.5 runs. Add your Anthropic API key to ask your own.";

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-surface-2/70 px-4 py-1.5 text-xs text-muted"
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
        className="rounded border border-border bg-surface px-2 py-0.5 font-medium text-fg hover:border-accent"
      >
        Add key
      </button>
    </div>
  );
}

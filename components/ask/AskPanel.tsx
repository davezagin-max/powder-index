"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CostMeter } from "@/components/kit/CostMeter";
import { useKey } from "@/components/kit/KeyProvider";
import { ASK_FIXTURES, ASK_HAS_PLACEHOLDERS, PRESETS } from "@/lib/ask/presets";
import { runAsk, type AskOutcome, type AskPhase, type AskRequest } from "@/lib/ask/run";
import { VALIDATOR_ROW_CAP, type TrailStep } from "@/lib/ask/schema";
import { buildChartModel } from "@/lib/chart/model";
import { callApi } from "@/lib/client";
import { formatDate } from "@/lib/data/dates";
import { runQuery, type EngineStage } from "@/lib/duck/engine";
import { ResultChart } from "./ResultChart";
import { ResultTable } from "./ResultTable";
import { SchemaReference } from "./SchemaReference";
import { SqlBlock } from "./SqlBlock";

type Finished = Exclude<AskOutcome, { status: "cancelled" }>;
type Run =
  | { state: "idle" }
  | { state: "busy"; question: string; status: string }
  | { state: "done"; question: string; outcome: Finished };

const STAGE_TEXT = {
  validator: "Blocked by the SQL firewall",
  engine: "Rejected by DuckDB",
} as const;

function statusFor(phase: AskPhase | EngineStage, live: boolean): string {
  if (phase === "engine") return "Starting DuckDB in your browser (about 7 MB the first time)…";
  if (phase === "data") return "Loading the snow tables…";
  switch (phase.phase) {
    case "asking":
      return phase.attempt === 1
        ? "Claude Opus 5.5 is writing the SQL…"
        : `Claude is correcting the SQL (try ${phase.attempt} of 3)…`;
    case "running":
      return live ? "Running the validated SQL in your browser…" : "Running the SQL in your browser…";
    case "retrying":
      return "DuckDB rejected that query. Sending its error back to Claude…";
  }
}

/** Says where an answer came from, in words that follow the fixture's own flag. */
function provenance(outcome: Extract<Finished, { status: "answered" | "declined" }>): string {
  const { meta } = outcome;
  if (meta.mode === "live") return "Written just now by Claude Opus 5.5 with your key.";
  if (meta.placeholder) {
    return "Sample answer: this SQL was written by hand and stands in until a real Claude Opus 5.5 run is recorded. The rows are real.";
  }
  const when = meta.recordedAt ? ` on ${formatDate(meta.recordedAt.slice(0, 10), "medium")}` : "";
  return `Replaying a Claude Opus 5.5 answer recorded${when}. The SQL ran again just now in your browser.`;
}

/**
 * The failed attempts that came before an answer. `sample` is the fixture's own
 * placeholder flag: a hand-written trail is never described as the model correcting
 * itself, even though each error shown is the one that SQL really produces.
 */
function Trail({ steps, resolved, sample = false }: { steps: TrailStep[]; resolved: boolean; sample?: boolean }) {
  if (steps.length === 0) return null;
  const attempts = steps.length === 1 ? "one attempt" : `${steps.length} attempts`;
  return (
    <section aria-label="Earlier attempts" className="rounded-md border border-border">
      <h4 className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-medium">
        {!resolved
          ? `${steps.length} ${steps.length === 1 ? "attempt" : "attempts"} failed`
          : sample
            ? `Sample retry trail: ${attempts} written by hand to fail, with the real error each one gets back`
            : `Self-corrected: ${attempts} failed before this one worked`}
      </h4>
      <ol className="divide-y divide-border">
        {steps.map((step, index) => (
          <li key={index} className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
            <p>
              <span className="font-medium">
                Attempt {index + 1}. {STAGE_TEXT[step.stage]}:
              </span>{" "}
              <span className="text-danger">{step.error}</span>
            </p>
            <details>
              <summary className="cursor-pointer text-xs text-muted">Show the SQL that failed</summary>
              <pre className="mt-1.5 overflow-auto rounded bg-surface-2 p-2 font-mono text-xs leading-relaxed">{step.sql}</pre>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Answer({ outcome }: { outcome: Extract<Finished, { status: "answered" }> }) {
  const { data, result } = outcome;
  const model = useMemo(() => buildChartModel(result, data.chart!), [result, data.chart]);
  const [view, setView] = useState<"chart" | "table">("chart");
  const showing = model.kind === "table" ? "table" : view;
  // Only worth saying when the firewall's own cap cut the result short, not when the
  // query asked for "top 10" and got ten.
  const capped = result.rows.length >= VALIDATOR_ROW_CAP;
  return (
    <figure className="flex flex-col gap-4">
      <figcaption className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-snug">{data.title}</h3>
          {data.note && <p className="mt-0.5 text-sm text-muted">{data.note}</p>}
        </div>
        {model.kind !== "table" && (
          <div role="group" aria-label="View" className="inline-flex shrink-0 overflow-hidden rounded-md border border-border text-sm">
            {(["chart", "table"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                aria-pressed={view === option}
                className={`px-3 py-1.5 capitalize ${view === option ? "bg-accent text-accent-fg" : "bg-surface hover:bg-surface-2"}`}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </figcaption>

      <Trail steps={outcome.trail} resolved sample={outcome.meta.mode === "demo" && outcome.meta.placeholder} />

      {showing === "chart" && model.kind !== "table" ? (
        <ResultChart model={model} />
      ) : (
        <>
          {model.kind === "table" && model.reason && <p className="text-sm text-muted">{model.reason}</p>}
          <ResultTable result={result} caption={data.title ?? "Query result"} />
        </>
      )}

      <p className="text-xs text-muted">
        {result.rows.length.toLocaleString("en-US")} {result.rows.length === 1 ? "row" : "rows"} in{" "}
        {result.elapsedMs < 1 ? "under 1" : Math.round(result.elapsedMs)} ms, computed in your browser by DuckDB-WASM
        from the published Parquet files.
        {capped && ` The result stops at the firewall's cap of ${VALIDATOR_ROW_CAP.toLocaleString("en-US")} rows, so there may be more.`}
      </p>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">The SQL that ran</p>
        <SqlBlock sql={data.sql!} label="The SQL that ran" />
        <p className="text-xs text-muted">
          Regenerated by the SQL firewall from the query&apos;s syntax tree: one SELECT, published tables only,
          allowlisted functions, and a LIMIT it adds or clamps.
        </p>
      </div>
    </figure>
  );
}

/**
 * Question in, SQL and a chart out. With no key the presets replay bundled answers
 * entirely in the browser. With a key the question goes to Claude through /api/ask.
 */
export function AskPanel({ dataUrl }: { dataUrl: string }) {
  const { apiKey, isLive, openKeyModal } = useKey();
  const [run, setRun] = useState<Run>({ state: "idle" });
  const [question, setQuestion] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Leaving the page mid-run must not leave a request spending the visitor's key.
  useEffect(() => () => controller.current?.abort(), []);

  function stop() {
    controller.current?.abort();
    controller.current = null;
    setRun({ state: "idle" });
    setActivePreset(null);
  }

  async function ask(text: string, presetId?: string) {
    // Starting a new question abandons the old one, including its retries.
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    const live = apiKey !== null;
    setActivePreset(presetId ?? null);
    setRun({ state: "busy", question: text, status: live ? statusFor({ phase: "asking", attempt: 1 }, live) : statusFor("engine", live) });
    const report = (phase: AskPhase | EngineStage) => {
      if (controller.current === mine) setRun({ state: "busy", question: text, status: statusFor(phase, live) });
    };
    const outcome = await runAsk(text, presetId, {
      apiKey,
      fixtures: ASK_FIXTURES,
      post: (body: AskRequest, signal) => callApi("/api/ask", body, apiKey, signal),
      execute: (sql) => runQuery(dataUrl, sql, { onStage: report }),
      signal: mine.signal,
      onPhase: report,
    });
    if (controller.current !== mine || outcome.status === "cancelled") return;
    controller.current = null;
    setRun({ state: "done", question: text, outcome });
    // Bring the answer to the top of the screen: the chart is the point, and "nearest"
    // would leave only its title peeking in at the bottom.
    // A `behavior` passed from script overrides the stylesheet, so the reduced-motion
    // preference has to be read here as well.
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  }

  const busy = run.state === "busy";
  const outcome = run.state === "done" ? run.outcome : null;
  const meta = outcome && "meta" in outcome ? outcome.meta : null;

  return (
    <section id="ask" aria-labelledby="ask-heading" className="rounded-lg border border-border bg-surface p-4 sm:p-6">
      <div className="max-w-3xl">
        <h2 id="ask-heading" className="text-xl font-semibold tracking-tight">
          Ask the data
        </h2>
        <p className="mt-1 text-sm text-muted">
          A question becomes one SQL query. Claude Opus 5.5 writes it, a sqlglot firewall decides whether it may run,
          and DuckDB runs it here in your browser. Claude never sees a row and never states a number.
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p id="preset-label" className="text-xs font-medium uppercase tracking-wider text-muted">
          {isLive
            ? "Try one"
            : ASK_HAS_PLACEHOLDERS
              ? "Preset questions (sample answers, no key needed)"
              : "Preset questions (recorded answers, no key needed)"}
        </p>
        <ul aria-labelledby="preset-label" className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => ask(preset.question, preset.id)}
                aria-pressed={activePreset === preset.id}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  activePreset === preset.id
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-surface hover:border-accent hover:bg-accent-soft"
                }`}
              >
                {preset.question}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          const text = question.trim();
          if (text.length >= 3 && isLive) ask(text);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <input
          id="ask-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={400}
          disabled={!isLive}
          aria-describedby="ask-hint"
          placeholder={isLive ? "Which resort had the coldest storm days?" : "Your own questions need an Anthropic key"}
          className="h-10 min-w-0 shrink-0 rounded-md border border-border bg-bg px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70 sm:flex-1"
        />
        {isLive ? (
          <button
            type="submit"
            disabled={busy || question.trim().length < 3}
            className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            Ask
          </button>
        ) : (
          <button type="button" onClick={openKeyModal} className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90">
            Add key to ask your own
          </button>
        )}
      </form>
      <p id="ask-hint" className="mt-1.5 text-xs text-muted">
        {isLive
          ? "Expect a cent or two per question on your key. The exact cost is shown under the answer."
          : "The presets above run without a key. Their SQL is bundled with the page and executed live against the data."}
      </p>

      <SchemaReference />

      <div ref={resultRef} aria-live="polite" className="mt-5 min-h-16 scroll-mt-4 border-t border-border pt-5">
        {run.state === "idle" && (
          <p className="text-sm text-muted">Pick a question to see the SQL, the chart, and the rows behind it.</p>
        )}

        {run.state === "busy" && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-border border-t-accent" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{run.question}</span>
              <span className="block text-muted">{run.status}</span>
            </span>
            <button type="button" onClick={stop} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
              Stop
            </button>
          </div>
        )}

        {outcome && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              <span className="text-muted">Question:</span> <span className="font-medium">{run.state === "done" && run.question}</span>
            </p>

            {outcome.status === "answered" && <Answer outcome={outcome} />}

            {outcome.status === "declined" && (
              <div className="rounded-md border border-border bg-surface-2 p-4 text-sm">
                <p className="font-medium">The data cannot answer that.</p>
                <p className="mt-1 text-muted">{outcome.data.reason}</p>
              </div>
            )}

            {outcome.status === "failed" && (
              <div className="flex flex-col gap-3">
                <div role="alert" className="rounded-md border border-danger/40 bg-surface-2 p-4 text-sm">
                  <p className="font-medium">No query made it through.</p>
                  <p className="mt-1 text-muted">{outcome.reason}</p>
                </div>
                <Trail steps={outcome.trail} resolved={false} />
              </div>
            )}

            {outcome.status === "error" && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-danger/40 bg-surface-2 p-4 text-sm">
                <p className="min-w-0 flex-1">
                  <span className="font-medium">
                    {outcome.kind === "refusal"
                      ? "" // the server's message already opens with "Claude declined this request"
                      : outcome.kind === "auth"
                        ? "Key problem. "
                        : outcome.kind === "rate_limit"
                          ? "Slow down. "
                          : outcome.kind === "demo_miss"
                            ? "Key needed. "
                            : "That did not work. "}
                  </span>
                  {outcome.message}
                </p>
                {(outcome.kind === "auth" || outcome.kind === "demo_miss") && (
                  <button type="button" onClick={openKeyModal} className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg">
                    {outcome.kind === "auth" ? "Change key" : "Add key"}
                  </button>
                )}
              </div>
            )}

            {(outcome.status === "answered" || outcome.status === "declined") && (
              <p className="text-xs text-muted">{provenance(outcome)}</p>
            )}
            <CostMeter meta={meta} />
          </div>
        )}
      </div>
    </section>
  );
}

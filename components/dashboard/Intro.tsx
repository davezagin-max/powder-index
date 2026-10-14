import { formatDate } from "@/lib/data/dates";
import { inches } from "@/lib/data/select";
import type { BestDay } from "@/lib/data/types";

/** The three stages of the product, in words a non-engineer can follow. */
const STEPS = [
  { title: "Weather stations measure the snow", detail: "Public USDA and National Weather Service data" },
  { title: "A data pipeline scores each resort", detail: "Python and dbt turn readings into a 0 to 100 score" },
  { title: "You ask, Claude writes the query", detail: "A safety check approves it; your browser runs it" },
];

const primary =
  "inline-flex min-h-11 items-center justify-center gap-x-2 gap-y-0.5 rounded-md bg-accent px-4 py-2 text-left text-sm font-medium text-accent-fg hover:opacity-90 flex-wrap";
const secondary =
  "inline-flex min-h-11 items-center justify-center gap-x-2 gap-y-0.5 rounded-md border border-border bg-surface px-4 py-2 text-left text-sm font-medium hover:border-accent hover:bg-accent-soft flex-wrap";

function AskButton({ question, onAsk, isPrimary }: { question: string; onAsk: () => void; isPrimary: boolean }) {
  return (
    <button type="button" onClick={onAsk} className={isPrimary ? primary : secondary}>
      <span>Ask the data</span>
      <span className={`font-normal ${isPrimary ? "opacity-85" : "text-muted"}`}>“{question}”</span>
    </button>
  );
}

/**
 * The first thing on the page: what this is, one sentence on how, and the one click
 * that starts the demo. Replaying the best day comes first because the page opens on
 * today, which in the off-season is a row of zeros; once that day is showing, asking
 * the data becomes the next step.
 */
export function Intro({
  resortCount,
  best,
  onBestDay,
  isLatest,
  onReplay,
  onLatest,
  askQuestion,
  onAsk,
}: {
  resortCount: number;
  best: BestDay | undefined;
  onBestDay: boolean;
  isLatest: boolean;
  onReplay: () => void;
  onLatest: () => void;
  askQuestion: string;
  onAsk: () => void;
}) {
  const replayFirst = best !== undefined && !onBestDay;
  return (
    <section
      aria-labelledby="intro-heading"
      className="grid grid-cols-1 gap-x-10 gap-y-5 border-b border-border pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:items-center"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <h1 id="intro-heading" className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Which Utah ski resort has the best fresh snow?
          </h1>
          <p className="mt-2 max-w-2xl leading-relaxed text-muted">
            Powder Index ranks {resortCount} Utah ski resorts every day with a score from 0 to 100, built from public
            weather-station data. You can also ask the data a question in plain English.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {replayFirst ? (
            <>
              <button type="button" onClick={onReplay} className={primary}>
                <span>Replay the best day of last winter</span>
                <span className="font-normal opacity-85">
                  {formatDate(best.date, "short")}: {inches(best.maxNew24)}″ of new snow
                </span>
              </button>
              <AskButton question={askQuestion} onAsk={onAsk} isPrimary={false} />
            </>
          ) : (
            <>
              <AskButton question={askQuestion} onAsk={onAsk} isPrimary />
              {!isLatest && (
                <button type="button" onClick={onLatest} className={secondary}>
                  Back to today
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 rounded-lg border border-border bg-surface/80 px-4 py-3.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">How it works</p>
        <ol className="mt-2 flex flex-col gap-2">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span aria-hidden className="flex flex-col items-center pt-1.5">
                <span className="size-2 shrink-0 rounded-full bg-accent" />
                {i < STEPS.length - 1 && <span className="-mb-3 mt-1 w-px flex-1 bg-border" />}
              </span>
              <span className="min-w-0 text-sm">
                <span className="block font-medium leading-snug">{step.title}</span>
                <span className="block text-xs leading-snug text-muted">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

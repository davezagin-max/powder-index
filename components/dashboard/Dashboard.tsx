"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AskPanel, type AskPanelHandle } from "@/components/ask/AskPanel";
import { SafetyNotice } from "@/components/SiteFooter";
import { formatDate, isIsoDate } from "@/lib/data/dates";
import { BUNDLED_DATA_URL, PUBLISHED_DATA_URL, loadPublished } from "@/lib/data/load";
import { clampIndex, dayIndex, inches, ranking, summarize } from "@/lib/data/select";
import type { Dashboard as DashboardData } from "@/lib/data/types";
import { PRESETS } from "@/lib/ask/presets";
import { setParams, useSearch } from "@/lib/ui/url-state";
import { DateBar } from "./DateBar";
import { HowItWorks } from "./HowItWorks";
import { Intro } from "./Intro";
import { RankingCard } from "./RankingCard";
import { ResortDetail } from "./ResortDetail";
import { ResortMap } from "./ResortMap";
import { ScoreLegend } from "./ScoreBar";

/** The question the intro offers as the first thing to ask: plain, and a clear bar chart. */
const INTRO_PRESET = "season-totals";

function describeSource(data: DashboardData, published: boolean): string {
  const through = formatDate(data.asOf, "medium");
  return published
    ? `Data from the daily pipeline run, readings through ${through}.`
    : `Data from the snapshot bundled with this build, readings through ${through}.`;
}

/**
 * The page. It starts from the data bundled at build time, so there is something real
 * on screen immediately, then swaps in the published daily data if that is newer.
 * The selected date and resort are read from the URL.
 */
export function Dashboard({ initial }: { initial: DashboardData }) {
  const [published, setPublished] = useState<DashboardData | null>(null);
  const data = published ?? initial;

  useEffect(() => {
    const controller = new AbortController();
    void loadPublished(initial.generatedAt, controller.signal).then((fresh) => {
      if (fresh && !controller.signal.aborted) setPublished(fresh);
    });
    return () => controller.abort();
  }, [initial.generatedAt]);

  const search = useSearch();
  const { index, resortId } = useMemo(() => {
    const params = new URLSearchParams(search);
    const date = params.get("date");
    const found = date && isIsoDate(date) ? dayIndex(data, date) : -1;
    const wanted = params.get("resort");
    return {
      index: found >= 0 ? found : data.dates.length - 1,
      resortId: data.resorts.some((resort) => resort.id === wanted) ? wanted : null,
    };
  }, [search, data]);

  const days = useMemo(() => ranking(data, index), [data, index]);
  const summary = useMemo(() => summarize(days), [days]);
  const selected = days.find((day) => day.resort.id === resortId) ?? days[0];
  const isLatest = index === data.dates.length - 1;

  const setIndex = (next: number) => {
    const clamped = clampIndex(data, next);
    // The latest day is the default, so it keeps the URL clean.
    setParams({ date: clamped === data.dates.length - 1 ? null : data.dates[clamped] });
  };
  const setResort = (id: string) => setParams({ resort: id });
  const best = data.bestDays[0];
  const bestIndex = best ? dayIndex(data, best.date) : -1;
  const askRef = useRef<AskPanelHandle>(null);
  const introQuestion = PRESETS.find((preset) => preset.id === INTRO_PRESET)?.question ?? PRESETS[0].question;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 [&>*]:min-w-0">
      <Intro
        resortCount={data.resorts.length}
        best={best}
        onBestDay={index === bestIndex}
        isLatest={isLatest}
        onReplay={() => setIndex(bestIndex)}
        onLatest={() => setIndex(data.dates.length - 1)}
        askQuestion={introQuestion}
        onAsk={() => askRef.current?.askPreset(INTRO_PRESET)}
      />

      <div className="flex flex-col gap-4">
        <DateBar data={data} index={index} onChange={setIndex} />

        {summary.offSeason ? (
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">Off-season: an inch of snow or less at every resort,</span> so every
            score is near zero.{" "}
            {isLatest && summary.bestForecast
              ? `The only points today come from the forecast: up to ${inches(summary.bestForecast.inches)} inches at ${summary.bestForecast.resort} over the next 72 hours. `
              : ""}
            Pick a day above to replay last winter.
          </p>
        ) : (
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">
              {summary.withSnow} of {summary.total}
            </span>{" "}
            resorts have snow on the ground.
            {summary.bestNew24 && (
              <>
                {" "}
                Most new snow in 24 hours:{" "}
                <span className="font-medium text-fg">
                  {inches(summary.bestNew24.inches)}″ at {summary.bestNew24.resort}
                </span>
                .
              </>
            )}
          </p>
        )}

        <SafetyNotice className="text-xs leading-relaxed text-muted" />
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <section id="ranking" aria-labelledby="ranking-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2">
            <h2 id="ranking-heading" className="text-lg font-semibold tracking-tight">
              Resort ranking
            </h2>
            <p className="text-sm text-muted">
              Score out of 100: mostly new snow from the last 1 to 3 days, plus light, cold snow, base depth, and the
              forecast.{" "}
              <a href="#how" className="whitespace-nowrap font-medium text-accent underline-offset-2 hover:underline">
                How the score works
              </a>
            </p>
            <ScoreLegend lead="Points from:" labels={data.components.map(({ key, label }) => ({ key, label }))} />
          </div>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {days.map((day) => (
              <li key={day.resort.id} className="min-w-0">
                <RankingCard day={day} index={index} selected={day.resort.id === selected.resort.id} onSelect={setResort} />
              </li>
            ))}
          </ol>
        </section>

        <aside aria-labelledby="map-heading" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4">
          <h2 id="map-heading" className="text-lg font-semibold tracking-tight">
            Where the resorts are
          </h2>
          <ResortMap days={days} selectedId={selected.resort.id} onSelect={setResort} />
        </aside>
      </div>

      <ResortDetail data={data} day={selected} index={index} onDateChange={setIndex} onSelect={setResort} />

      <AskPanel ref={askRef} dataUrl={published ? PUBLISHED_DATA_URL : BUNDLED_DATA_URL} />

      <HowItWorks data={data} />

      <p className="text-xs text-muted">{describeSource(data, published !== null)}</p>
    </div>
  );
}

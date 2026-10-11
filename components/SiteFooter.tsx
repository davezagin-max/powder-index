export const AVALANCHE_CENTER_URL = "https://utahavalanchecenter.org";

/** The safety notice, used under the date bar and again in the footer. */
export function SafetyNotice({ className = "" }: { className?: string }) {
  return (
    <p className={className}>
      <strong className="font-semibold">Not avalanche or safety information.</strong> This is a ranking of ski
      conditions from weather stations. Before leaving a resort boundary, read the{" "}
      <a href={AVALANCHE_CENTER_URL} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
        Utah Avalanche Center forecast
      </a>
      .
    </p>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 text-sm">
        <SafetyNotice className="rounded-md border border-border bg-surface-2 px-4 py-3" />
        <div className="flex flex-col gap-1 text-xs leading-relaxed text-muted">
          <p>
            Snowpack data: USDA Natural Resources Conservation Service, SNOTEL network. Forecasts: National Weather
            Service. Both are public data; this site is not affiliated with either agency or with any resort. Station
            readings are proxies for resort conditions and can be wrong.
          </p>
          <p>Built with Claude Code and Claude Opus 5.5.</p>
        </div>
      </div>
    </footer>
  );
}

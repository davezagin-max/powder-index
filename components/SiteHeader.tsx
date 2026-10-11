import { ThemeToggle } from "@/components/kit/ThemeToggle";

const LINKS = [
  { href: "#ranking", label: "Ranking" },
  { href: "#resort", label: "History" },
  { href: "#ask", label: "Ask the data" },
  { href: "#how", label: "How it works" },
];

/** A peak drawn as three nested contour lines. */
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className="shrink-0 text-accent">
      <rect width="28" height="28" rx="6" fill="currentColor" />
      <path d="M4 21 11 9l4 6 2.5-3.5L24 21Z" fill="none" stroke="var(--accent-fg)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9.2 16.5 11 13.5l1.8 2.6" fill="none" stroke="var(--accent-fg)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <a href="#main" className="flex items-center gap-2.5">
          <Mark />
          <span>
            <span className="block text-base font-semibold leading-tight tracking-tight">Powder Index</span>
            <span className="block text-xs leading-tight text-muted">Utah snow, ranked every morning</span>
          </span>
        </a>
        <div className="flex items-center gap-1 sm:gap-2">
          <nav aria-label="Sections" className="hidden items-center gap-1 text-sm md:flex">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
                {link.label}
              </a>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

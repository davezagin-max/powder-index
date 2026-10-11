/**
 * Where the dashboard's data comes from.
 *
 * The page ships with a snapshot in `public/data/`, so it renders with no network at
 * all. After each daily pipeline run GitHub Actions publishes fresh files to GitHub
 * Pages; once the page is up it asks for that copy's small manifest and switches to
 * the published data only if it is newer and well-formed. If Pages is down, slow, or
 * serving something unexpected, nothing changes and nobody sees an error.
 */
import { DashboardSchema, ManifestSchema, type Dashboard } from "./types";

export const PUBLISHED_DATA_URL = (
  process.env.NEXT_PUBLIC_DATA_URL ?? "https://davezagin-max.github.io/powder-index/data"
).replace(/\/$/, "");
export const BUNDLED_DATA_URL = "/data";

const TIMEOUT_MS = 5000;

async function getJson(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Returns the published dashboard if it is newer than `bundledGeneratedAt`, else null.
 * Never throws: any failure means "keep what you have".
 */
export async function loadPublished(
  bundledGeneratedAt: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  baseUrl: string = PUBLISHED_DATA_URL,
): Promise<Dashboard | null> {
  if (!baseUrl || baseUrl === "off") return null;
  try {
    // Inside the try: a browser too old for AbortSignal.any must also mean "keep what you have".
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const manifest = ManifestSchema.safeParse(await getJson(`${baseUrl}/manifest.json`, fetcher, timeout));
    // ISO 8601 timestamps in UTC compare correctly as strings.
    if (!manifest.success || manifest.data.generatedAt <= bundledGeneratedAt) return null;
    const dashboard = DashboardSchema.safeParse(await getJson(`${baseUrl}/dashboard.json`, fetcher, timeout));
    if (!dashboard.success || dashboard.data.generatedAt <= bundledGeneratedAt) return null;
    return dashboard.data;
  } catch {
    return null;
  }
}

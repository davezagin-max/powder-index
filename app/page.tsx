import bundled from "@/public/data/dashboard.json";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { DemoBanner } from "@/components/kit/DemoBanner";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ASK_HAS_PLACEHOLDERS } from "@/lib/ask/presets";
import { DashboardSchema } from "@/lib/data/types";

// Validated once, at build time. A snapshot the page cannot read fails the build
// instead of shipping.
const initial = DashboardSchema.parse(bundled);

export default function Home() {
  return (
    <>
      <DemoBanner placeholder={ASK_HAS_PLACEHOLDERS} />
      <SiteHeader />
      <main id="main" className="flex-1">
        <Dashboard initial={initial} />
      </main>
      <SiteFooter />
    </>
  );
}

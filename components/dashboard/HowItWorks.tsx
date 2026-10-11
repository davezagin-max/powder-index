import lineage from "@/public/data/lineage.json";
import { edgePath, layoutLineage } from "@/lib/lineage";
import type { Dashboard } from "@/lib/data/types";
import { COMPONENT_COLOR, tierColor } from "@/lib/ui/colors";

const DOCS_URL = "https://davezagin-max.github.io/powder-index/docs/";
const REPO_URL = "https://github.com/davezagin-max/powder-index";

const NODE = { width: 144, height: 38, gapX: 32, gapY: 8 };
const LAYER_NAME: Record<string, string> = {
  source: "source",
  seed: "seed",
  staging: "staging",
  intermediate: "intermediate",
  marts: "mart",
};

// The layout depends only on the bundled lineage file, so it is worked out once.
const LAYOUT = layoutLineage(lineage.nodes, lineage.edges);

/** The dbt DAG, drawn from the manifest the pipeline exports. */
function Lineage() {
  const columns = LAYOUT.columns.length;
  const width = columns * NODE.width + (columns - 1) * NODE.gapX;
  const height = LAYOUT.rowCount * (NODE.height + NODE.gapY) - NODE.gapY;
  const tests = lineage.nodes.reduce((sum, node) => sum + node.tests, 0);
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="font-semibold">Lineage: from two public APIs to one score</figcaption>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface p-4" tabIndex={0} role="region" aria-label="dbt lineage diagram, scrollable">
        <svg width={width} height={height} role="img" aria-label={`dbt lineage: ${lineage.nodes.length} sources, seeds and models joined by ${lineage.edges.length} dependencies, from the raw sources on the left to the powder_score mart on the right.`} className="block">
          {LAYOUT.edges.map((edge) => (
            <path key={`${edge.from}>${edge.to}`} d={edgePath(edge, NODE)} fill="none" stroke="var(--axis)" strokeWidth={1.25} />
          ))}
          {lineage.nodes.map((node) => {
            const at = LAYOUT.position.get(node.id);
            if (!at) return null;
            const mart = node.layer === "marts";
            const raw = node.layer === "source" || node.layer === "seed";
            return (
              <g key={node.id} transform={`translate(${at.column * (NODE.width + NODE.gapX)},${at.row * (NODE.height + NODE.gapY)})`}>
                <title>{`${node.name} (${LAYER_NAME[node.layer] ?? node.layer}), ${node.tests} tests`}</title>
                <rect width={NODE.width} height={NODE.height} rx={5} fill={mart ? "var(--accent-soft)" : raw ? "var(--surface-2)" : "var(--surface)"} stroke={mart ? "var(--accent)" : "var(--border)"} />
                <text x={9} y={16} className="chart-text-strong" style={{ fontFamily: "var(--font-geist-mono), monospace", fontWeight: 500, fontSize: 10.5 }}>
                  {node.name.length > 20 ? `${node.name.slice(0, 19)}…` : node.name}
                </text>
                <text x={9} y={30} className="chart-text" style={{ fontSize: 10 }}>
                  {LAYER_NAME[node.layer] ?? node.layer}
                  {node.tests > 0 && ` · ${node.tests} ${node.tests === 1 ? "test" : "tests"}`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-muted">
        The dbt project as it was last built: {lineage.nodes.length} nodes and {tests} tests. Seeds sit beside the
        first model that reads them. Full documentation, with a description of every column, is{" "}
        <a href={DOCS_URL} className="underline underline-offset-2">
          published with each pipeline run
        </a>
        .
      </p>
    </figure>
  );
}

function anchor(value: number, unit: string): string {
  return unit === "in" ? `${value} in` : `${value}${unit}`;
}

/** The score formula, read from the same seed the pipeline computes it with. */
export function HowItWorks({ data }: { data: Dashboard }) {
  return (
    <section id="how" aria-labelledby="how-heading" className="flex flex-col gap-6">
      <div className="max-w-3xl">
        <h2 id="how-heading" className="text-xl font-semibold tracking-tight">
          How the score works
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Each morning a GitHub Actions job pulls daily SNOTEL readings from the NRCS and the 72-hour forecast from the
          National Weather Service, dbt turns them into three tables, and the result is published as Parquet and JSON.
          There is no server in the data path. The score is a weighted mean of six ramps:
        </p>
        <p className="mt-2 rounded-md bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed">
          score = 100 × Σ (weight × ramp) ÷ Σ (weights of the components known that day)
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Powder score components, weights, and scoring anchors</caption>
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Component
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Weight
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Scores 0 at
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Scores 1 at
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Why
              </th>
            </tr>
          </thead>
          <tbody>
            {data.components.map((component) => (
              <tr key={component.key} className="border-t border-border align-top">
                <th scope="row" className="whitespace-nowrap px-4 py-2.5 text-left font-medium">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: COMPONENT_COLOR[component.key] }} />
                    {component.label}
                  </span>
                </th>
                <td className="tabular px-4 py-2.5 text-right">{Math.round(component.weight * 100)}%</td>
                <td className="tabular whitespace-nowrap px-4 py-2.5">{anchor(component.zeroAt, component.unit)}</td>
                <td className="tabular whitespace-nowrap px-4 py-2.5">{anchor(component.fullAt, component.unit)}</td>
                <td className="px-4 py-2.5 text-muted">{component.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-x-10 gap-y-6 text-sm leading-relaxed lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">New snow, from two imperfect sensors</h3>
          <p className="text-muted">
            A depth sensor measures what a skier cares about but flickers by an inch and reads low while the pack
            settles under a storm. A snow pillow weighs the water steadily but cannot tell smoke from slush. So the
            depth gain is the estimate, and the water gain fences it in:
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted">
            <li>
              <span className="text-fg">A cap.</span> No more snow than the water gain allows at 4% density, so a
              depth spike with no water behind it never becomes a powder day.
            </li>
            <li>
              <span className="text-fg">A floor.</span> On a cold day, at least what the water gain implies at 20%
              density, which recovers snow that settling hid without assuming it was light.
            </li>
            <li>
              <span className="text-fg">A noise gate.</span> A one-inch rise only counts when the pillow moved too.
            </li>
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">What the numbers are, and are not</h3>
          <p className="text-muted">
            Every reading comes from a SNOTEL station near the resort, not from the resort. The result is settled
            snow at midnight, which is deliberately conservative and reads lower than a resort&apos;s own
            cleared-board total. A forecast is only known for the day the pipeline ran; a replayed day is scored on
            the other five components, rescaled.
          </p>
          <h3 className="mt-1 font-semibold">Tiers</h3>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-muted">
            {data.tiers.map((tier) => (
              <li key={tier.tier} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: tierColor(tier.tier) }} />
                <span className="text-fg">{tier.label}</span> {tier.minScore}+
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Weights, anchors, and tier thresholds are rows in two dbt seed files; the table above is read from the
            same data.{" "}
            <a href={REPO_URL} className="underline underline-offset-2">
              Source on GitHub
            </a>
            .
          </p>
        </div>
      </div>

      <Lineage />
    </section>
  );
}

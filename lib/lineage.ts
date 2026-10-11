/**
 * Layout for the dbt lineage diagram: a layered drawing of a DAG.
 *
 * Each node goes in the column one past its deepest parent (longest-path layering), so
 * every edge points left to right and none stays inside a column. Within a column,
 * nodes are ordered by the average row of their parents, the usual one-pass barycenter
 * heuristic for keeping edges from crossing.
 */
export interface LineageNode {
  id: string;
  name: string;
  layer: string;
  tests: number;
}

export interface LineageEdge {
  from: string;
  to: string;
}

/** Column index of every node: 0 for nodes with no parents. Throws on a cycle. */
export function nodeDepths(nodes: LineageNode[], edges: LineageEdge[]): Map<string, number> {
  const known = new Set(nodes.map((node) => node.id));
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
  }
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const done = depths.get(id);
    if (done !== undefined) return done;
    if (visiting.has(id)) throw new Error(`Lineage has a cycle through ${id}`);
    visiting.add(id);
    const depth = Math.max(-1, ...(parents.get(id) ?? []).map(depthOf)) + 1;
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };
  nodes.forEach((node) => depthOf(node.id));
  return depths;
}

/** Nodes grouped into columns by depth and ordered to keep edges short. */
export function layoutLineage(nodes: LineageNode[], edges: LineageEdge[]): LineageNode[][] {
  const depths = nodeDepths(nodes, edges);
  const columns: LineageNode[][] = [];
  for (const node of nodes) (columns[depths.get(node.id)!] ??= []).push(node);

  const row = new Map<string, number>();
  // Raw sources above seeds in the first column, each group alphabetical.
  columns[0]?.sort((a, b) => Number(a.layer !== "source") - Number(b.layer !== "source") || a.name.localeCompare(b.name));
  columns[0]?.forEach((node, index) => row.set(node.id, index));
  for (let c = 1; c < columns.length; c++) {
    const center = (node: LineageNode): number => {
      const rows = edges.filter((edge) => edge.to === node.id && row.has(edge.from)).map((edge) => row.get(edge.from)!);
      return rows.length ? rows.reduce((sum, r) => sum + r, 0) / rows.length : 0;
    };
    columns[c].sort((a, b) => center(a) - center(b) || a.name.localeCompare(b.name));
    columns[c].forEach((node, index) => row.set(node.id, index));
  }
  return columns;
}

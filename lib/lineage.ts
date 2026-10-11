/**
 * Layout for the dbt lineage diagram: a layered drawing of a DAG.
 *
 * 1. Columns. Each node goes one column past its deepest parent (longest-path
 *    layering), so every edge points left to right. Seeds have no parents and would all
 *    pile up in the first column, far from where they are used, so each one is pulled
 *    right to sit just before its first consumer.
 * 2. Long edges. An edge that skips a column gets a pass-through slot in every column
 *    it crosses. The slot takes up a row like a node does, so the edge has its own lane
 *    and is never drawn behind an unrelated box, where it would read as a dependency
 *    that does not exist.
 * 3. Rows. Columns are filled left to right, each ordered by the average row of what
 *    feeds it (the one-pass barycenter heuristic), which keeps crossings down.
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

export interface RoutedEdge extends LineageEdge {
  /** Column of the parent node. */
  column: number;
  /** The edge's row in each column from the parent's to the child's, inclusive. */
  rows: number[];
}

export interface LineageLayout {
  /** The nodes of each column, top to bottom. */
  columns: LineageNode[][];
  position: Map<string, { column: number; row: number }>;
  edges: RoutedEdge[];
  /** Height of the tallest column in rows, counting pass-through slots. */
  rowCount: number;
}

/** Longest-path depth of every node: 0 for nodes with no parents. Throws on a cycle. */
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

/**
 * The column of every node: its depth, except that a parentless node which is not a raw
 * source (a seed) moves right to the column just before its first consumer.
 */
export function nodeColumns(nodes: LineageNode[], edges: LineageEdge[]): Map<string, number> {
  const columns = nodeDepths(nodes, edges);
  const hasParent = new Set(edges.filter((edge) => columns.has(edge.from)).map((edge) => edge.to));
  for (const node of nodes) {
    if (node.layer === "source" || hasParent.has(node.id)) continue;
    // Only parentless nodes move, and a parentless node is nobody's child, so the
    // depths read here are never ones this loop has changed.
    const consumers = edges.filter((edge) => edge.from === node.id && columns.has(edge.to)).map((edge) => columns.get(edge.to)!);
    if (consumers.length) columns.set(node.id, Math.min(...consumers) - 1);
  }
  return columns;
}

type Slot = { node: LineageNode } | { pass: number };

export function layoutLineage(nodes: LineageNode[], allEdges: LineageEdge[]): LineageLayout {
  const column = nodeColumns(nodes, allEdges);
  const edges = allEdges.filter((edge) => column.has(edge.from) && column.has(edge.to));
  const name = new Map(nodes.map((node) => [node.id, node.name]));
  const count = nodes.length ? Math.max(...column.values()) + 1 : 0;

  const slots: Slot[][] = Array.from({ length: count }, () => []);
  for (const node of nodes) slots[column.get(node.id)!].push({ node });
  edges.forEach((edge, index) => {
    for (let c = column.get(edge.from)! + 1; c < column.get(edge.to)!; c++) slots[c].push({ pass: index });
  });

  const position = new Map<string, { column: number; row: number }>();
  // rows[i][k] is edge i's row in the k-th column counting from its parent's.
  const rows: number[][] = edges.map(() => []);
  const rowBefore = (edge: number, c: number): number => rows[edge][c - 1 - column.get(edges[edge].from)!];

  for (let c = 0; c < count; c++) {
    const center = (slot: Slot): number => {
      if ("pass" in slot) return rowBefore(slot.pass, c);
      const feeding = edges.flatMap((edge, index) => (edge.to === slot.node.id ? [rowBefore(index, c)] : []));
      // A seed has nothing feeding it. It sits below the flow it joins.
      return feeding.length ? feeding.reduce((sum, row) => sum + row, 0) / feeding.length : Infinity;
    };
    const label = (slot: Slot): string =>
      "pass" in slot ? `${name.get(edges[slot.pass].to)} ${name.get(edges[slot.pass].from)}` : slot.node.name;
    const rank = (slot: Slot): number => ("pass" in slot ? 2 : slot.node.layer === "source" ? 0 : 1);
    const centers = new Map(slots[c].map((slot) => [slot, center(slot)]));
    slots[c].sort((a, b) => {
      const ca = centers.get(a)!;
      const cb = centers.get(b)!;
      // Infinity - Infinity is NaN, so compare before subtracting.
      if (ca !== cb) return ca < cb ? -1 : 1;
      return rank(a) - rank(b) || label(a).localeCompare(label(b));
    });
    slots[c].forEach((slot, row) => {
      if ("pass" in slot) {
        rows[slot.pass][c - column.get(edges[slot.pass].from)!] = row;
        return;
      }
      position.set(slot.node.id, { column: c, row });
      edges.forEach((edge, index) => {
        if (edge.from === slot.node.id) rows[index][0] = row;
        if (edge.to === slot.node.id) rows[index][c - column.get(edge.from)!] = row;
      });
    });
  }

  return {
    columns: slots.map((column) => column.flatMap((slot) => ("node" in slot ? [slot.node] : []))),
    position,
    edges: edges.map((edge, index) => ({ ...edge, column: column.get(edge.from)!, rows: rows[index] })),
    rowCount: Math.max(0, ...slots.map((column) => column.length)),
  };
}

export interface LineageBox {
  width: number;
  height: number;
  gapX: number;
  gapY: number;
}

/**
 * SVG path for one edge: out of the parent's right side, straight across every
 * pass-through slot, into the child's left side, with an S-curve across each gap.
 */
export function edgePath(edge: RoutedEdge, box: LineageBox): string {
  const left = (column: number) => column * (box.width + box.gapX);
  const middle = (row: number) => row * (box.height + box.gapY) + box.height / 2;
  let path = "";
  edge.rows.forEach((row, i) => {
    const x = left(edge.column + i);
    const y = middle(row);
    if (i === 0) {
      path = `M${x + box.width},${y}`;
      return;
    }
    const fromX = left(edge.column + i - 1) + box.width;
    const fromY = middle(edge.rows[i - 1]);
    const bend = (fromX + x) / 2;
    path += `C${bend},${fromY} ${bend},${y} ${x},${y}`;
    if (i < edge.rows.length - 1) path += `H${x + box.width}`;
  });
  return path;
}

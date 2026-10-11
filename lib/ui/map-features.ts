/**
 * Orientation features for the resort map. Resort and station positions come from the
 * pipeline and are exact. Everything in this file is a hand-placed sketch: towns are at
 * their real coordinates, while lake outlines and roads are simplified to a few points,
 * enough to recognize the Wasatch Front at a glance. The map says so in its caption.
 */
import type { Bounds } from "@/lib/geo";

export type LatLon = [number, number];

export interface MapView {
  id: "north" | "central" | "south";
  title: string;
  bounds: Bounds;
  scaleKm: number;
}

export const VIEWS: MapView[] = [
  {
    id: "central",
    title: "Cottonwood canyons and Park City",
    bounds: { south: 40.548, north: 40.692, west: -111.735, east: -111.435 },
    scaleKm: 5,
  },
  {
    id: "north",
    title: "Northern Wasatch",
    bounds: { south: 40.17, north: 42.08, west: -112.3, east: -111.16 },
    scaleKm: 25,
  },
  {
    id: "south",
    title: "Southern Utah",
    bounds: { south: 37.52, north: 38.48, west: -113.2, east: -112.18 },
    scaleKm: 25,
  },
];

type LabelPlace = { dx: number; dy: number; anchor: "start" | "end" | "middle" };
const LEFT: LabelPlace = { dx: -7, dy: 4, anchor: "end" };

export const TOWNS: { name: string; at: LatLon; view: MapView["id"]; label: LabelPlace }[] = [
  { name: "Salt Lake City", at: [40.7608, -111.891], view: "north", label: { dx: 7, dy: 4, anchor: "start" } },
  { name: "Ogden", at: [41.223, -111.9738], view: "north", label: LEFT },
  { name: "Provo", at: [40.2338, -111.6585], view: "north", label: LEFT },
  { name: "Logan", at: [41.737, -111.8338], view: "north", label: LEFT },
  { name: "Cedar City", at: [37.6775, -113.0619], view: "south", label: { dx: -4, dy: 16, anchor: "start" } },
  { name: "Beaver", at: [38.2769, -112.6411], view: "south", label: LEFT },
];

export const LAKES: { name: string; outline: LatLon[] }[] = [
  {
    name: "Great Salt Lake",
    outline: [
      [41.7, -112.65], [41.62, -112.42], [41.45, -112.3], [41.38, -112.1], [41.2, -112.18],
      [41.08, -112.12], [40.98, -111.98], [40.85, -111.97], [40.76, -112.08], [40.73, -112.22],
      [40.7, -112.4], [40.9, -112.75], [41.2, -112.9], [41.5, -112.95],
    ],
  },
  {
    name: "Utah Lake",
    outline: [
      [40.36, -111.86], [40.33, -111.76], [40.27, -111.73], [40.18, -111.72], [40.1, -111.78],
      [40.04, -111.84], [40.06, -111.9], [40.16, -111.93], [40.28, -111.9],
    ],
  },
  {
    name: "Bear Lake",
    outline: [
      [42.1, -111.38], [42.1, -111.26], [41.92, -111.27], [41.85, -111.3], [41.84, -111.36], [41.93, -111.4],
    ],
  },
];

export const ROADS: LatLon[][] = [
  // I-15 along the Wasatch Front
  [
    [42.1, -112.2], [41.71, -112.17], [41.51, -112.02], [41.22, -111.98], [41.06, -111.97],
    [40.89, -111.89], [40.76, -111.9], [40.52, -111.89], [40.39, -111.85], [40.3, -111.72],
    [40.23, -111.67], [40.1, -111.65],
  ],
  // I-80 over Parleys Summit
  [[40.76, -111.9], [40.72, -111.8], [40.75, -111.72], [40.75, -111.62], [40.72, -111.54], [40.82, -111.4], [40.97, -111.43], [41.05, -111.16]],
  // I-84 through Weber Canyon
  [[41.14, -111.93], [41.15, -111.78], [41.04, -111.68], [41.02, -111.5], [40.97, -111.43]],
  // US-89/91 to Logan, then Logan Canyon
  [[41.51, -112.02], [41.6, -111.92], [41.74, -111.83], [41.84, -111.6], [41.93, -111.52], [41.95, -111.4]],
  // US-189 up Provo Canyon
  [[40.31, -111.66], [40.36, -111.57], [40.44, -111.48], [40.51, -111.41]],
  // Little Cottonwood Canyon road
  [[40.572, -111.78], [40.572, -111.7], [40.579, -111.66], [40.588, -111.638]],
  // Big Cottonwood Canyon road
  [[40.619, -111.79], [40.62, -111.7], [40.635, -111.65], [40.622, -111.6], [40.6, -111.584]],
  // SR-224 into Park City
  [[40.72, -111.54], [40.69, -111.54], [40.66, -111.51], [40.646, -111.498]],
  // I-15 in the south
  [[38.6, -112.6], [38.28, -112.64], [38.05, -112.7], [37.84, -112.83], [37.68, -113.06], [37.45, -113.25]],
  // SR-143 to Brian Head, SR-153 to Eagle Point
  [[37.84, -112.83], [37.76, -112.84], [37.7, -112.85]],
  [[38.28, -112.64], [38.3, -112.5], [38.32, -112.39]],
];

/** Where each resort's label sits relative to its marker, tuned so none collide. */
export const LABELS: Record<string, LabelPlace> = {
  alta: { dx: -2, dy: -15, anchor: "end" },
  snowbird: { dx: -12, dy: 4, anchor: "end" },
  brighton: { dx: 10, dy: 18, anchor: "start" },
  solitude: { dx: -12, dy: 4, anchor: "end" },
  "park-city": { dx: -12, dy: -8, anchor: "end" },
  "deer-valley": { dx: 0, dy: 28, anchor: "middle" },
  snowbasin: { dx: 13, dy: 4, anchor: "start" },
  "powder-mountain": { dx: 0, dy: -14, anchor: "middle" },
  sundance: { dx: -13, dy: 4, anchor: "end" },
  "beaver-mountain": { dx: -8, dy: 24, anchor: "middle" },
  "eagle-point": { dx: 6, dy: -13, anchor: "end" },
  "brian-head": { dx: 13, dy: 4, anchor: "start" },
};

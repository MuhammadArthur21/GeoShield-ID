import type { ProtectedDataset, ProtectedPoint, RawPoint, TransformConfig } from "../types";
import { project } from "./analysis";

function seedHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generalizeTime(value: string, unit: NonNullable<TransformConfig["timeGeneralization"]>): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const step = unit === "15m" ? 15 : unit === "30m" ? 30 : unit === "1h" ? 60 : 1440;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const roundedMinutes = Math.floor(minutes / step) * step;
  date.setUTCHours(Math.floor(roundedMinutes / 60), roundedMinutes % 60, 0, 0);
  return unit === "1d" ? date.toISOString().slice(0, 10) : date.toISOString();
}

export function protect(points: RawPoint[], transforms: TransformConfig): ProtectedDataset {
  const projection = project(points);
  const rng = mulberry32(seedHash(transforms.jitterSeed ?? "GeoShield-ID"));
  let protectedPoints: ProtectedPoint[] = points.map((point) => ({
    ...point,
    attrs: Object.fromEntries(Object.entries(point.attrs).filter(([key]) => !transforms.removedColumns?.includes(key))),
  }));
  if (transforms.roundingDecimals !== undefined) protectedPoints = protectedPoints.map((point) => ({ ...point, lon: Number(point.lon.toFixed(transforms.roundingDecimals)), lat: Number(point.lat.toFixed(transforms.roundingDecimals)) }));
  if (transforms.aggregateCellM) {
    const groups = new Map<string, ProtectedPoint[]>();
    const projectedPoints = protectedPoints.map((point) => projection.forward(point.lon, point.lat));
    const origin = projectedPoints.reduce((result, point) => ({ x: Math.min(result.x, point.x), y: Math.min(result.y, point.y) }), { x: Infinity, y: Infinity });
    protectedPoints.forEach((point) => {
      const { x, y } = projection.forward(point.lon, point.lat);
      const cellId = `${Math.floor((x - origin.x) / transforms.aggregateCellM!)}:${Math.floor((y - origin.y) / transforms.aggregateCellM!)}`;
      const group = groups.get(cellId);
      if (group) group.push(point);
      else groups.set(cellId, [point]);
    });
    protectedPoints = [...groups].flatMap(([cellId, group]) => {
      const average = group.reduce((sum, point) => { const projected = projection.forward(point.lon, point.lat); return { x: sum.x + projected.x / group.length, y: sum.y + projected.y / group.length }; }, { x: 0, y: 0 });
      const centroid = projection.inverse(average.x, average.y);
      return group.map((point) => ({ ...point, ...centroid, cellId }));
    });
  }
  if (transforms.jitterRadiusM) protectedPoints = protectedPoints.map((point) => {
    const angle = rng() * 2 * Math.PI;
    const radius = transforms.jitterRadiusM! * Math.sqrt(rng());
    const { x, y } = projection.forward(point.lon, point.lat);
    return { ...point, ...projection.inverse(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius) };
  });
  if (transforms.timeGeneralization) protectedPoints = protectedPoints.map((point) => point.time ? { ...point, time: generalizeTime(point.time, transforms.timeGeneralization!) } : point);
  const distances = points.map((point, index) => {
    const before = projection.forward(point.lon, point.lat);
    const after = projection.forward(protectedPoints[index]!.lon, protectedPoints[index]!.lat);
    return Math.hypot(before.x - after.x, before.y - after.y);
  }).sort((a, b) => a - b);
  const sum = distances.reduce((total, value) => total + value, 0);
  return {
    points: protectedPoints,
    transformsApplied: { ...transforms, removedColumns: transforms.removedColumns ?? [] },
    displacement: {
      meanM: distances.length ? sum / distances.length : 0,
      medianM: distances.length ? distances[Math.floor((distances.length - 1) * .5)]! : 0,
      maxM: distances.at(-1) ?? 0,
    },
  };
}

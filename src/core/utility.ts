import type { ProtectedPoint, RawPoint } from "../types";
import { project } from "./analysis";

export interface UtilityMetrics {
  recordRetention: number;
  extentShift: { dxM: number; dyM: number };
  centroidShiftM: number;
  attributePreservation: { column: string; retained: number }[];
  uniqueLocationsBefore: number;
  uniqueLocationsAfter: number;
  minGroupSizeAfter: number;
}

export function utilityMetrics(before: RawPoint[], after: ProtectedPoint[], gridSizeM = 250): UtilityMetrics {
  if (!before.length) return { recordRetention: 1, extentShift: { dxM: 0, dyM: 0 }, centroidShiftM: 0, attributePreservation: [], uniqueLocationsBefore: 0, uniqueLocationsAfter: 0, minGroupSizeAfter: 0 };
  const projection = project([...before, ...after]);
  const extent = (points: Array<Pick<RawPoint, "lon" | "lat">>) => points.reduce((result, point) => {
    const projected = projection.forward(point.lon, point.lat);
    return { minX: Math.min(result.minX, projected.x), maxX: Math.max(result.maxX, projected.x), minY: Math.min(result.minY, projected.y), maxY: Math.max(result.maxY, projected.y) };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const beforeExtent = extent(before), afterExtent = extent(after);
  const beforeCenter = before.reduce((sum, point) => { const p = projection.forward(point.lon, point.lat); return { x: sum.x + p.x / before.length, y: sum.y + p.y / before.length }; }, { x: 0, y: 0 });
  const afterCenter = after.reduce((sum, point) => { const p = projection.forward(point.lon, point.lat); return { x: sum.x + p.x / Math.max(after.length, 1), y: sum.y + p.y / Math.max(after.length, 1) }; }, { x: 0, y: 0 });
  const attributeNames = [...new Set(before.flatMap((point) => Object.keys(point.attrs)))];
  const attributePreservation = attributeNames.map((column) => {
    let same = 0, compared = 0;
    before.forEach((point, index) => {
      const output = after[index];
      if (!output || !(column in output.attrs)) return;
      compared += 1;
      if (point.attrs[column] === output.attrs[column]) same += 1;
    });
    return { column, retained: compared ? same / compared : 0 };
  });
  const gridStatistics = (points: Array<Pick<RawPoint, "lon" | "lat">>) => {
    if (!points.length) return { cells: 0, minimum: 0 };
    const projected = points.map((point) => projection.forward(point.lon, point.lat));
    const origin = projected.reduce((result, point) => ({ x: Math.min(result.x, point.x), y: Math.min(result.y, point.y) }), { x: Infinity, y: Infinity });
    const counts = new Map<string, number>();
    projected.forEach((point) => {
      const id = `${Math.floor((point.x - origin.x) / gridSizeM)}:${Math.floor((point.y - origin.y) / gridSizeM)}`;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });
    return { cells: counts.size, minimum: [...counts.values()].reduce((min, count) => Math.min(min, count), Infinity) };
  };
  const gridBefore = gridStatistics(before), gridAfter = gridStatistics(after);
  return {
    recordRetention: after.length / before.length,
    extentShift: { dxM: (afterExtent.maxX - afterExtent.minX) - (beforeExtent.maxX - beforeExtent.minX), dyM: (afterExtent.maxY - afterExtent.minY) - (beforeExtent.maxY - beforeExtent.minY) },
    centroidShiftM: Math.hypot(afterCenter.x - beforeCenter.x, afterCenter.y - beforeCenter.y),
    attributePreservation,
    uniqueLocationsBefore: gridBefore.cells,
    uniqueLocationsAfter: gridAfter.cells,
    minGroupSizeAfter: gridAfter.minimum,
  };
}

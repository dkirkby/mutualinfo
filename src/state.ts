import { defaultParameters, type DistributionId, type Parameters } from "./distributions";

export interface Point {
  x: number;
  y: number;
}

export interface ExplorerState {
  family: DistributionId;
  parameters: Record<DistributionId, Parameters>;
  selectedPoint: Point;
  informationWeighted: boolean;
}

export function createInitialState(): ExplorerState {
  return {
    family: "correlated-gaussian",
    parameters: defaultParameters(),
    selectedPoint: { x: 0, y: 0 },
    informationWeighted: true,
  };
}

export function clampPoint(point: Point, xDomain: [number, number], yDomain: [number, number]): Point {
  return {
    x: Math.max(xDomain[0], Math.min(xDomain[1], point.x)),
    y: Math.max(yDomain[0], Math.min(yDomain[1], point.y)),
  };
}

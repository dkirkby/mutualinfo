import { describe, expect, it } from "vitest";
import {
  covariance,
  computeGrid,
  conditionalXAtY,
  conditionalYAtX,
  integrate,
  weightedConditionalAverages,
} from "../src/numerics";
import { distributionById, type DistributionId, type Parameters } from "../src/distributions";
import {
  NHANES_COHORT_SIZE,
  NHANES_EXCLUDED_KNOWN_PREGNANCIES,
  NHANES_HEIGHT_P005_CM,
  NHANES_HEIGHT_P995_CM,
  NHANES_WEIGHT_P005_KG,
  NHANES_WEIGHT_P995_KG,
} from "../src/data/nhanesHeightWeight";
import {
  NOAA_ENSO_END,
  NOAA_ENSO_MONTH_COUNT,
  NOAA_ENSO_START,
  NOAA_NINO34_SOI_CORRELATION,
} from "../src/data/noaaEnso";
import { climateCorrelation, climatePairCount } from "../src/climate";

function model(id: DistributionId, parameters: Parameters, resolution = 256) {
  const definition = distributionById.get(id);
  if (!definition) throw new Error(`Unknown distribution: ${id}`);
  return computeGrid(definition, parameters, resolution);
}

describe("grid normalization", () => {
  const cases: [DistributionId, Parameters][] = [
    ["independent-gaussian", { sigmaX: 0.5, sigmaY: 1.5 }],
    ["correlated-gaussian", { rho: -0.9 }],
    ["noisy-parabola", { a: 1.4, sigma: 0.12 }],
    ["gaussian-mixture", { d: 1.2, s: 0.35 }],
    ["noisy-ring", { R: 1.4, s: 0.15 }],
    ["nhanes-adults", { smoothing: 1 }],
    ["enso-lag", { lag: 0 }],
  ];

  it.each(cases)("normalizes %s and its marginals", (id, parameters) => {
    const grid = model(id, parameters);
    expect(integrate(grid.marginalX, grid.dx)).toBeCloseTo(1, 11);
    expect(integrate(grid.marginalY, grid.dy)).toBeCloseTo(1, 11);
  });

  it.each(cases)("normalizes interpolated conditionals for %s", (id, parameters) => {
    const grid = model(id, parameters);
    const selectedX = grid.domain.x[0] * 0.35 + grid.domain.x[1] * 0.65;
    const selectedY = grid.domain.y[0] * 0.6 + grid.domain.y[1] * 0.4;
    const xSlice = conditionalXAtY(grid, selectedY);
    const ySlice = conditionalYAtX(grid, selectedX);
    expect(xSlice.conditional).not.toBeNull();
    expect(ySlice.conditional).not.toBeNull();
    expect(integrate(xSlice.conditional ?? new Float64Array(), grid.dx)).toBeCloseTo(1, 11);
    expect(integrate(ySlice.conditional ?? new Float64Array(), grid.dy)).toBeCloseTo(1, 11);
  });
});

describe("independence limits", () => {
  const cases: [DistributionId, Parameters][] = [
    ["independent-gaussian", { sigmaX: 0.65, sigmaY: 1.3 }],
    ["gaussian-mixture", { d: 0, s: 0.4 }],
    ["noisy-parabola", { a: 0, sigma: 0.2 }],
    ["noisy-ring", { R: 0, s: 0.2 }],
  ];

  it.each(cases)("gives nearly zero information for %s", (id, parameters) => {
    const grid = model(id, parameters);
    expect(Math.abs(grid.mutualInformation)).toBeLessThan(1e-10);
    const xSlice = conditionalXAtY(grid, 0);
    const ySlice = conditionalYAtX(grid, 0);
    expect(xSlice.klDivergence).not.toBeNull();
    expect(ySlice.klDivergence).not.toBeNull();
    expect(Math.abs(xSlice.klDivergence ?? 1)).toBeLessThan(1e-10);
    expect(Math.abs(ySlice.klDivergence ?? 1)).toBeLessThan(1e-10);
  });
});

describe("correlated Gaussian", () => {
  it.each([-0.9, -0.5, 0, 0.5, 0.9])("matches analytic MI at rho=%s", (rho) => {
    const grid = model("correlated-gaussian", { rho }, 384);
    const analytic = -0.5 * Math.log2(1 - rho * rho);
    expect(grid.mutualInformation).toBeCloseTo(analytic, 5);
  });

  it("is symmetric in the sign of rho", () => {
    const positive = model("correlated-gaussian", { rho: 0.73 });
    const negative = model("correlated-gaussian", { rho: -0.73 });
    expect(positive.mutualInformation).toBeCloseTo(negative.mutualInformation, 11);
  });

  it("has the analytic conditional mean and variance", () => {
    const rho = 0.65;
    const selectedX = 0.8;
    const grid = model("correlated-gaussian", { rho }, 384);
    const slice = conditionalYAtX(grid, selectedX);
    expect(slice.conditional).not.toBeNull();
    let mean = 0;
    for (let i = 0; i < slice.coordinate.length; i += 1) {
      mean += slice.coordinate[i] * (slice.conditional?.[i] ?? 0) * grid.dy;
    }
    let variance = 0;
    for (let i = 0; i < slice.coordinate.length; i += 1) {
      variance += (slice.coordinate[i] - mean) ** 2 * (slice.conditional?.[i] ?? 0) * grid.dy;
    }
    expect(mean).toBeCloseTo(rho * selectedX, 3);
    expect(variance).toBeCloseTo(1 - rho * rho, 3);
  });
});

describe("information identities and geometry", () => {
  it("integrates the joint-density-weighted pointwise field to mutual information", () => {
    const grid = model("correlated-gaussian", { rho: 0.7 }, 384);
    let integral = 0;
    let maximum = 0;
    for (const contribution of grid.informationContribution) {
      integral += contribution * grid.dx * grid.dy;
      maximum = Math.max(maximum, Math.abs(contribution));
    }
    expect(integral).toBeCloseTo(grid.mutualInformation, 12);
    expect(maximum).toBeCloseTo(grid.informationContributionMax, 12);
    expect(grid.informationContribution.some((value) => value < 0)).toBe(true);
    expect(grid.informationContribution.some((value) => value > 0)).toBe(true);
  });

  it("matches both marginal averages of conditional KL", () => {
    const grid = model("gaussian-mixture", { d: 1.1, s: 0.45 }, 192);
    const averages = weightedConditionalAverages(grid);
    expect(averages.overX).toBeCloseTo(grid.mutualInformation, 10);
    expect(averages.overY).toBeCloseTo(grid.mutualInformation, 10);
  });

  it("finds zero covariance but positive MI for nonlinear families", () => {
    const parabola = model("noisy-parabola", { a: 1, sigma: 0.2 });
    const ring = model("noisy-ring", { R: 1, s: 0.2 });
    expect(Math.abs(covariance(parabola))).toBeLessThan(1e-12);
    expect(Math.abs(covariance(ring))).toBeLessThan(1e-12);
    expect(parabola.mutualInformation).toBeGreaterThan(0.25);
    expect(ring.mutualInformation).toBeGreaterThan(0.25);
  });
});

describe("NHANES adult height and weight", () => {
  it("records the documented derived cohort", () => {
    expect(NHANES_COHORT_SIZE).toBe(5120);
    expect(NHANES_EXCLUDED_KNOWN_PREGNANCIES).toBe(55);
  });

  it("uses the weighted marginal percentile window and remains dependent", () => {
    const grid = model("nhanes-adults", { smoothing: 1 }, 384);
    expect(grid.domain.x[0]).toBeCloseTo(NHANES_HEIGHT_P005_CM / 2.54, 10);
    expect(grid.domain.x[1]).toBeCloseTo(NHANES_HEIGHT_P995_CM / 2.54, 10);
    expect(grid.domain.y[0]).toBeCloseTo(NHANES_WEIGHT_P005_KG * 2.2046226218, 10);
    expect(grid.domain.y[1]).toBeCloseTo(NHANES_WEIGHT_P995_KG * 2.2046226218, 10);
    expect(grid.mutualInformation).toBeGreaterThan(0.1);
  });

  it("loses information as smoothing adds measurement noise", () => {
    const narrow = model("nhanes-adults", { smoothing: 0.25 }, 256);
    const wide = model("nhanes-adults", { smoothing: 1.6 }, 256);
    expect(narrow.mutualInformation).toBeGreaterThan(wide.mutualInformation);
  });
});

describe("NOAA Niño 3.4 and SOI", () => {
  it("records a contiguous common monthly span and expected negative same-month association", () => {
    expect(NOAA_ENSO_START).toBe("1870-01");
    expect(NOAA_ENSO_END).toBe("2025-07");
    expect(NOAA_ENSO_MONTH_COUNT).toBe(1867);
    expect(climatePairCount(0)).toBe(1867);
    expect(climatePairCount(12)).toBe(1855);
    expect(climatePairCount(-12)).toBe(1855);
    expect(climateCorrelation(0)).toBeCloseTo(NOAA_NINO34_SOI_CORRELATION, 7);
    expect(climateCorrelation(0)).toBeLessThan(-0.5);
  });

  it("produces a dependent, negatively sloped zero-lag density", () => {
    const grid = model("enso-lag", { lag: 0 }, 384);
    expect(grid.mutualInformation).toBeGreaterThan(0.2);
    expect(covariance(grid)).toBeLessThan(-0.2);
  });

  it("changes the paired density when the lag changes", () => {
    const sameMonth = model("enso-lag", { lag: 0 }, 256);
    const oneYearLater = model("enso-lag", { lag: 12 }, 256);
    expect(Math.abs(sameMonth.mutualInformation - oneYearLater.mutualInformation)).toBeGreaterThan(0.01);
  });
});

describe("resolution convergence", () => {
  const cases: [DistributionId, Parameters][] = [
    ["correlated-gaussian", { rho: 0.7 }],
    ["noisy-parabola", { a: 1, sigma: 0.2 }],
    ["gaussian-mixture", { d: 1, s: 0.4 }],
    ["noisy-ring", { R: 1, s: 0.2 }],
    ["nhanes-adults", { smoothing: 1 }],
    ["enso-lag", { lag: 0 }],
  ];

  it.each(cases)("converges for ordinary %s settings", (id, parameters) => {
    const coarse = model(id, parameters, 384);
    const fine = model(id, parameters, 768);
    expect(Math.abs(coarse.mutualInformation - fine.mutualInformation)).toBeLessThan(0.002);
  });

  const extremeCases: [DistributionId, Parameters][] = [
    ["correlated-gaussian", { rho: 0.95 }],
    ["noisy-parabola", { a: 2, sigma: 0.08 }],
    ["gaussian-mixture", { d: 2, s: 0.2 }],
    ["noisy-ring", { R: 2, s: 0.1 }],
    ["nhanes-adults", { smoothing: 0.25 }],
    ["nhanes-adults", { smoothing: 1.6 }],
  ];

  it.each(extremeCases)("resolves extreme %s settings", (id, parameters) => {
    const coarse = model(id, parameters, 384);
    const fine = model(id, parameters, 768);
    expect(Math.abs(coarse.mutualInformation - fine.mutualInformation)).toBeLessThan(0.002);
  });
});

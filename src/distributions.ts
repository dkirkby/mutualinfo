import {
  NHANES_HEIGHT_DOMAIN,
  NHANES_WEIGHT_DOMAIN,
  NHANES_WEIGHTED_MEAN_HEIGHT_CM,
  NHANES_WEIGHTED_MEAN_WEIGHT_KG,
} from "./data/nhanesHeightWeight";
import {
  NOAA_NINO34_HISTOGRAM_DOMAIN,
  NOAA_NINO34_MEAN_C,
  NOAA_SOI_HISTOGRAM_DOMAIN,
  NOAA_SOI_MEAN,
} from "./data/noaaEnso";
import { climateLogDensity } from "./climate";
import { nhanesLogDensity } from "./nhanes";

export type DistributionId =
  | "independent-gaussian"
  | "correlated-gaussian"
  | "noisy-parabola"
  | "gaussian-mixture"
  | "noisy-ring"
  | "nhanes-adults"
  | "enso-lag";

export type Parameters = Record<string, number>;

export interface Domain2D {
  x: [number, number];
  y: [number, number];
}

export interface ParameterDefinition {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format?: (value: number) => string;
}

export interface DistributionDefinition {
  id: DistributionId;
  name: string;
  description: string;
  lesson: string;
  parameters: ParameterDefinition[];
  xLabel?: string;
  yLabel?: string;
  xName?: string;
  yName?: string;
  xUnit?: string;
  yUnit?: string;
  xTickFormat?: (value: number) => string;
  yTickFormat?: (value: number) => string;
  xValueFormat?: (value: number) => string;
  yValueFormat?: (value: number) => string;
  source?: { label: string; url: string };
  initialPoint?: { x: number; y: number };
  domain: (parameters: Parameters) => Domain2D;
  logDensity: (x: number, y: number, parameters: Parameters) => number;
}

const LOG_TWO_PI = Math.log(2 * Math.PI);
const CM_PER_INCH = 2.54;
const POUNDS_PER_KG = 2.2046226218;

function formatFeetInches(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const feet = Math.floor(rounded / 12);
  const inches = rounded - feet * 12;
  return `${feet}′${inches.toFixed(decimals)}″`;
}

function logNormal(value: number, mean: number, sigma: number): number {
  const z = (value - mean) / sigma;
  return -0.5 * (LOG_TWO_PI + 2 * Math.log(sigma) + z * z);
}

function symmetricDomain(radius: number): [number, number] {
  return [-radius, radius];
}

export const distributions: DistributionDefinition[] = [
  {
    id: "independent-gaussian",
    name: "Independent Gaussian",
    description: "Two centered normal variables whose widths can change independently.",
    lesson: "Changing marginal widths reshapes the density without creating dependence.",
    parameters: [
      { key: "sigmaX", label: "σx", min: 0.5, max: 1.5, step: 0.01, defaultValue: 1 },
      { key: "sigmaY", label: "σy", min: 0.5, max: 1.5, step: 0.01, defaultValue: 1 },
    ],
    domain: ({ sigmaX, sigmaY }) => ({
      x: symmetricDomain(6 * sigmaX),
      y: symmetricDomain(6 * sigmaY),
    }),
    logDensity: (x, y, { sigmaX, sigmaY }) =>
      logNormal(x, 0, sigmaX) + logNormal(y, 0, sigmaY),
  },
  {
    id: "correlated-gaussian",
    name: "Correlated Gaussian",
    description: "A centered bivariate normal with unit marginal variances.",
    lesson: "Dependence can have either sign; conditioning shifts and narrows the distribution.",
    parameters: [
      {
        key: "rho",
        label: "ρ",
        min: -0.95,
        max: 0.95,
        step: 0.01,
        defaultValue: 0.7,
      },
    ],
    domain: () => ({ x: [-6, 6], y: [-6, 6] }),
    logDensity: (x, y, { rho }) => {
      const oneMinusRhoSquared = 1 - rho * rho;
      return (
        -LOG_TWO_PI -
        0.5 * Math.log(oneMinusRhoSquared) -
        (x * x - 2 * rho * x * y + y * y) / (2 * oneMinusRhoSquared)
      );
    },
  },
  {
    id: "noisy-parabola",
    name: "Noisy parabola",
    description: "X is uniform; Y follows aX² with additive Gaussian noise.",
    lesson: "Strong nonlinear dependence can coexist with zero covariance.",
    parameters: [
      { key: "a", label: "a", min: 0, max: 2, step: 0.02, defaultValue: 1 },
      { key: "sigma", label: "σ", min: 0.08, max: 0.6, step: 0.01, defaultValue: 0.2 },
    ],
    domain: ({ a, sigma }) => ({
      x: [-1, 1],
      y: [-6 * sigma, a + 6 * sigma],
    }),
    logDensity: (x, y, { a, sigma }) => {
      if (x < -1 || x > 1) return Number.NEGATIVE_INFINITY;
      return -Math.log(2) + logNormal(y, a * x * x, sigma);
    },
  },
  {
    id: "gaussian-mixture",
    name: "Gaussian mixture",
    description: "Two equally weighted circular Gaussian clusters on the diagonal.",
    lesson: "An observation updates the likely cluster; merging the centers restores independence.",
    parameters: [
      { key: "d", label: "d", min: 0, max: 2, step: 0.02, defaultValue: 1 },
      { key: "s", label: "s", min: 0.2, max: 1, step: 0.01, defaultValue: 0.4 },
    ],
    domain: ({ d, s }) => {
      const radius = d + 6 * s;
      return { x: symmetricDomain(radius), y: symmetricDomain(radius) };
    },
    logDensity: (x, y, { d, s }) => {
      const first = logNormal(x, -d, s) + logNormal(y, -d, s);
      const second = logNormal(x, d, s) + logNormal(y, d, s);
      const maximum = Math.max(first, second);
      return maximum + Math.log(Math.exp(first - maximum) + Math.exp(second - maximum)) - Math.log(2);
    },
  },
  {
    id: "noisy-ring",
    name: "Noisy ring",
    description: "A Cartesian density concentrated around a circle of radius R.",
    lesson: "Rotational symmetry gives zero covariance while slices reveal geometric dependence.",
    parameters: [
      { key: "R", label: "R", min: 0, max: 2, step: 0.02, defaultValue: 1 },
      { key: "s", label: "s", min: 0.1, max: 0.6, step: 0.01, defaultValue: 0.2 },
    ],
    domain: ({ R, s }) => {
      const radius = R + 6 * s;
      return { x: symmetricDomain(radius), y: symmetricDomain(radius) };
    },
    logDensity: (x, y, { R, s }) => {
      const radialOffset = (Math.hypot(x, y) - R) / s;
      return -0.5 * radialOffset * radialOffset;
    },
  },
  {
    id: "nhanes-adults",
    name: "Height vs Weight",
    description: "Survey-weighted measured height and weight for U.S. adults in NHANES 2017–2018.",
    lesson: "A real population is heterogeneous: height informs weight, but the update remains broad and asymmetric.",
    parameters: [
      {
        key: "smoothing",
        label: "KDE smoothing",
        min: 0.25,
        max: 1.6,
        step: 0.05,
        defaultValue: 1,
      },
    ],
    xLabel: "height (ft–in)",
    yLabel: "weight (lbs)",
    xName: "height",
    yName: "weight",
    xUnit: "ft–in",
    yUnit: "lbs",
    xTickFormat: (value) => formatFeetInches(value, 0),
    xValueFormat: (value) => formatFeetInches(value, 1),
    yValueFormat: (value) => `${value.toFixed(1)} lbs`,
    source: {
      label: "CDC/NCHS NHANES 2017–2018",
      url: "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/BMX_J.htm",
    },
    initialPoint: {
      x: NHANES_WEIGHTED_MEAN_HEIGHT_CM / CM_PER_INCH,
      y: NHANES_WEIGHTED_MEAN_WEIGHT_KG * POUNDS_PER_KG,
    },
    domain: () => ({
      x: [NHANES_HEIGHT_DOMAIN[0] / CM_PER_INCH, NHANES_HEIGHT_DOMAIN[1] / CM_PER_INCH],
      y: [NHANES_WEIGHT_DOMAIN[0] * POUNDS_PER_KG, NHANES_WEIGHT_DOMAIN[1] * POUNDS_PER_KG],
    }),
    logDensity: (heightInches, weightPounds, { smoothing }) =>
      nhanesLogDensity(heightInches * CM_PER_INCH, weightPounds / POUNDS_PER_KG, smoothing),
  },
  {
    id: "enso-lag",
    name: "Niño 3.4 vs SOI",
    description:
      "Monthly Niño 3.4 sea-surface-temperature anomalies paired with the Southern Oscillation Index at an adjustable lag.",
    lesson:
      "Ocean and atmosphere are strongly linked but not interchangeable; lagged dependence is predictive association, not proof of causal direction.",
    parameters: [
      {
        key: "lag",
        label: "SOI lag τ",
        min: -12,
        max: 12,
        step: 1,
        defaultValue: 0,
        format: (value) => {
          const lag = Math.round(value);
          if (lag === 0) return "0 months";
          return `${lag > 0 ? "+" : "−"}${Math.abs(lag)} ${Math.abs(lag) === 1 ? "month" : "months"}`;
        },
      },
    ],
    xLabel: "Niño 3.4 anomaly (°C)",
    yLabel: "SOI (standardized)",
    xName: "Niño 3.4",
    yName: "SOI",
    xUnit: "°C",
    yUnit: "standardized",
    xValueFormat: (value) => `${value.toFixed(2)} °C`,
    yValueFormat: (value) => value.toFixed(2),
    source: {
      label: "NOAA PSL monthly climate indices",
      url: "https://psl.noaa.gov/data/timeseries/month/",
    },
    initialPoint: { x: NOAA_NINO34_MEAN_C, y: NOAA_SOI_MEAN },
    domain: () => ({
      x: NOAA_NINO34_HISTOGRAM_DOMAIN,
      y: NOAA_SOI_HISTOGRAM_DOMAIN,
    }),
    logDensity: (ninoAnomaly, soiValue, { lag }) =>
      climateLogDensity(ninoAnomaly, soiValue, lag),
  },
];

export const distributionById = new Map(distributions.map((definition) => [definition.id, definition]));

export function defaultParameters(): Record<DistributionId, Parameters> {
  return Object.fromEntries(
    distributions.map((definition) => [
      definition.id,
      Object.fromEntries(definition.parameters.map((parameter) => [parameter.key, parameter.defaultValue])),
    ]),
  ) as Record<DistributionId, Parameters>;
}

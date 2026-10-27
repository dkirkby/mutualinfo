import type { DistributionDefinition, Domain2D, Parameters } from "./distributions";

const LOG_2 = Math.log(2);
export const MAX_CONDITIONAL_TO_MARGINAL_PROFILE_RATIO = 3;

export interface GridModel {
  domain: Domain2D;
  displayDomain: Domain2D;
  nx: number;
  ny: number;
  dx: number;
  dy: number;
  x: Float64Array;
  y: Float64Array;
  joint: Float64Array;
  marginalX: Float64Array;
  marginalY: Float64Array;
  product: Float64Array;
  information: Float64Array;
  informationContribution: Float64Array;
  informationContributionMax: number;
  klXGivenY: Float64Array;
  klYGivenX: Float64Array;
  profileMaxX: number;
  profileMaxY: number;
  densityMax: number;
  jointMax: number;
  entropyX: number;
  entropyY: number;
  mutualInformation: number;
  massBeforeNormalization: number;
}

export interface ConditionalSlice {
  coordinate: Float64Array;
  marginal: Float64Array;
  conditional: Float64Array | null;
  conditioningDensity: number;
  klDivergence: number | null;
}

export interface SelectedPointMetrics {
  x: number;
  y: number;
  joint: number;
  product: number;
  marginalX: number;
  marginalY: number;
  information: number;
}

function centeredCoordinates([minimum, maximum]: [number, number], count: number): Float64Array {
  const step = (maximum - minimum) / count;
  return Float64Array.from({ length: count }, (_, index) => minimum + (index + 0.5) * step);
}

function marginalQuantile(
  marginal: Float64Array,
  domain: [number, number],
  spacing: number,
  quantile: number,
): number {
  let cumulative = 0;
  for (let index = 0; index < marginal.length; index += 1) {
    const mass = marginal[index] * spacing;
    if (cumulative + mass >= quantile && mass > 0) {
      const fraction = (quantile - cumulative) / mass;
      return domain[0] + (index + fraction) * spacing;
    }
    cumulative += mass;
  }
  return domain[1];
}

function productInformation(joint: number, product: number): number {
  if (joint > 0 && product > 0) return Math.log(joint / product) / LOG_2;
  if (joint === 0 && product > 0) return Number.NEGATIVE_INFINITY;
  if (joint > 0 && product === 0) return Number.POSITIVE_INFINITY;
  return Number.NaN;
}

function gridEntropy(marginal: Float64Array, spacing: number): number {
  let entropy = 0;
  for (const density of marginal) {
    const probability = density * spacing;
    if (probability > 0) entropy -= probability * (Math.log(probability) / LOG_2);
  }
  return entropy;
}

export function computeGrid(
  definition: DistributionDefinition,
  parameters: Parameters,
  resolution = 384,
): GridModel {
  const domain = definition.domain(parameters);
  const nx = resolution;
  const ny = resolution;
  const dx = (domain.x[1] - domain.x[0]) / nx;
  const dy = (domain.y[1] - domain.y[0]) / ny;
  const x = centeredCoordinates(domain.x, nx);
  const y = centeredCoordinates(domain.y, ny);
  const cellCount = nx * ny;
  const logValues = new Float64Array(cellCount);
  let maximumLogDensity = Number.NEGATIVE_INFINITY;

  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const index = iy * nx + ix;
      const value = definition.logDensity(x[ix], y[iy], parameters);
      logValues[index] = value;
      if (Number.isFinite(value) && value > maximumLogDensity) maximumLogDensity = value;
    }
  }

  if (!Number.isFinite(maximumLogDensity)) {
    throw new Error(`Distribution ${definition.name} has no finite density in its computation domain.`);
  }

  const joint = new Float64Array(cellCount);
  let scaledSum = 0;
  for (let index = 0; index < cellCount; index += 1) {
    const scaledDensity = Math.exp(logValues[index] - maximumLogDensity);
    joint[index] = scaledDensity;
    scaledSum += scaledDensity;
  }

  const scaledIntegral = scaledSum * dx * dy;
  const normalizer = 1 / scaledIntegral;
  const massBeforeNormalization = Math.exp(maximumLogDensity) * scaledIntegral;
  let jointMax = 0;
  for (let index = 0; index < cellCount; index += 1) {
    joint[index] *= normalizer;
    if (joint[index] > jointMax) jointMax = joint[index];
  }

  const marginalX = new Float64Array(nx);
  const marginalY = new Float64Array(ny);
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const density = joint[iy * nx + ix];
      marginalX[ix] += density * dy;
      marginalY[iy] += density * dx;
    }
  }

  const displayDomain: Domain2D = {
    x: [
      marginalQuantile(marginalX, domain.x, dx, 0.005),
      marginalQuantile(marginalX, domain.x, dx, 0.995),
    ],
    y: [
      marginalQuantile(marginalY, domain.y, dy, 0.005),
      marginalQuantile(marginalY, domain.y, dy, 0.995),
    ],
  };
  const entropyX = gridEntropy(marginalX, dx);
  const entropyY = gridEntropy(marginalY, dy);

  const product = new Float64Array(cellCount);
  const information = new Float64Array(cellCount);
  const informationContribution = new Float64Array(cellCount);
  const klXGivenY = new Float64Array(ny);
  const klYGivenX = new Float64Array(nx);
  let informationContributionMax = 0;
  let profileMaxX = 0;
  let profileMaxY = 0;
  let marginalProfileMaxX = 0;
  let marginalProfileMaxY = 0;
  let densityMax = jointMax;
  let mutualInformation = 0;
  const cellArea = dx * dy;
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const index = iy * nx + ix;
      const independentDensity = marginalX[ix] * marginalY[iy];
      product[index] = independentDensity;
      if (independentDensity > densityMax) densityMax = independentDensity;
      const value = productInformation(joint[index], independentDensity);
      information[index] = value;
      if (joint[index] > 0 && Number.isFinite(value)) {
        const contribution = joint[index] * value;
        informationContribution[index] = contribution;
        informationContributionMax = Math.max(informationContributionMax, Math.abs(contribution));
        mutualInformation += contribution * cellArea;
        if (marginalY[iy] > 0) klXGivenY[iy] += (contribution / marginalY[iy]) * dx;
        if (marginalX[ix] > 0) klYGivenX[ix] += (contribution / marginalX[ix]) * dy;
      }
      // Include the cells bracketing the visible bounds so clipped SVG line
      // segments and interpolated selections cannot exceed the fixed scale.
      const xVisible = x[ix] >= displayDomain.x[0] - dx && x[ix] <= displayDomain.x[1] + dx;
      const yVisible = y[iy] >= displayDomain.y[0] - dy && y[iy] <= displayDomain.y[1] + dy;
      if (xVisible && yVisible) {
        if (marginalY[iy] > 0) profileMaxX = Math.max(profileMaxX, joint[index] / marginalY[iy]);
        if (marginalX[ix] > 0) profileMaxY = Math.max(profileMaxY, joint[index] / marginalX[ix]);
      }
    }
  }

  for (let ix = 0; ix < nx; ix += 1) {
    if (x[ix] >= displayDomain.x[0] && x[ix] <= displayDomain.x[1]) {
      marginalProfileMaxX = Math.max(marginalProfileMaxX, marginalX[ix]);
    }
  }
  for (let iy = 0; iy < ny; iy += 1) {
    if (y[iy] >= displayDomain.y[0] && y[iy] <= displayDomain.y[1]) {
      marginalProfileMaxY = Math.max(marginalProfileMaxY, marginalY[iy]);
    }
  }
  profileMaxX = Math.max(
    marginalProfileMaxX,
    Math.min(profileMaxX, marginalProfileMaxX * MAX_CONDITIONAL_TO_MARGINAL_PROFILE_RATIO),
  );
  profileMaxY = Math.max(
    marginalProfileMaxY,
    Math.min(profileMaxY, marginalProfileMaxY * MAX_CONDITIONAL_TO_MARGINAL_PROFILE_RATIO),
  );

  if (mutualInformation < 0 && mutualInformation > -1e-12) mutualInformation = 0;
  for (let iy = 0; iy < ny; iy += 1) {
    if (klXGivenY[iy] < 0 && klXGivenY[iy] > -1e-12) klXGivenY[iy] = 0;
  }
  for (let ix = 0; ix < nx; ix += 1) {
    if (klYGivenX[ix] < 0 && klYGivenX[ix] > -1e-12) klYGivenX[ix] = 0;
  }

  return {
    domain,
    displayDomain,
    nx,
    ny,
    dx,
    dy,
    x,
    y,
    joint,
    marginalX,
    marginalY,
    product,
    information,
    informationContribution,
    informationContributionMax,
    klXGivenY,
    klYGivenX,
    profileMaxX,
    profileMaxY,
    densityMax,
    jointMax,
    entropyX,
    entropyY,
    mutualInformation,
    massBeforeNormalization,
  };
}

interface InterpolationLocation {
  first: number;
  second: number;
  weight: number;
}

function interpolationLocation(value: number, domain: [number, number], count: number): InterpolationLocation {
  const step = (domain[1] - domain[0]) / count;
  const fractionalIndex = (value - domain[0]) / step - 0.5;
  if (fractionalIndex <= 0) return { first: 0, second: 0, weight: 0 };
  if (fractionalIndex >= count - 1) {
    return { first: count - 1, second: count - 1, weight: 0 };
  }
  const first = Math.floor(fractionalIndex);
  return { first, second: first + 1, weight: fractionalIndex - first };
}

function interpolatePair(first: number, second: number, weight: number): number {
  return first + (second - first) * weight;
}

export function interpolate1D(
  values: Float64Array,
  value: number,
  domain: [number, number],
): number {
  const location = interpolationLocation(value, domain, values.length);
  return interpolatePair(values[location.first], values[location.second], location.weight);
}

export function interpolateJoint(model: GridModel, x: number, y: number): number {
  const xLocation = interpolationLocation(x, model.domain.x, model.nx);
  const yLocation = interpolationLocation(y, model.domain.y, model.ny);
  const lower = interpolatePair(
    model.joint[yLocation.first * model.nx + xLocation.first],
    model.joint[yLocation.first * model.nx + xLocation.second],
    xLocation.weight,
  );
  const upper = interpolatePair(
    model.joint[yLocation.second * model.nx + xLocation.first],
    model.joint[yLocation.second * model.nx + xLocation.second],
    xLocation.weight,
  );
  return interpolatePair(lower, upper, yLocation.weight);
}

function klDivergence(
  conditional: Float64Array,
  marginal: Float64Array,
  spacing: number,
): number {
  let result = 0;
  for (let index = 0; index < conditional.length; index += 1) {
    const p = conditional[index];
    const q = marginal[index];
    if (p === 0) continue;
    if (q === 0) return Number.POSITIVE_INFINITY;
    result += p * (Math.log(p / q) / LOG_2) * spacing;
  }
  return result < 0 && result > -1e-12 ? 0 : result;
}

export function conditionalXAtY(model: GridModel, selectedY: number): ConditionalSlice {
  const yLocation = interpolationLocation(selectedY, model.domain.y, model.ny);
  const raw = new Float64Array(model.nx);
  let normalizingMass = 0;
  for (let ix = 0; ix < model.nx; ix += 1) {
    const value = interpolatePair(
      model.joint[yLocation.first * model.nx + ix],
      model.joint[yLocation.second * model.nx + ix],
      yLocation.weight,
    );
    raw[ix] = value;
    normalizingMass += value * model.dx;
  }
  if (!(normalizingMass > 0) || !Number.isFinite(normalizingMass)) {
    return {
      coordinate: model.x,
      marginal: model.marginalX,
      conditional: null,
      conditioningDensity: normalizingMass,
      klDivergence: null,
    };
  }
  for (let ix = 0; ix < model.nx; ix += 1) raw[ix] /= normalizingMass;
  return {
    coordinate: model.x,
    marginal: model.marginalX,
    conditional: raw,
    conditioningDensity: normalizingMass,
    klDivergence: klDivergence(raw, model.marginalX, model.dx),
  };
}

export function conditionalYAtX(model: GridModel, selectedX: number): ConditionalSlice {
  const xLocation = interpolationLocation(selectedX, model.domain.x, model.nx);
  const raw = new Float64Array(model.ny);
  let normalizingMass = 0;
  for (let iy = 0; iy < model.ny; iy += 1) {
    const value = interpolatePair(
      model.joint[iy * model.nx + xLocation.first],
      model.joint[iy * model.nx + xLocation.second],
      xLocation.weight,
    );
    raw[iy] = value;
    normalizingMass += value * model.dy;
  }
  if (!(normalizingMass > 0) || !Number.isFinite(normalizingMass)) {
    return {
      coordinate: model.y,
      marginal: model.marginalY,
      conditional: null,
      conditioningDensity: normalizingMass,
      klDivergence: null,
    };
  }
  for (let iy = 0; iy < model.ny; iy += 1) raw[iy] /= normalizingMass;
  return {
    coordinate: model.y,
    marginal: model.marginalY,
    conditional: raw,
    conditioningDensity: normalizingMass,
    klDivergence: klDivergence(raw, model.marginalY, model.dy),
  };
}

export function selectedPointMetrics(model: GridModel, x: number, y: number): SelectedPointMetrics {
  const joint = interpolateJoint(model, x, y);
  const marginalX = interpolate1D(model.marginalX, x, model.domain.x);
  const marginalY = interpolate1D(model.marginalY, y, model.domain.y);
  const product = marginalX * marginalY;
  return {
    x,
    y,
    joint,
    product,
    marginalX,
    marginalY,
    information: productInformation(joint, product),
  };
}

export function integrate(values: Float64Array, spacing: number): number {
  let sum = 0;
  for (const value of values) sum += value * spacing;
  return sum;
}

export function weightedConditionalAverages(model: GridModel): { overX: number; overY: number } {
  let overX = 0;
  for (let ix = 0; ix < model.nx; ix += 1) {
    overX += model.marginalX[ix] * model.klYGivenX[ix] * model.dx;
  }
  let overY = 0;
  for (let iy = 0; iy < model.ny; iy += 1) {
    overY += model.marginalY[iy] * model.klXGivenY[iy] * model.dy;
  }
  return { overX, overY };
}

export function covariance(model: GridModel): number {
  let meanX = 0;
  let meanY = 0;
  for (let ix = 0; ix < model.nx; ix += 1) meanX += model.x[ix] * model.marginalX[ix] * model.dx;
  for (let iy = 0; iy < model.ny; iy += 1) meanY += model.y[iy] * model.marginalY[iy] * model.dy;
  let value = 0;
  for (let iy = 0; iy < model.ny; iy += 1) {
    for (let ix = 0; ix < model.nx; ix += 1) {
      value +=
        (model.x[ix] - meanX) *
        (model.y[iy] - meanY) *
        model.joint[iy * model.nx + ix] *
        model.dx *
        model.dy;
    }
  }
  return value;
}

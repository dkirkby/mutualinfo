import {
  NOAA_ENSO_MONTH_COUNT,
  NOAA_NINO34_BANDWIDTH_C,
  NOAA_NINO34_BASE64,
  NOAA_NINO34_HISTOGRAM_DOMAIN,
  NOAA_SOI_BANDWIDTH,
  NOAA_SOI_BASE64,
  NOAA_SOI_HISTOGRAM_DOMAIN,
} from "./data/noaaEnso";

const NINO34_BINS = 128;
const SOI_BINS = 128;

let nino34: Float64Array | null = null;
let soi: Float64Array | null = null;
const densityCache = new Map<number, Float64Array>();
const correlationCache = new Map<number, number>();

function decodeBase64(encoded: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((encoded.length * 3) / 4 - padding);
  let outputIndex = 0;
  for (let index = 0; index < encoded.length; index += 4) {
    const first = alphabet.indexOf(encoded[index]);
    const second = alphabet.indexOf(encoded[index + 1]);
    const third = encoded[index + 2] === "=" ? 0 : alphabet.indexOf(encoded[index + 2]);
    const fourth = encoded[index + 3] === "=" ? 0 : alphabet.indexOf(encoded[index + 3]);
    const packed = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (packed >> 16) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (packed >> 8) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = packed & 0xff;
  }
  return bytes;
}

function decodeSeries(encoded: string): Float64Array {
  const bytes = decodeBase64(encoded);
  if (bytes.length !== NOAA_ENSO_MONTH_COUNT * 4) {
    throw new Error("Unexpected NOAA climate-series byte length");
  }
  const view = new DataView(bytes.buffer);
  const values = new Float64Array(NOAA_ENSO_MONTH_COUNT);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getFloat32(index * 4, true);
  }
  return values;
}

function series(): { nino34: Float64Array; soi: Float64Array } {
  nino34 ??= decodeSeries(NOAA_NINO34_BASE64);
  soi ??= decodeSeries(NOAA_SOI_BASE64);
  return { nino34, soi };
}

function integerLag(lag: number): number {
  return Math.max(-12, Math.min(12, Math.round(lag)));
}

function pairRange(lag: number): [number, number] {
  return [Math.max(0, -lag), Math.min(NOAA_ENSO_MONTH_COUNT, NOAA_ENSO_MONTH_COUNT - lag)];
}

function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(4 * sigma));
  const kernel = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = Math.exp(-0.5 * (offset / sigma) ** 2);
    kernel[offset + radius] = value;
    sum += value;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
  return kernel;
}

function buildDensity(requestedLag: number): Float64Array {
  const lag = integerLag(requestedLag);
  const cached = densityCache.get(lag);
  if (cached) return cached;

  const values = series();
  const ninoStep =
    (NOAA_NINO34_HISTOGRAM_DOMAIN[1] - NOAA_NINO34_HISTOGRAM_DOMAIN[0]) / NINO34_BINS;
  const soiStep = (NOAA_SOI_HISTOGRAM_DOMAIN[1] - NOAA_SOI_HISTOGRAM_DOMAIN[0]) / SOI_BINS;
  const histogram = new Float64Array(NINO34_BINS * SOI_BINS);
  const [first, end] = pairRange(lag);
  const inversePairCount = 1 / (end - first);

  for (let index = first; index < end; index += 1) {
    const ninoIndex = Math.min(
      NINO34_BINS - 1,
      Math.max(0, Math.floor((values.nino34[index] - NOAA_NINO34_HISTOGRAM_DOMAIN[0]) / ninoStep)),
    );
    const soiIndex = Math.min(
      SOI_BINS - 1,
      Math.max(0, Math.floor((values.soi[index + lag] - NOAA_SOI_HISTOGRAM_DOMAIN[0]) / soiStep)),
    );
    histogram[soiIndex * NINO34_BINS + ninoIndex] += inversePairCount;
  }

  const ninoKernel = gaussianKernel(NOAA_NINO34_BANDWIDTH_C / ninoStep);
  const soiKernel = gaussianKernel(NOAA_SOI_BANDWIDTH / soiStep);
  const ninoRadius = (ninoKernel.length - 1) / 2;
  const soiRadius = (soiKernel.length - 1) / 2;
  const horizontal = new Float64Array(histogram.length);

  for (let iy = 0; iy < SOI_BINS; iy += 1) {
    for (let ix = 0; ix < NINO34_BINS; ix += 1) {
      let value = 0;
      for (let offset = -ninoRadius; offset <= ninoRadius; offset += 1) {
        const sourceX = ix - offset;
        if (sourceX >= 0 && sourceX < NINO34_BINS) {
          value += histogram[iy * NINO34_BINS + sourceX] * ninoKernel[offset + ninoRadius];
        }
      }
      horizontal[iy * NINO34_BINS + ix] = value;
    }
  }

  const density = new Float64Array(histogram.length);
  const inverseCellArea = 1 / (ninoStep * soiStep);
  for (let iy = 0; iy < SOI_BINS; iy += 1) {
    for (let ix = 0; ix < NINO34_BINS; ix += 1) {
      let value = 0;
      for (let offset = -soiRadius; offset <= soiRadius; offset += 1) {
        const sourceY = iy - offset;
        if (sourceY >= 0 && sourceY < SOI_BINS) {
          value += horizontal[sourceY * NINO34_BINS + ix] * soiKernel[offset + soiRadius];
        }
      }
      density[iy * NINO34_BINS + ix] = value * inverseCellArea;
    }
  }
  densityCache.set(lag, density);
  return density;
}

interface Location {
  first: number;
  second: number;
  weight: number;
}

function location(value: number, domain: [number, number], count: number): Location {
  const step = (domain[1] - domain[0]) / count;
  const fractional = (value - domain[0]) / step - 0.5;
  if (fractional <= 0) return { first: 0, second: 0, weight: 0 };
  if (fractional >= count - 1) return { first: count - 1, second: count - 1, weight: 0 };
  const first = Math.floor(fractional);
  return { first, second: first + 1, weight: fractional - first };
}

function mix(first: number, second: number, weight: number): number {
  return first + (second - first) * weight;
}

export function climateLogDensity(ninoAnomaly: number, soiValue: number, lag: number): number {
  if (
    ninoAnomaly < NOAA_NINO34_HISTOGRAM_DOMAIN[0] ||
    ninoAnomaly > NOAA_NINO34_HISTOGRAM_DOMAIN[1] ||
    soiValue < NOAA_SOI_HISTOGRAM_DOMAIN[0] ||
    soiValue > NOAA_SOI_HISTOGRAM_DOMAIN[1]
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  const density = buildDensity(lag);
  const x = location(ninoAnomaly, NOAA_NINO34_HISTOGRAM_DOMAIN, NINO34_BINS);
  const y = location(soiValue, NOAA_SOI_HISTOGRAM_DOMAIN, SOI_BINS);
  const lower = mix(
    density[y.first * NINO34_BINS + x.first],
    density[y.first * NINO34_BINS + x.second],
    x.weight,
  );
  const upper = mix(
    density[y.second * NINO34_BINS + x.first],
    density[y.second * NINO34_BINS + x.second],
    x.weight,
  );
  const value = mix(lower, upper, y.weight);
  return value > 0 ? Math.log(value) : Number.NEGATIVE_INFINITY;
}

export function climatePairCount(lag: number): number {
  return NOAA_ENSO_MONTH_COUNT - Math.abs(integerLag(lag));
}

export function climateCorrelation(requestedLag: number): number {
  const lag = integerLag(requestedLag);
  const cached = correlationCache.get(lag);
  if (cached !== undefined) return cached;
  const values = series();
  const [first, end] = pairRange(lag);
  let sumX = 0;
  let sumY = 0;
  for (let index = first; index < end; index += 1) {
    sumX += values.nino34[index];
    sumY += values.soi[index + lag];
  }
  const count = end - first;
  const meanX = sumX / count;
  const meanY = sumY / count;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = first; index < end; index += 1) {
    const dx = values.nino34[index] - meanX;
    const dy = values.soi[index + lag] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  const correlation = covariance / Math.sqrt(varianceX * varianceY);
  correlationCache.set(lag, correlation);
  return correlation;
}

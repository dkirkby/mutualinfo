import {
  NHANES_HEIGHT_BINS,
  NHANES_HEIGHT_DOMAIN,
  NHANES_WEIGHT_BINS,
  NHANES_WEIGHT_DOMAIN,
  NHANES_WEIGHTED_HISTOGRAM_BASE64,
} from "./data/nhanesHeightWeight";

const BASE_HEIGHT_BANDWIDTH_CM = 2.4;
const BASE_WEIGHT_BANDWIDTH_KG = 5.5;

let baseHistogram: Float64Array | null = null;
let cachedSmoothing = Number.NaN;
let cachedDensity: Float64Array | null = null;

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

function decodeHistogram(): Float64Array {
  if (baseHistogram) return baseHistogram;
  const bytes = decodeBase64(NHANES_WEIGHTED_HISTOGRAM_BASE64);
  const view = new DataView(bytes.buffer);
  const result = new Float64Array(NHANES_HEIGHT_BINS * NHANES_WEIGHT_BINS);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getFloat32(index * 4, true);
  }
  baseHistogram = result;
  return result;
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

function blurHistogram(smoothing: number): Float64Array {
  if (cachedDensity && smoothing === cachedSmoothing) return cachedDensity;
  const source = decodeHistogram();
  const heightStep = (NHANES_HEIGHT_DOMAIN[1] - NHANES_HEIGHT_DOMAIN[0]) / NHANES_HEIGHT_BINS;
  const weightStep = (NHANES_WEIGHT_DOMAIN[1] - NHANES_WEIGHT_DOMAIN[0]) / NHANES_WEIGHT_BINS;
  const heightKernel = gaussianKernel((BASE_HEIGHT_BANDWIDTH_CM * smoothing) / heightStep);
  const weightKernel = gaussianKernel((BASE_WEIGHT_BANDWIDTH_KG * smoothing) / weightStep);
  const heightRadius = (heightKernel.length - 1) / 2;
  const weightRadius = (weightKernel.length - 1) / 2;
  const horizontal = new Float64Array(source.length);

  for (let iy = 0; iy < NHANES_WEIGHT_BINS; iy += 1) {
    for (let ix = 0; ix < NHANES_HEIGHT_BINS; ix += 1) {
      let value = 0;
      for (let offset = -heightRadius; offset <= heightRadius; offset += 1) {
        const sourceX = ix - offset;
        if (sourceX >= 0 && sourceX < NHANES_HEIGHT_BINS) {
          value += source[iy * NHANES_HEIGHT_BINS + sourceX] * heightKernel[offset + heightRadius];
        }
      }
      horizontal[iy * NHANES_HEIGHT_BINS + ix] = value;
    }
  }

  const density = new Float64Array(source.length);
  const inverseCellArea = 1 / (heightStep * weightStep);
  for (let iy = 0; iy < NHANES_WEIGHT_BINS; iy += 1) {
    for (let ix = 0; ix < NHANES_HEIGHT_BINS; ix += 1) {
      let value = 0;
      for (let offset = -weightRadius; offset <= weightRadius; offset += 1) {
        const sourceY = iy - offset;
        if (sourceY >= 0 && sourceY < NHANES_WEIGHT_BINS) {
          value +=
            horizontal[sourceY * NHANES_HEIGHT_BINS + ix] * weightKernel[offset + weightRadius];
        }
      }
      density[iy * NHANES_HEIGHT_BINS + ix] = value * inverseCellArea;
    }
  }
  cachedSmoothing = smoothing;
  cachedDensity = density;
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

export function nhanesLogDensity(heightCm: number, weightKg: number, smoothing: number): number {
  if (
    heightCm < NHANES_HEIGHT_DOMAIN[0] ||
    heightCm > NHANES_HEIGHT_DOMAIN[1] ||
    weightKg < NHANES_WEIGHT_DOMAIN[0] ||
    weightKg > NHANES_WEIGHT_DOMAIN[1]
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  const density = blurHistogram(smoothing);
  const x = location(heightCm, NHANES_HEIGHT_DOMAIN, NHANES_HEIGHT_BINS);
  const y = location(weightKg, NHANES_WEIGHT_DOMAIN, NHANES_WEIGHT_BINS);
  const lower = mix(
    density[y.first * NHANES_HEIGHT_BINS + x.first],
    density[y.first * NHANES_HEIGHT_BINS + x.second],
    x.weight,
  );
  const upper = mix(
    density[y.second * NHANES_HEIGHT_BINS + x.first],
    density[y.second * NHANES_HEIGHT_BINS + x.second],
    x.weight,
  );
  const value = mix(lower, upper, y.weight);
  return value > 0 ? Math.log(value) : Number.NEGATIVE_INFINITY;
}

import "./styles.css";
import { Heatmap } from "./charts/heatmap";
import { ProjectionChart } from "./charts/conditional";
import { Controls } from "./controls";
import { distributionById } from "./distributions";
import { NHANES_COHORT_SIZE } from "./data/nhanesHeightWeight";
import { NOAA_ENSO_END, NOAA_ENSO_START } from "./data/noaaEnso";
import { climateCorrelation, climatePairCount } from "./climate";
import {
  computeGrid,
  conditionalXAtY,
  conditionalYAtX,
  selectedPointMetrics,
  type GridModel,
} from "./numerics";
import { clampPoint, createInitialState, type Point } from "./state";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

const state = createInitialState();
let model: GridModel;
let recomputeFrame: number | null = null;
let selectionFrame: number | null = null;
let pendingPoint: Point | null = null;

const mutualInformation = requiredElement("mutual-information");
const densityMaximum = requiredElement("density-maximum");
const calculationStatus = requiredElement("calculation-status");
const selectedX = requiredElement("selected-x");
const selectedY = requiredElement("selected-y");
const selectedXLabel = requiredElement("selected-x-label");
const selectedYLabel = requiredElement("selected-y-label");
const selectedJoint = requiredElement("selected-joint");
const selectedProduct = requiredElement("selected-product");
const selectedInformation = requiredElement("selected-information");
const selectedInformationLabel = requiredElement("selected-information-label");
const selectedInformationUnit = requiredElement("selected-information-unit");
const klX = requiredElement("kl-x");
const klY = requiredElement("kl-y");
const informationWeightToggle = requiredElement<HTMLInputElement>("weight-information");
const informationFormula = requiredElement("information-formula");
const informationLegendMinimum = requiredElement("information-legend-min");
const informationLegendMaximum = requiredElement("information-legend-max");
const informationLegendNote = requiredElement("information-legend-note");
const methodNote = requiredElement("method-note");

const jointHeatmap = new Heatmap(requiredElement("joint-heatmap"), {
  kind: "joint",
  accessibleName: "Observed joint density",
  onSelect: requestSelection,
});
const productHeatmap = new Heatmap(requiredElement("product-heatmap"), {
  kind: "product",
  accessibleName: "Product of marginal densities",
  onSelect: requestSelection,
});
const informationHeatmap = new Heatmap(requiredElement("information-heatmap"), {
  kind: "information",
  accessibleName: "Pointwise mutual information",
  onSelect: requestSelection,
});
const heatmaps = [jointHeatmap, productHeatmap, informationHeatmap];

const jointXProjection = new ProjectionChart(requiredElement("joint-x-projection"), {
  orientation: "horizontal",
  showConditional: true,
  accessibleName: "Marginal density p of x and selected conditional density p of x given y zero",
});
const jointYProjection = new ProjectionChart(requiredElement("joint-y-projection"), {
  orientation: "vertical",
  showConditional: true,
  accessibleName: "Marginal density p of y and selected conditional density p of y given x zero",
});
const productXProjection = new ProjectionChart(requiredElement("product-x-projection"), {
  orientation: "horizontal",
  showConditional: false,
  accessibleName: "Marginal density p of x",
});
const productYProjection = new ProjectionChart(requiredElement("product-y-projection"), {
  orientation: "vertical",
  showConditional: false,
  accessibleName: "Marginal density p of y",
});

informationWeightToggle.checked = state.informationWeighted;
informationWeightToggle.addEventListener("change", () => {
  state.informationWeighted = informationWeightToggle.checked;
  informationHeatmap.setInformationWeighting(state.informationWeighted);
  renderInformationMode();
  updateSelection(state.selectedPoint);
});

const controls = new Controls({
  familySelect: requiredElement<HTMLSelectElement>("family-select"),
  parameterHost: requiredElement("parameter-controls"),
  description: requiredElement("family-description"),
  lesson: requiredElement("family-lesson"),
  source: requiredElement("family-source"),
  onFamilyChange: (family) => {
    state.family = family;
    const definition = currentDefinition();
    const domain = definition.domain(state.parameters[family]);
    const point = state.selectedPoint;
    if (
      point.x < domain.x[0] ||
      point.x > domain.x[1] ||
      point.y < domain.y[0] ||
      point.y > domain.y[1]
    ) {
      state.selectedPoint = definition.initialPoint ?? { x: 0, y: 0 };
    }
    renderControls();
    scheduleRecompute();
  },
  onParameterChange: (key, value) => {
    state.parameters[state.family][key] = value;
    scheduleRecompute();
  },
});

function currentDefinition() {
  const definition = distributionById.get(state.family);
  if (!definition) throw new Error(`Unknown distribution: ${state.family}`);
  return definition;
}

function renderControls(): void {
  controls.render(currentDefinition(), state.parameters[state.family]);
}

function scheduleRecompute(): void {
  calculationStatus.textContent = "Recalculating the probability grid.";
  if (recomputeFrame !== null) cancelAnimationFrame(recomputeFrame);
  recomputeFrame = requestAnimationFrame(() => {
    recomputeFrame = null;
    recompute();
  });
}

function recompute(): void {
  const definition = currentDefinition();
  model = computeGrid(definition, state.parameters[state.family], 384);
  state.selectedPoint = clampPoint(state.selectedPoint, model.domain.x, model.domain.y);
  const xLabel = definition.xLabel ?? "x";
  const yLabel = definition.yLabel ?? "y";
  for (const heatmap of heatmaps) {
    heatmap.setAxisLabels(xLabel, yLabel);
    heatmap.setTickFormatters(definition.xTickFormat, definition.yTickFormat);
    heatmap.setModel(model);
  }
  selectedXLabel.textContent = definition.xName ? `${definition.xName}₀ (${definition.xUnit})` : "x₀";
  selectedYLabel.textContent = definition.yName ? `${definition.yName}₀ (${definition.yUnit})` : "y₀";
  if (definition.id === "nhanes-adults") {
    methodNote.textContent = `The NHANES view is a survey-weighted kernel density derived from ${NHANES_COHORT_SIZE.toLocaleString()} measured adults. The finite histogram and kernel smoothing are numerical approximations; color fading and saturation never alter the integrals. See DATA_SOURCES.md for cohort and provenance details.`;
  } else if (definition.id === "enso-lag") {
    const lag = Math.round(state.parameters[state.family].lag);
    const signedLag = lag > 0 ? `+${lag}` : String(lag).replace("-", "−");
    methodNote.textContent = `NOAA monthly data from ${NOAA_ENSO_START} through ${NOAA_ENSO_END}; τ = ${signedLag} pairs Niño 3.4(t) with SOI(t + τ), using ${climatePairCount(lag).toLocaleString()} pairs (raw r = ${climateCorrelation(lag).toFixed(3)}). Monthly persistence reduces the effective independent sample size. Lagged MI measures association, not causal direction. See DATA_SOURCES.md for provenance and KDE details.`;
  } else {
    methodNote.textContent =
      "The page uses a normalized 384 × 384 cell-centered grid over a finite window. Infinite tails are truncated at six noise standard deviations. Fading and color saturation affect only the display, never the integrals.";
  }
  mutualInformation.textContent = formatBits(model.mutualInformation);
  densityMaximum.textContent = `max ${formatDensity(model.densityMax)}`;
  renderInformationMode();
  updateSelection(state.selectedPoint);
  calculationStatus.textContent = `${definition.name} grid ready. Mutual information ${formatBits(model.mutualInformation)} bits.`;
}

function requestSelection(point: Point): void {
  pendingPoint = point;
  if (selectionFrame !== null) return;
  selectionFrame = requestAnimationFrame(() => {
    selectionFrame = null;
    if (!pendingPoint) return;
    updateSelection(clampPoint(pendingPoint, model.domain.x, model.domain.y));
    pendingPoint = null;
  });
}

function updateSelection(point: Point): void {
  state.selectedPoint = point;
  for (const heatmap of heatmaps) heatmap.setSelection(point);
  const metrics = selectedPointMetrics(model, point.x, point.y);
  const xSlice = conditionalXAtY(model, point.y);
  const ySlice = conditionalYAtX(model, point.x);
  const xProjectionMaximum = projectionMaximum(xSlice.marginal, xSlice.conditional);
  const yProjectionMaximum = projectionMaximum(ySlice.marginal, ySlice.conditional);
  jointXProjection.setData(xSlice, xProjectionMaximum);
  productXProjection.setData(xSlice, xProjectionMaximum);
  jointYProjection.setData(ySlice, yProjectionMaximum);
  productYProjection.setData(ySlice, yProjectionMaximum);

  const definition = currentDefinition();
  selectedX.textContent = definition.xValueFormat?.(point.x) ?? formatCoordinate(point.x);
  selectedY.textContent = definition.yValueFormat?.(point.y) ?? formatCoordinate(point.y);
  selectedJoint.textContent = formatDensity(metrics.joint);
  selectedProduct.textContent = formatDensity(metrics.product);
  if (state.informationWeighted) {
    const contribution =
      metrics.joint > 0 && Number.isFinite(metrics.information)
        ? metrics.joint * metrics.information
        : 0;
    selectedInformationLabel.innerHTML = `<i>p</i>(x₀,y₀)<i>i</i>(x₀;y₀)`;
    selectedInformation.textContent = formatDensity(contribution);
    selectedInformationUnit.textContent = "bits × density";
  } else {
    selectedInformationLabel.innerHTML = `<i>i</i>(x₀;y₀)`;
    selectedInformation.textContent = formatBits(metrics.information);
    selectedInformationUnit.textContent = "bits";
  }
  klX.textContent = formatBits(xSlice.klDivergence);
  klY.textContent = formatBits(ySlice.klDivergence);
}

function projectionMaximum(marginal: Float64Array, conditional: Float64Array | null): number {
  let maximum = 0;
  for (const value of marginal) maximum = Math.max(maximum, value);
  if (conditional) {
    for (const value of conditional) maximum = Math.max(maximum, value);
  }
  return maximum * 1.06;
}

function renderInformationMode(): void {
  if (state.informationWeighted) {
    const limit = informationHeatmap.getInformationDisplayLimit();
    const formattedLimit = formatDensity(limit);
    informationFormula.innerHTML = `<i>p</i>(x,y)<i>i</i>(x;y)`;
    informationLegendMinimum.textContent = `−${formattedLimit}`;
    informationLegendMaximum.textContent = `+${formattedLimit}`;
    informationLegendNote.textContent =
      "Joint-density-weighted contribution to mutual information. The current symmetric scale uses the largest magnitude; integrating the field gives I(X;Y).";
  } else {
    informationFormula.innerHTML = `<i>i</i>(x;y) = log₂ <i>p</i>(x,y) / [<i>p</i>(x)<i>p</i>(y)]`;
    informationLegendMinimum.textContent = "≤ −4 bits";
    informationLegendMaximum.textContent = "≥ +4 bits";
    informationLegendNote.textContent =
      "Display clips at ±4 bits. Color fades from 10⁻⁴ to 10⁻³ of peak joint density.";
  }
}

function formatCoordinate(value: number): string {
  const rounded = Math.abs(value) < 0.0005 ? 0 : value;
  return rounded.toFixed(3).replace("-", "−");
}

function formatDensity(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "undefined";
  if (value === 0) return "0";
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 1000) {
    return value.toExponential(2).replace("e-", " × 10⁻").replace("e+", " × 10⁺");
  }
  return value.toFixed(3);
}

function formatBits(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "undefined";
  if (value === Number.POSITIVE_INFINITY) return "+∞";
  if (value === Number.NEGATIVE_INFINITY) return "−∞";
  const rounded = Math.abs(value) < 0.0005 ? 0 : value;
  return rounded.toFixed(3).replace("-", "−");
}

renderControls();
recompute();

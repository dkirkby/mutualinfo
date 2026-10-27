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
const entropyX = requiredElement("entropy-x");
const entropyY = requiredElement("entropy-y");
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
const informationProfileUnit = requiredElement("information-profile-unit");
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
const informationXProfile = new ProjectionChart(requiredElement("information-x-profile"), {
  orientation: "horizontal",
  showConditional: false,
  accessibleName: "Marginal-x-weighted conditional KL divergence of y given x",
  label: "p(x)Dₖₗ(Y|x)",
  areaClass: "information-profile-area",
});
const informationYProfile = new ProjectionChart(requiredElement("information-y-profile"), {
  orientation: "vertical",
  showConditional: false,
  accessibleName: "Marginal-y-weighted conditional KL divergence of x given y",
  label: "p(y)Dₖₗ(X|y)",
  areaClass: "information-profile-area",
});

informationWeightToggle.checked = state.informationWeighted;
informationHeatmap.setInformationWeighting(state.informationWeighted);
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
  state.selectedPoint = clampPoint(
    state.selectedPoint,
    model.displayDomain.x,
    model.displayDomain.y,
  );
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
    methodNote.textContent = `The NHANES view is a survey-weighted kernel density derived from ${NHANES_COHORT_SIZE.toLocaleString()} measured adults. All panels show the marginal 0.5th–99.5th percentile window, while normalization, MI, conditionals, and KL retain the clipped tails. The finite histogram and kernel smoothing are numerical approximations. See DATA_SOURCES.md for cohort and provenance details.`;
  } else if (definition.id === "enso-lag") {
    const lag = Math.round(state.parameters[state.family].lag);
    const signedLag = lag > 0 ? `+${lag}` : String(lag).replace("-", "−");
    methodNote.textContent = `NOAA monthly data from ${NOAA_ENSO_START} through ${NOAA_ENSO_END}; τ = ${signedLag} pairs Niño 3.4(t) with SOI(t + τ), using ${climatePairCount(lag).toLocaleString()} pairs (raw r = ${climateCorrelation(lag).toFixed(3)}). All panels show the marginal 0.5th–99.5th percentile window, but every metric retains the clipped tails. Monthly persistence reduces the effective independent sample size, and lagged MI does not establish causal direction.`;
  } else {
    methodNote.textContent =
      "The page uses a normalized 384 × 384 cell-centered grid over a finite calculation window. Every panel shows the marginal 0.5th–99.5th percentile window, but normalization and all information metrics retain the clipped tails. Infinite tails are truncated at six noise standard deviations. Color treatment affects only the display.";
  }
  mutualInformation.textContent = formatBits(model.mutualInformation);
  entropyX.textContent = formatBits(model.entropyX);
  entropyY.textContent = formatBits(model.entropyY);
  densityMaximum.textContent = `max ${formatDensity(model.densityMax)}`;
  renderInformationMode();
  updateSelection(state.selectedPoint);
  calculationStatus.textContent = `${definition.name} grid ready. Mutual information ${formatBits(model.mutualInformation)} bits. Grid entropies H X ${formatBits(model.entropyX)} bits and H Y ${formatBits(model.entropyY)} bits.`;
}

function requestSelection(point: Point): void {
  pendingPoint = point;
  if (selectionFrame !== null) return;
  selectionFrame = requestAnimationFrame(() => {
    selectionFrame = null;
    if (!pendingPoint) return;
    updateSelection(clampPoint(pendingPoint, model.displayDomain.x, model.displayDomain.y));
    pendingPoint = null;
  });
}

function updateSelection(point: Point): void {
  state.selectedPoint = point;
  for (const heatmap of heatmaps) heatmap.setSelection(point);
  const metrics = selectedPointMetrics(model, point.x, point.y);
  const xSlice = conditionalXAtY(model, point.y);
  const ySlice = conditionalYAtX(model, point.x);
  const xProjectionMaximum = model.profileMaxX * 1.06;
  const yProjectionMaximum = model.profileMaxY * 1.06;
  jointXProjection.setData(
    xSlice,
    xProjectionMaximum,
    model.displayDomain.x,
    model.profileMaxX,
  );
  productXProjection.setData(xSlice, xProjectionMaximum, model.displayDomain.x);
  jointYProjection.setData(
    ySlice,
    yProjectionMaximum,
    model.displayDomain.y,
    model.profileMaxY,
  );
  productYProjection.setData(ySlice, yProjectionMaximum, model.displayDomain.y);

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

function renderInformationMode(): void {
  renderInformationProfiles();
  if (state.informationWeighted) {
    const limit = informationHeatmap.getInformationDisplayLimit();
    const formattedLimit = formatDensity(limit);
    informationFormula.innerHTML = `<i>p</i>(x,y)<i>i</i>(x;y)`;
    informationLegendMinimum.textContent = `−${formattedLimit}`;
    informationLegendMaximum.textContent = `+${formattedLimit}`;
    informationLegendNote.textContent =
      "Joint-density-weighted contribution to mutual information. The attached profiles are weighted by p(x) and p(y); either full profile integrates to I(X;Y).";
  } else {
    informationFormula.innerHTML = `<i>i</i>(x;y)`;
    informationLegendMinimum.textContent = "≤ −4 bits";
    informationLegendMaximum.textContent = "≥ +4 bits";
    informationLegendNote.textContent =
      "Display clips at ±4 bits. Color fades in negligible-density regions; the attached profiles show conditional KL divergence in bits.";
  }
}

function renderInformationProfiles(): void {
  const topValues = state.informationWeighted
    ? multiplyProfiles(model.klYGivenX, model.marginalX)
    : model.klYGivenX;
  const rightValues = state.informationWeighted
    ? multiplyProfiles(model.klXGivenY, model.marginalY)
    : model.klXGivenY;
  informationXProfile.setProfile(
    model.x,
    topValues,
    visibleProfileMaximum(model.x, topValues, model.displayDomain.x, model.dx),
    model.displayDomain.x,
  );
  informationYProfile.setProfile(
    model.y,
    rightValues,
    visibleProfileMaximum(model.y, rightValues, model.displayDomain.y, model.dy),
    model.displayDomain.y,
  );
  if (state.informationWeighted) {
    informationXProfile.setLabel(
      "p(x)Dₖₗ(Y|x)",
      "Profile of p of x times KL divergence between p of y given x and p of y",
    );
    informationYProfile.setLabel(
      "p(y)Dₖₗ(X|y)",
      "Profile of p of y times KL divergence between p of x given y and p of x",
    );
    informationProfileUnit.textContent = "bits × marginal";
  } else {
    informationXProfile.setLabel(
      "Dₖₗ(Y|x)",
      "Profile of KL divergence between p of y given x and p of y",
    );
    informationYProfile.setLabel(
      "Dₖₗ(X|y)",
      "Profile of KL divergence between p of x given y and p of x",
    );
    informationProfileUnit.textContent = "bits";
  }
}

function multiplyProfiles(values: Float64Array, marginal: Float64Array): Float64Array {
  return Float64Array.from(values, (value, index) => value * marginal[index]);
}

function visibleProfileMaximum(
  coordinate: Float64Array,
  values: Float64Array,
  displayDomain: [number, number],
  spacing: number,
): number {
  let maximum = 0;
  for (let index = 0; index < coordinate.length; index += 1) {
    if (
      coordinate[index] >= displayDomain[0] - spacing &&
      coordinate[index] <= displayDomain[1] + spacing &&
      Number.isFinite(values[index])
    ) {
      maximum = Math.max(maximum, values[index]);
    }
  }
  return maximum > 0 ? maximum * 1.06 : 1;
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

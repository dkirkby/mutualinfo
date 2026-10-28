import * as d3 from "d3";
import type { GridModel } from "../numerics";
import type { Point } from "../state";

export type HeatmapKind = "joint" | "product" | "information";

interface HeatmapOptions {
  kind: HeatmapKind;
  accessibleName: string;
  onSelect: (point: Point) => void;
}

const DENSITY_INTERPOLATOR = d3.interpolateRgbBasis(["#f4f7f3", "#8ecbd0", "#267c91", "#16354e"]);
const INFORMATION_INTERPOLATOR = (value: number): string =>
  value <= 0.5
    ? d3.interpolateRgb("#65417d", "#f2f2e9")(value * 2)
    : d3.interpolateRgb("#f2f2e9", "#d36835")((value - 0.5) * 2);

export class Heatmap {
  private readonly host: HTMLElement;
  private readonly options: HeatmapOptions;
  private readonly stage: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly xAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly yAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly horizontalCrosshair: d3.Selection<SVGLineElement, unknown, null, undefined>;
  private readonly verticalCrosshair: d3.Selection<SVGLineElement, unknown, null, undefined>;
  private readonly pointMarker: d3.Selection<SVGCircleElement, unknown, null, undefined>;
  private readonly overlay: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private readonly xScale = d3.scaleLinear();
  private readonly yScale = d3.scaleLinear();
  private readonly margin = { top: 8, right: 12, bottom: 40, left: 52 };
  private model: GridModel | null = null;
  private selection: Point = { x: 0, y: 0 };
  private raster: HTMLCanvasElement | null = null;
  private width = 320;
  private height = 320;
  private activePointer: number | null = null;
  private resizeFrame: number | null = null;
  private readonly resizeObserver: ResizeObserver | null;
  private xTickFormat: ((value: number) => string) | undefined;
  private yTickFormat: ((value: number) => string) | undefined;
  private informationWeighted = false;
  private informationDisplayLimit = 4;

  constructor(host: HTMLElement, options: HeatmapOptions) {
    this.host = host;
    this.options = options;
    this.stage = document.createElement("div");
    this.stage.className = "heatmap-stage";
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.svg = d3.select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    this.svg.attr("role", "group").attr("aria-label", options.accessibleName);
    this.stage.append(this.canvas, this.svg.node() as SVGSVGElement);
    this.host.append(this.stage);

    this.xAxis = this.svg.append("g").attr("class", "axis x-axis");
    this.yAxis = this.svg.append("g").attr("class", "axis y-axis");
    this.svg.append("text").attr("class", "axis-label x-label").text("x");
    this.svg.append("text").attr("class", "axis-label y-label").text("y");
    this.horizontalCrosshair = this.svg
      .append("line")
      .attr("class", "crosshair horizontal-crosshair");
    this.verticalCrosshair = this.svg
      .append("line")
      .attr("class", "crosshair vertical-crosshair");
    this.pointMarker = this.svg.append("circle").attr("class", "point-marker").attr("r", 3.5);
    this.overlay = this.svg
      .append("rect")
      .attr("class", "heatmap-overlay")
      .attr("fill", "transparent")
      .attr("tabindex", 0)
      .attr("role", "application")
      .attr("aria-roledescription", "interactive heatmap")
      .attr("aria-label", `${options.accessibleName}. Use arrow keys to move the selected point.`);

    this.bindInteraction();
    this.resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => this.scheduleResize());
    this.resizeObserver?.observe(this.stage);
    window.addEventListener("resize", () => this.scheduleResize());
  }

  setModel(model: GridModel): void {
    this.model = model;
    this.xScale.domain(model.displayDomain.x);
    this.yScale.domain(model.displayDomain.y);
    this.raster = this.createRaster(model);
    this.resize();
  }

  setInformationWeighting(weighted: boolean): void {
    if (this.options.kind !== "information" || this.informationWeighted === weighted) return;
    this.informationWeighted = weighted;
    if (this.model) {
      this.raster = this.createRaster(this.model);
      this.resize();
    }
  }

  getInformationDisplayLimit(): number {
    return this.informationDisplayLimit;
  }

  setAxisLabels(xLabel: string, yLabel: string): void {
    this.svg.select<SVGTextElement>(".x-label").text(xLabel);
    this.svg.select<SVGTextElement>(".y-label").text(yLabel);
  }

  setTickFormatters(
    xTickFormat?: (value: number) => string,
    yTickFormat?: (value: number) => string,
  ): void {
    this.xTickFormat = xTickFormat;
    this.yTickFormat = yTickFormat;
  }

  setSelection(point: Point): void {
    this.selection = point;
    if (!this.model) return;
    const x = this.xScale(point.x);
    const y = this.yScale(point.y);
    const xStart = this.margin.left;
    const xEnd = this.width - this.margin.right;
    const yStart = this.margin.top;
    const yEnd = this.height - this.margin.bottom;
    this.verticalCrosshair.attr("x1", x).attr("x2", x).attr("y1", yStart).attr("y2", yEnd);
    this.horizontalCrosshair.attr("x1", xStart).attr("x2", xEnd).attr("y1", y).attr("y2", y);
    this.pointMarker.attr("cx", x).attr("cy", y);
    this.overlay.attr(
      "aria-label",
      `${this.options.accessibleName}. Selected x ${point.x.toFixed(3)}, y ${point.y.toFixed(3)}. ` +
        "Use arrow keys to move one grid interval, or Shift plus arrow for ten.",
    );
  }

  private createRaster(model: GridModel): HTMLCanvasElement {
    const raster = document.createElement("canvas");
    raster.width = model.nx;
    raster.height = model.ny;
    const context = raster.getContext("2d");
    if (!context) throw new Error("Canvas 2D rendering is not available.");
    const image = context.createImageData(model.nx, model.ny);
    const densityScale = d3.scaleSequential(DENSITY_INTERPOLATOR).domain([0, model.densityMax]);
    this.informationDisplayLimit = this.informationWeighted
      ? Math.max(model.informationContributionMax, 1e-10)
      : 4;
    const informationScale = d3
      .scaleDiverging(INFORMATION_INTERPOLATOR)
      .domain([-this.informationDisplayLimit, 0, this.informationDisplayLimit])
      .clamp(true);
    const values = this.options.kind === "joint" ? model.joint : model.product;

    for (let iy = 0; iy < model.ny; iy += 1) {
      for (let ix = 0; ix < model.nx; ix += 1) {
        const sourceIndex = iy * model.nx + ix;
        const destinationIndex = ((model.ny - 1 - iy) * model.nx + ix) * 4;
        let color: d3.RGBColor;
        let alpha = 255;
        if (this.options.kind === "information") {
          const information = this.informationWeighted
            ? model.informationContribution[sourceIndex]
            : model.information[sourceIndex];
          color = d3.rgb(Number.isFinite(information) ? informationScale(information) : "#e7ebe7");
          if (!this.informationWeighted) {
            const relativeDensity = model.joint[sourceIndex] / model.jointMax;
            if (relativeDensity <= 1e-4) alpha = 0;
            else if (relativeDensity < 1e-3) {
              alpha = Math.round(255 * (Math.log10(relativeDensity) + 4));
            }
          }
        } else {
          color = d3.rgb(densityScale(values[sourceIndex]));
        }
        image.data[destinationIndex] = color.r;
        image.data[destinationIndex + 1] = color.g;
        image.data[destinationIndex + 2] = color.b;
        image.data[destinationIndex + 3] = alpha;
      }
    }
    context.putImageData(image, 0, 0);
    return raster;
  }

  private resize(): void {
    if (!this.model) return;
    const stageBounds = this.stage.getBoundingClientRect();
    const stageWidth = Math.max(260, stageBounds.width || this.stage.clientWidth || 320);
    const stageHeight = Math.max(220, stageBounds.height || this.stage.clientHeight || stageWidth);
    this.width = stageWidth;
    this.height = stageHeight;
    const innerWidth = this.width - this.margin.left - this.margin.right;
    const innerHeight = this.height - this.margin.top - this.margin.bottom;
    this.xScale.range([this.margin.left, this.margin.left + innerWidth]);
    this.yScale.range([this.margin.top + innerHeight, this.margin.top]);

    const devicePixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(innerWidth * devicePixelRatio);
    this.canvas.height = Math.round(innerHeight * devicePixelRatio);
    this.canvas.style.left = `${this.margin.left}px`;
    this.canvas.style.top = `${this.margin.top}px`;
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
    const context = this.canvas.getContext("2d");
    if (context && this.raster) {
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      context.imageSmoothingEnabled = true;
      const sourceX =
        ((this.model.displayDomain.x[0] - this.model.domain.x[0]) /
          (this.model.domain.x[1] - this.model.domain.x[0])) *
        this.model.nx;
      const sourceWidth =
        ((this.model.displayDomain.x[1] - this.model.displayDomain.x[0]) /
          (this.model.domain.x[1] - this.model.domain.x[0])) *
        this.model.nx;
      const sourceY =
        ((this.model.domain.y[1] - this.model.displayDomain.y[1]) /
          (this.model.domain.y[1] - this.model.domain.y[0])) *
        this.model.ny;
      const sourceHeight =
        ((this.model.displayDomain.y[1] - this.model.displayDomain.y[0]) /
          (this.model.domain.y[1] - this.model.domain.y[0])) *
        this.model.ny;
      context.drawImage(
        this.raster,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
    }

    this.svg.attr("viewBox", `0 0 ${this.width} ${this.height}`);
    const xAxis = d3.axisBottom(this.xScale).ticks(5).tickSizeOuter(0);
    if (this.xTickFormat) xAxis.tickFormat((value) => this.xTickFormat?.(Number(value)) ?? "");
    const yAxis = d3.axisLeft(this.yScale).ticks(5).tickSizeOuter(0);
    if (this.yTickFormat) yAxis.tickFormat((value) => this.yTickFormat?.(Number(value)) ?? "");
    this.xAxis.attr("transform", `translate(0,${this.margin.top + innerHeight})`).call(xAxis);
    this.yAxis.attr("transform", `translate(${this.margin.left},0)`).call(yAxis);
    this.svg
      .select<SVGTextElement>(".x-label")
      .attr("x", this.margin.left + innerWidth / 2)
      .attr("y", this.height - 4);
    this.svg
      .select<SVGTextElement>(".y-label")
      .attr("transform", `translate(13,${this.margin.top + innerHeight / 2}) rotate(-90)`);
    this.overlay
      .attr("x", this.margin.left)
      .attr("y", this.margin.top)
      .attr("width", innerWidth)
      .attr("height", innerHeight);
    this.setSelection(this.selection);
  }

  private scheduleResize(): void {
    if (this.resizeFrame !== null) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      if (this.model) this.resize();
    });
  }

  private bindInteraction(): void {
    this.overlay
      .on("pointerdown", (event: PointerEvent) => {
        this.activePointer = event.pointerId;
        (event.currentTarget as SVGRectElement).setPointerCapture(event.pointerId);
        this.selectFromPointer(event);
      })
      .on("pointermove", (event: PointerEvent) => {
        if (event.pointerId === this.activePointer) this.selectFromPointer(event);
      })
      .on("pointerup", (event: PointerEvent) => {
        if (event.pointerId === this.activePointer) {
          this.selectFromPointer(event);
          this.activePointer = null;
        }
      })
      .on("pointercancel", (event: PointerEvent) => {
        if (event.pointerId === this.activePointer) this.activePointer = null;
      })
      .on("keydown", (event: KeyboardEvent) => this.handleKeydown(event));
  }

  private selectFromPointer(event: PointerEvent): void {
    if (!this.model) return;
    event.preventDefault();
    const bounds = (this.svg.node() as SVGSVGElement).getBoundingClientRect();
    const scaleX = this.width / bounds.width;
    const scaleY = this.height / bounds.height;
    const pixelX = Math.max(
      this.margin.left,
      Math.min(this.width - this.margin.right, (event.clientX - bounds.left) * scaleX),
    );
    const pixelY = Math.max(
      this.margin.top,
      Math.min(this.height - this.margin.bottom, (event.clientY - bounds.top) * scaleY),
    );
    this.options.onSelect({ x: this.xScale.invert(pixelX), y: this.yScale.invert(pixelY) });
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.model) return;
    const multiplier = event.shiftKey ? 10 : 1;
    const point = { ...this.selection };
    if (event.key === "ArrowLeft") point.x -= this.model.dx * multiplier;
    else if (event.key === "ArrowRight") point.x += this.model.dx * multiplier;
    else if (event.key === "ArrowDown") point.y -= this.model.dy * multiplier;
    else if (event.key === "ArrowUp") point.y += this.model.dy * multiplier;
    else return;
    event.preventDefault();
    point.x = Math.max(
      this.model.displayDomain.x[0],
      Math.min(this.model.displayDomain.x[1], point.x),
    );
    point.y = Math.max(
      this.model.displayDomain.y[0],
      Math.min(this.model.displayDomain.y[1], point.y),
    );
    this.options.onSelect(point);
  }
}

import * as d3 from "d3";
import type { ConditionalSlice } from "../numerics";

interface ProjectionChartOptions {
  orientation: "horizontal" | "vertical";
  showConditional: boolean;
  accessibleName: string;
}

let chartCounter = 0;

export class ProjectionChart {
  private readonly host: HTMLElement;
  private readonly options: ProjectionChartOptions;
  private readonly svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly marginalPath: d3.Selection<SVGPathElement, unknown, null, undefined>;
  private readonly conditionalPath: d3.Selection<SVGPathElement, unknown, null, undefined>;
  private readonly baseline: d3.Selection<SVGLineElement, unknown, null, undefined>;
  private readonly unavailable: d3.Selection<SVGTextElement, unknown, null, undefined>;
  private readonly coordinateScale = d3.scaleLinear();
  private readonly densityScale = d3.scaleLinear();
  private readonly clipId: string;
  private slice: ConditionalSlice | null = null;
  private scaleMaximum = 1;
  private resizeFrame: number | null = null;

  constructor(host: HTMLElement, options: ProjectionChartOptions) {
    this.host = host;
    this.options = options;
    chartCounter += 1;
    this.clipId = `projection-clip-${chartCounter}`;
    this.svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"))
      .attr("role", "img")
      .attr("aria-label", options.accessibleName);
    this.host.append(this.svg.node() as SVGSVGElement);
    this.svg.append("defs").append("clipPath").attr("id", this.clipId).append("rect");
    this.plot = this.svg.append("g").attr("clip-path", `url(#${this.clipId})`);
    this.baseline = this.plot.append("line").attr("class", "projection-baseline");
    this.marginalPath = this.plot.append("path").attr("class", "projection-marginal-line");
    this.conditionalPath = this.plot
      .append("path")
      .attr(
        "class",
        options.orientation === "horizontal"
          ? "projection-conditional-line conditional-x-line"
          : "projection-conditional-line conditional-y-line",
      );
    this.unavailable = this.svg
      .append("text")
      .attr("class", "projection-unavailable")
      .text("slice unavailable");
    this.svg
      .append("text")
      .attr("class", "projection-label")
      .text(options.orientation === "horizontal" ? "p(x)" : "p(y)");
    window.addEventListener("resize", () => this.scheduleResize());
  }

  setData(slice: ConditionalSlice, scaleMaximum: number): void {
    this.slice = slice;
    this.scaleMaximum = scaleMaximum > 0 ? scaleMaximum : 1;
    this.resize();
  }

  private resize(): void {
    if (!this.slice) return;
    const horizontal = this.options.orientation === "horizontal";
    const width = Math.max(horizontal ? 220 : 64, this.host.clientWidth || (horizontal ? 320 : 82));
    const height = Math.max(horizontal ? 62 : 220, this.host.clientHeight || (horizontal ? 78 : 320));
    const margins = horizontal
      ? { top: 18, right: 12, bottom: 4, left: 52 }
      : { top: 8, right: 8, bottom: 40, left: 4 };
    const innerWidth = width - margins.left - margins.right;
    const innerHeight = height - margins.top - margins.bottom;
    const coordinate = this.slice.coordinate;
    const spacing = coordinate.length > 1 ? coordinate[1] - coordinate[0] : 1;
    this.coordinateScale.domain([
      coordinate[0] - spacing / 2,
      coordinate[coordinate.length - 1] + spacing / 2,
    ]);
    this.densityScale.domain([0, this.scaleMaximum]);
    if (horizontal) {
      this.coordinateScale.range([margins.left, margins.left + innerWidth]);
      this.densityScale.range([margins.top + innerHeight, margins.top]);
    } else {
      this.coordinateScale.range([margins.top + innerHeight, margins.top]);
      this.densityScale.range([margins.left, margins.left + innerWidth]);
    }

    this.svg.attr("viewBox", `0 0 ${width} ${height}`);
    this.svg
      .select(`#${this.clipId} rect`)
      .attr("x", margins.left)
      .attr("y", margins.top)
      .attr("width", innerWidth)
      .attr("height", innerHeight);
    this.svg
      .select<SVGTextElement>(".projection-label")
      .attr("x", horizontal ? margins.left + 3 : width / 2)
      .attr("y", horizontal ? 12 : height - 15)
      .attr("text-anchor", horizontal ? "start" : "middle");

    if (horizontal) {
      this.baseline
        .attr("x1", margins.left)
        .attr("x2", margins.left + innerWidth)
        .attr("y1", margins.top + innerHeight)
        .attr("y2", margins.top + innerHeight);
    } else {
      this.baseline
        .attr("x1", margins.left)
        .attr("x2", margins.left)
        .attr("y1", margins.top)
        .attr("y2", margins.top + innerHeight);
    }

    const line = horizontal
      ? d3
          .line<number>()
          .x((_, index) => this.coordinateScale(coordinate[index]))
          .y((value) => this.densityScale(value))
      : d3
          .line<number>()
          .x((value) => this.densityScale(value))
          .y((_, index) => this.coordinateScale(coordinate[index]));
    this.marginalPath.datum(Array.from(this.slice.marginal)).attr("d", line);
    const conditional = this.options.showConditional ? this.slice.conditional : null;
    this.conditionalPath
      .datum(conditional ? Array.from(conditional) : [])
      .attr("d", line)
      .attr("display", conditional ? null : "none");
    this.unavailable
      .attr("x", horizontal ? margins.left + innerWidth / 2 : width / 2)
      .attr("y", horizontal ? margins.top + innerHeight / 2 : margins.top + innerHeight / 2)
      .attr("transform", horizontal ? null : `rotate(90,${width / 2},${margins.top + innerHeight / 2})`)
      .attr(
        "display",
        this.options.showConditional && !this.slice.conditional ? null : "none",
      );
  }

  private scheduleResize(): void {
    if (this.resizeFrame !== null) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      if (this.slice) this.resize();
    });
  }
}

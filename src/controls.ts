import {
  distributions,
  type DistributionDefinition,
  type DistributionId,
  type Parameters,
} from "./distributions";

interface ControlsOptions {
  familySelect: HTMLSelectElement;
  parameterHost: HTMLElement;
  description: HTMLElement;
  lesson: HTMLElement;
  source: HTMLElement;
  onFamilyChange: (family: DistributionId) => void;
  onParameterChange: (key: string, value: number) => void;
}

export class Controls {
  private readonly options: ControlsOptions;

  constructor(options: ControlsOptions) {
    this.options = options;
    for (const definition of distributions) {
      const option = document.createElement("option");
      option.value = definition.id;
      option.textContent = definition.name;
      options.familySelect.append(option);
    }
    options.familySelect.addEventListener("change", () => {
      options.onFamilyChange(options.familySelect.value as DistributionId);
    });
  }

  render(definition: DistributionDefinition, parameters: Parameters): void {
    this.options.familySelect.value = definition.id;
    this.options.description.textContent = definition.description;
    this.options.lesson.textContent = definition.lesson;
    this.options.source.replaceChildren();
    if (definition.source) {
      const prefix = document.createTextNode("Source: ");
      const link = document.createElement("a");
      link.href = definition.source.url;
      link.textContent = definition.source.label;
      link.target = "_blank";
      link.rel = "noreferrer";
      this.options.source.append(prefix, link);
      this.options.source.hidden = false;
    } else {
      this.options.source.hidden = true;
    }
    this.options.parameterHost.replaceChildren();

    for (const parameter of definition.parameters) {
      const wrapper = document.createElement("div");
      wrapper.className = "slider-control";
      const id = `parameter-${definition.id}-${parameter.key}`;

      const label = document.createElement("label");
      label.htmlFor = id;
      const name = document.createElement("span");
      name.textContent = parameter.label;
      const output = document.createElement("output");
      output.htmlFor = id;
      output.textContent = this.formatValue(parameters[parameter.key], parameter);
      label.append(name, output);

      const input = document.createElement("input");
      input.id = id;
      input.type = "range";
      input.min = String(parameter.min);
      input.max = String(parameter.max);
      input.step = String(parameter.step);
      input.value = String(parameters[parameter.key]);
      input.setAttribute("aria-valuetext", output.textContent);
      input.addEventListener("input", () => {
        const value = Number(input.value);
        output.textContent = this.formatValue(value, parameter);
        input.setAttribute("aria-valuetext", output.textContent);
        this.options.onParameterChange(parameter.key, value);
      });
      wrapper.append(label, input);
      this.options.parameterHost.append(wrapper);
    }
  }

  private formatValue(value: number, parameter: DistributionDefinition["parameters"][number]): string {
    if (parameter.format) return parameter.format(value);
    const decimals = Math.max(0, Math.ceil(-Math.log10(parameter.step)));
    return value.toFixed(decimals);
  }
}

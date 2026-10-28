# Mutual Information Explorer

[Open the live explorer on GitHub Pages](https://dkirkby.github.io/mutualinfo/)

A static, client-side visualization connecting two views of mutual information:

- how a joint density differs from the independent reference `p(x)p(y)`; and
- how selecting one coordinate updates the distribution of the other.

The explorer includes seven deterministic density families, synchronized density and pointwise-information heatmaps, attached marginal/conditional projections, conditional-KL profiles, global mutual information, and selected-slice KL divergences. Five families are analytic models. Two are empirical kernel densities: measured adult height and weight from CDC/NCHS NHANES 2017–2018, and monthly NOAA Niño 3.4/Southern Oscillation Index climate data. All information quantities are reported in bits.

## Run locally

Requirements: a current Node.js release and npm.

```sh
npm install
npm run dev
```

Vite prints the local URL. The page has no backend or runtime API dependency.

## Test and build

```sh
npm test
npm run build
npm run preview
```

The production output is written to `dist/`. Vite uses a relative asset base, so the directory can be served from a domain root or a subdirectory.

## Numerical model

Each family is evaluated on a 384 × 384 cell-centered uniform calculation grid. The joint density is normalized on that full finite grid; both marginals, the independent reference, pointwise information, mutual information, conditional curves, and conditional KL divergences are derived from the same normalized array. Every heatmap and attached profile displays the marginal 0.5th–99.5th percentile ranges. The hidden 0.5% tails on either side remain in normalization and every reported metric. Selected slices use linear interpolation in probability space and are normalized over the full calculation range before their central portion is plotted.

Beside `I(X;Y)`, the explorer reports `H(X) = I(X;X)` and `H(Y) = I(Y;Y)` for the discretized grid-cell variables. These are Shannon entropies computed from the marginal cell probabilities `p(x) dx` and `p(y) dy`. They depend on the grid resolution and calculation domain; they are not the differential entropies of the underlying continuous densities. The grid mutual information converges to the continuous mutual information because its bin-width terms cancel.

Infinite-support models use finite windows extending six relevant noise standard deviations beyond their means, support, or ring radius. Consequently, values are finite-window numerical approximations. The test suite compares ordinary settings at 384 × 384 and 768 × 768 and requires mutual information to agree within 0.002 bits.

The Height vs Weight family starts from a compact survey-weighted NHANES histogram and applies an adjustable Gaussian kernel in the browser. It displays feet–inches and pounds over the smoothed density's marginal 0.5th–99.5th percentile ranges.

The Niño 3.4 vs SOI family packages 1,867 aligned monthly observations from NOAA PSL. Its lag slider pairs `Niño 3.4(t)` with `SOI(t + τ)` for integer lags from −12 to +12 months. Positive lag therefore asks how much the current ocean index tells us about a later atmospheric index. The axes remain fixed while lag changes. Temporal persistence reduces the effective independent sample size, and lagged mutual information does not establish causal direction.

See [DATA_SOURCES.md](DATA_SOURCES.md) for official source files, definitions, checksums, transformations, limitations, and rebuild instructions for both empirical families.

The two density heatmaps place `p(x)` immediately above and `p(y)` immediately to the right. Marginals are translucent teal areas without outlines, matching the density-map hue. Around the observed joint, the selected conditionals are overlaid on those projections. The horizontal crosshair and `p(x|y₀)` share one accent color; the vertical crosshair and `p(y|x₀)` share another. The independent-reference projections show only the marginals. Each coordinate uses a fixed scale computed when the distribution changes, so moving the crosshairs never renormalizes the profile frames. To keep a marginal legible beside an unusually sharp conditional, the scale ceiling is at most three times the visible marginal peak. Conditional segments above that ceiling are omitted, leaving a visible gap rather than drawing a false plateau or connector; this is display-only and does not change any calculation.

The information heatmap defaults to `p(x,y)i(x;y)`, the signed local contribution density whose full-grid integral is `I(X;Y)`; that mode uses a symmetric scale based on the current largest magnitude and needs no separate density fade. Its attached top profile is `p(x) D_KL[p(y|x) || p(y)]`, and its right profile is `p(y) D_KL[p(x|y) || p(x)]`. Either full-grid profile integrates to `I(X;Y)`. Unchecking the `weighted` control shows pointwise information at a display scale clipped to ±4 bits and removes the marginal factors from the attached KL profiles. Negligible-joint-density cells fade in this mode. Neither display treatment changes any computed quantity. Structural zero, an unavailable conditioning marginal, and numerical underflow are kept distinct; the implementation does not add an arbitrary probability floor.

### Weighted-information consistency check

The numerical test suite verifies the three equivalent weighted views at the production resolution for every distribution family:

```text
sum_xy p(x,y) i(x;y) dx dy
  = sum_x p(x) D_KL[p(y|x) || p(y)] dx
  = sum_y p(y) D_KL[p(x|y) || p(x)] dy
  = I(X;Y).
```

The check covers the five analytic families plus Height vs Weight and Niño 3.4 vs SOI at representative parameter values, and requires each quadrature to agree with the stored mutual information to 10 decimal places. These sums use the full calculation grid, including values outside the visible 0.5th–99.5th percentile window. Plot cropping, density fading, information-color clipping, and conditional-curve gaps therefore do not alter the identity.

## Interaction

Click or drag on any heatmap to update the shared selected point. Pointer capture supports mouse, pen, and touch. Once focused, a heatmap also accepts arrow keys for one-grid-cell movement and Shift+arrow for ten cells. Ordinary hover does not move the selection.

## License

This project is released under the [MIT License](LICENSE).

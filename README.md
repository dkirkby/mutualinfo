# Mutual Information Explorer

A static, client-side visualization connecting two views of mutual information:

- how a joint density differs from the independent reference `p(x)p(y)`; and
- how selecting one coordinate updates the distribution of the other.

The explorer includes seven deterministic density families, synchronized density and pointwise-information heatmaps, attached marginal/conditional projections, global mutual information, and selected-slice KL divergences. Five families are analytic models. Two are empirical kernel densities: measured adult height and weight from CDC/NCHS NHANES 2017–2018, and monthly NOAA Niño 3.4/Southern Oscillation Index climate data. All information quantities are reported in bits.

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

Each family is evaluated on a 384 × 384 cell-centered uniform grid. The joint density is normalized on that finite grid; both marginals, the independent reference, pointwise information, mutual information, conditional curves, and conditional KL divergences are derived from the same normalized array. Selected slices use linear interpolation in probability space and are renormalized before plotting.

Infinite-support models use finite windows extending six relevant noise standard deviations beyond their means, support, or ring radius. Consequently, values are finite-window numerical approximations. The test suite compares ordinary settings at 384 × 384 and 768 × 768 and requires mutual information to agree within 0.002 bits.

The Height vs Weight family starts from a compact survey-weighted NHANES histogram and applies an adjustable Gaussian kernel in the browser. It displays feet–inches and pounds over the weighted marginal 0.5th–99.5th percentile ranges.

The Niño 3.4 vs SOI family packages 1,867 aligned monthly observations from NOAA PSL. Its lag slider pairs `Niño 3.4(t)` with `SOI(t + τ)` for integer lags from −12 to +12 months. Positive lag therefore asks how much the current ocean index tells us about a later atmospheric index. The axes remain fixed while lag changes. Temporal persistence reduces the effective independent sample size, and lagged mutual information does not establish causal direction.

See [DATA_SOURCES.md](DATA_SOURCES.md) for official source files, definitions, checksums, transformations, limitations, and rebuild instructions for both empirical families.

The two density heatmaps place `p(x)` immediately above and `p(y)` immediately to the right. Around the observed joint, the selected conditionals are overlaid on those projections. The horizontal crosshair and `p(x|y₀)` share one accent color; the vertical crosshair and `p(y|x₀)` share another. The independent-reference projections show only the marginals, on the same density scales.

The pointwise-information heatmap clips its default display scale at ±4 bits and fades cells whose joint density is negligible relative to its peak. Its checkbox switches the field to `p(x,y)i(x;y)`, the signed local contribution density whose grid integral is `I(X;Y)`; that mode uses a symmetric scale based on the current largest magnitude and needs no separate density fade. Neither display treatment changes any computed quantity. Structural zero, an unavailable conditioning marginal, and numerical underflow are kept distinct; the implementation does not add an arbitrary probability floor.

## Interaction

Click or drag on any heatmap to update the shared selected point. Pointer capture supports mouse, pen, and touch. Once focused, a heatmap also accepts arrow keys for one-grid-cell movement and Shift+arrow for ten cells. Ordinary hover does not move the selection.

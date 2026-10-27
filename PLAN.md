# Mutual Information Explorer — implementation plan

## Goal and scope

Build a static, client-side webpage with Vite, TypeScript, and D3 that connects two interpretations of mutual information:

1. Departure from independence: compare p(x,y) with p(x)p(y) and their pointwise log-ratio.
2. Updating a distribution: compare each marginal with its conditional distribution at a selected point.

This deliverable is the implementation plan. Building and deploying the webpage are subsequent work.

## Confirmed requirements

- Seven selectable distribution families: independent Gaussian, correlated Gaussian, noisy parabola, Gaussian mixture, noisy ring, survey-weighted adult Height vs Weight, and monthly Niño 3.4 vs SOI.
- One or two parameter sliders for the selected family.
- Three synchronized 2D heatmaps: p(x,y), p(x)p(y), and i(x;y).
- Attach p(x) above and p(y) to the right of both density heatmaps. Around p(x,y), overlay p(x|y₀) and p(y|x₀); around p(x)p(y), show the marginals alone.
- Click-to-position and drag-to-update in any heatmap, with synchronized crosshairs in all three. Preserve the selected point after release; ordinary hover does not move it. Support touch.
- A diverging pointwise-information scale centered at zero, with a `weighted` checkbox that switches to the joint-density-weighted contribution p(x,y)i(x;y). Attach the conditional-KL profile over x above this panel and the profile over y to its right; weight them by p(x) and p(y), respectively, with the same checkbox. Information and KL values are in bits.
- Start with the correlated Gaussian selected and the information field weighted by p(x,y).
- Show global mutual information, the marginal grid entropies H(X) = I(X;X) and H(Y) = I(Y;Y), and both conditional KL divergences.
- Cap the displayed information color range and fade negligible-probability regions, while exposing the uncapped numerical value at the selected point.

The defaults below are implementation choices, rather than additional requirements needing clarification.

## Layout and visual design

At desktop widths, place the selector and relevant sliders above three equally sized heatmap panels in one row. Compose each density panel as a coordinate frame with p(x) directly above its heatmap and p(y) directly to its right. Stack the three complete panels at narrow widths without detaching projections or removing any metric.

- All heatmaps and projections share marginal 0.5th–99.5th percentile display domains and orientation: x rightward, y upward. Retain both clipped tails in normalization and every information calculation.
- Both density heatmaps use the same linear sequential color scale, including the same minimum and maximum. Compute their common maximum when parameters change and label the legend. Do not normalize their colors independently.
- The information heatmap uses a perceptually balanced diverging scale with a fixed initial display range of −4 to +4 bits. Legend endpoints indicate saturation beyond that range. Color clipping never changes computed values.
- Fade the information heatmap smoothly where p(x,y)/max p is below 10⁻⁴, with full opacity by 10⁻³. Label the convention in a compact legend/help note. Fading is only a display treatment, not an integration threshold.
- When weighting is enabled, display p(x,y)i(x;y) with a symmetric current-data scale and no extra density fade. Its integral over the grid must equal I(X;Y).
- Attach K_Y(x) = D_KL[p(y|x)||p(y)] above the information heatmap and K_X(y) = D_KL[p(x|y)||p(x)] to its right. In weighted mode show p(x)K_Y(x) and p(y)K_X(y); each full-grid profile integrates to I(X;Y).
- Draw marginals as translucent fills without outlines, using the density heatmaps' teal hue. Give p(x|y₀) the same accent as the horizontal y=y₀ crosshair, and p(y|x₀) the same accent as the vertical x=x₀ crosshair.
- For each coordinate, precompute one shared density scale across the joint and independent-reference projections and hold it fixed while the crosshairs move. Cap the scale at three times the visible marginal peak so unusually sharp conditionals do not compress the marginal into the baseline. Omit over-limit conditional segments, leaving a visible gap rather than connecting or flattening them; clipping is display-only.
- Show I(X;Y) near the heatmaps, with the smaller grid-cell entropy references H(X) = I(X;X) and H(Y) = I(Y;Y) beside it. Show D_KL(p(X|y₀)||p(X)) and D_KL(p(Y|x₀)||p(Y)) in the joint-panel slice key.
- A compact selected-point readout shows x₀, y₀, p(x₀,y₀), p(x₀)p(y₀), and the field displayed by the information heatmap: i(x₀;y₀) or p(x₀,y₀)i(x₀;y₀).

Include a short expandable explanation with the defining equations and the distinction between pointwise information, conditional KL, and mutual information. Explain that a pointwise value can be negative while the KL averages cannot.

## Distribution definitions and controls

Coordinates are dimensionless for the five analytic models. Height vs Weight displays feet–inches and pounds; Niño 3.4 vs SOI displays degrees Celsius and a standardized index. Noise variables in the analytic models are independent of the source variables.

| Family | Definition | Sliders (initial defaults) | Main lesson |
| --- | --- | --- | --- |
| Independent Gaussian | X and Y independent, centered normal variables | σx and σy: 0.5–1.5 (1, 1) | Changing marginal widths does not create dependence |
| Correlated Gaussian | Centered bivariate normal with unit marginal variances | ρ: −0.95–0.95 (0.7) | Dependence has either sign; conditionals shift and narrow |
| Noisy parabola | X uniform on [−1,1]; Y=aX²+η, η normal with standard deviation σ | a: 0–2 (1); σ: 0.08–0.6 (0.2) | Nonlinear dependence, zero covariance, and bimodal reverse conditionals |
| Gaussian mixture | Equal mixture of N((−d,−d),s²I) and N((d,d),s²I) | d: 0–2 (1); s: 0.2–1 (0.4) | Observations change inferred cluster membership; d=0 is independent |
| Noisy ring | Rotationally symmetric density proportional to exp[−(sqrt(x²+y²)−R)²/(2s²)] per unit Cartesian area | R: 0–2 (1); s: 0.1–0.6 (0.2) | Zero covariance with geometric dependence and two-lobed slices |
| Height vs Weight | Survey-weighted Gaussian-kernel density of measured standing height and weight for 5,120 adults aged 20+ in NHANES 2017–2018, excluding known pregnancies. Axes span the smoothed marginal 0.5th–99.5th percentiles. | joint KDE smoothing multiplier: 0.25–1.6 (1) | Real population heterogeneity produces a broad, asymmetric conditional update; low smoothing reveals isolated observations |
| Niño 3.4 vs SOI | Gaussian-kernel density of monthly HadISST Niño 3.4 SST anomaly at time `t` and CRU SOI at time `t + τ`, using the common NOAA PSL span from 1870-01 through 2025-07. | SOI lag `τ`: −12–+12 months (0) | Ocean and atmosphere are strongly associated with residual scatter; lagged MI is not evidence of causal direction |

The ring definition is deliberate: it is an annular Cartesian density, not a Gaussian radius sampled uniformly in angle. The latter would require a radial Jacobian treatment and would be a different distribution. At R=0, this model becomes an independent isotropic Gaussian.

The NHANES density is derived from the CDC/NCHS public-use `BMX_J` and `DEMO_J` files. Join on `SEQN`; require `RIDAGEYR >= 20`, valid `BMXHT`, `BMXWT`, and positive `WTMEC2YR`; and exclude records with `RIDEXPRG == 1`. Deposit normalized MEC examination weights into a 128×160 histogram, then apply a separable Gaussian kernel. Full provenance and rebuild instructions are in `DATA_SOURCES.md`.

The climate density is derived from NOAA PSL's monthly HadISST Niño 3.4 anomaly and CRU SOI files. Align their valid common months, preserve the signed lag convention `Niño 3.4(t)` versus `SOI(t + τ)`, deposit each pairing into a 128×128 histogram, and apply a fixed separable Gaussian kernel. Recompute the shared percentile display axes when lag changes while retaining the full padded domain for calculations. Full provenance, checksums, bandwidths, and interpretation limits are in `DATA_SOURCES.md`.

Preserve each family's slider settings when switching families. Initialize selection to the origin; preserve it across parameter edits when inside the new domain, otherwise clamp it. A selected point need not have high joint probability: such points can illustrate negative pointwise information.

## Mathematical quantities

All logarithms are base 2.

- p(x) = ∫ p(x,y) dy; p(y) = ∫ p(x,y) dx.
- Independent reference q(x,y) = p(x)p(y).
- i(x;y) = log₂[p(x,y)/q(x,y)].
- p(y|x₀) = p(x₀,y)/p(x₀), provided p(x₀)>0.
- p(x|y₀) = p(x,y₀)/p(y₀), provided p(y₀)>0.
- I(X;Y) = ∬ p(x,y)i(x;y) dx dy.
- For grid-cell probabilities P_i = p(x_i)Δx and Q_j = p(y_j)Δy, H(X) = −Σ_i P_i log₂P_i = I(X;X), with the analogous identity for Y. These displayed grid entropies depend on resolution; do not label them as differential entropy.
- K_Y(x₀) = ∫ p(y|x₀) log₂[p(y|x₀)/p(y)] dy.
- K_X(y₀) = ∫ p(x|y₀) log₂[p(x|y₀)/p(x)] dx.
- I(X;Y) = ∫ p(x)K_Y(x) dx = ∫ p(y)K_X(y) dy.

The last equality connects the five coordinated fields. Conditional KL is the conditional average of pointwise information along the corresponding slice. The selected conditional KL may exceed global mutual information; it is not bounded by that average.

## Numerical approach

Use deterministic density evaluation and quadrature, not sampled scatterplots or empirical mutual-information estimation.

1. Define an evaluable density or log-density for each family. Use stable log-sum-exp for the mixture and log-domain evaluation in tails.
   The empirical families instead interpolate binned observations after deterministic separable Gaussian smoothing. NHANES uses survey weights; the monthly climate pairs are unweighted.
2. Choose finite rectangular computation domains with six-noise-standard-deviation padding beyond means/support/ring radius. The parabola's x domain is exactly [−1,1]. Keep every panel synchronized when domains change with parameters.
3. Evaluate initially on a 384×384 cell-centered uniform grid. Normalize the grid using cell area. Treat the resulting model explicitly as a finite-window numerical approximation, not the exact infinite-support distribution.
4. Derive both marginals by summing this same normalized joint grid with the correct grid spacings. Construct q from those marginals and compute information from the same arrays.
5. Calculate MI with cell-area weights. Calculate conditional curves from interpolated rows/columns of the joint grid, then normalize the slice. Use those curves for conditional KL so the plotted update and reported value agree.
6. Interpolate in probability space consistently; do not interpolate precomputed log-ratios to obtain selected-point information. Derive the selected joint value and marginal values from the same interpolated model, then take the log-ratio.
7. Separate plot raster resolution from integration resolution. Increase integration resolution if validation at the narrowest allowed settings requires it; bound slider ranges so thin structures remain resolved. Compare against 768×768 during validation.
8. Exclude neither faded cells nor saturated colors from integration. Apply 0 log 0 = 0 in weighted integrals. Distinguish structural zero, undefined conditioning, and numerical underflow; never manufacture a finite value with an arbitrary probability floor.
9. If a marginal is zero or numerically unresolved, mark its conditional distribution and KL unavailable rather than showing a misleading curve. If p=0 and q>0, pointwise information is −∞; if p=q=0, it is undefined.

Document finite-window approximation and convergence in the mathematical help. Display rounded values appropriate to measured numerical accuracy, initially three decimals. Tiny negative numerical residuals may display as zero only within a documented tolerance; larger negatives indicate a defect.

## Interaction and performance

- Use Pointer Events and pointer capture so mouse, pen, and touch share the same interaction path. Set touch-action only on plot interaction surfaces, preserving ordinary page scrolling elsewhere.
- On pointerdown, set the point immediately; update while dragging; retain the point on pointerup or cancellation. Clamp drags to plot bounds.
- Use a transparent interaction overlay in each heatmap. Map pointer pixels through the shared scales to data coordinates.
- Update crosshairs, selected-point values, conditional curves, and conditional KL together through requestAnimationFrame.
- Compute joint grids, marginals, color maps, and MI only when family or parameters change. Cursor motion must not recompute the full grid.
- Render heatmaps to canvas with SVG axes, labels, and crosshairs; use SVG/D3 for the 1D curves. Account for device pixel ratio.
- Add keyboard focus to heatmap interaction areas; arrow keys move the selection by one grid interval and Shift+arrow by ten. Include accessible names, visible focus, and a concise description of current selection.
- Target smooth dragging on an ordinary laptop. Start with main-thread calculations; move parameter recomputation to a worker only if profiling reveals noticeable input blocking.

## Proposed project structure

- `index.html`: app entry.
- `src/main.ts`: setup and event coordination.
- `src/state.ts`: selected family, parameters, and selected point.
- `src/distributions.ts`: typed family registry, controls, domain rules, density functions.
- `src/data/nhanesHeightWeight.ts`: generated survey-weighted NHANES histogram and provenance checks.
- `src/nhanes.ts`: deterministic smoothing and interpolation for the empirical family.
- `src/data/noaaEnso.ts`: generated aligned NOAA monthly series, summary statistics, and provenance checks.
- `src/climate.ts`: lag pairing, deterministic smoothing, interpolation, and climate summary calculations.
- `src/numerics.ts`: quadrature, normalization, marginals, interpolation, information metrics.
- `src/charts/heatmap.ts`: canvas raster, SVG axes/crosshairs, pointer controls.
- `src/charts/conditional.ts`: compact horizontal and vertical marginal/conditional projections.
- `src/controls.ts`: selector, sliders, live values, mathematical help.
- `src/styles.css`: responsive layout and accessible visual styling.
- `tests/numerics.test.ts`: mathematical validation.
- `README.md`: installation, Vite development/build/preview, definitions, approximation limits.
- `DATA_SOURCES.md`: data provenance, cohort definition, limitations, and asset rebuild instructions.
- `scripts/prepare_nhanes_height_weight.py`: reproducible transformation from CDC XPT files.
- `scripts/prepare_noaa_enso.py`: reproducible transformation from NOAA PSL monthly index files.

Use D3 directly for scales, axes, lines, and color interpolation; its lower-level control fits synchronized canvas/SVG interaction well. No framework or backend is required. Bundle dependencies locally with Vite so production needs only static assets. Use a relative asset base for deployment under a subdirectory.

## Implementation sequence

1. Implement the typed distribution registry and pure numerical functions.
2. Validate normalization, conditional densities, and information identities before chart work.
3. Build the three heatmaps with matched density scales and PMI clipping/fading.
4. Add synchronized selection, attached conditional projections, and the three information metrics.
5. Add family-specific sliders, responsive layout, keyboard/touch support, and concise help.
6. Run numerical checks, leave manual visual verification to the user, profile updates, and produce a Vite production build with documentation.

## Acceptance checks

### Numerical correctness

- Joint, marginal, and valid conditional densities integrate to one within quadrature tolerance.
- Independent Gaussian gives matching p and q, overlapping marginal/conditional curves, and MI/KL near zero across slider settings.
- Correlated Gaussian MI agrees with −½ log₂(1−ρ²); conditionals agree with normal mean ρx₀ and variance 1−ρ², within finite-window error.
- Gaussian MI is unchanged when the sign of ρ changes.
- For every distribution family at representative parameters, the full-grid integral of p(x,y)i(x;y) and both marginal-weighted conditional-KL profiles agree with MI to 10 decimal places. Use the full grid, including display-clipped tails, not only the selected point.
- Parabola and ring have approximately zero covariance but positive MI away from their independence limits.
- Mixture d=0, parabola a=0, and ring R=0 recover independence.
- Ordinary settings converge to within 0.002 bits when resolution doubles. Assess extreme settings too; refine resolution or reduce parameter ranges rather than displaying unjustified precision.
- Display clipping and fading leave all computed metrics unchanged.
- The NHANES derived cohort metadata and weighted source means match the documented transformation; its MI decreases as kernel smoothing increases.
- The NOAA asset covers 1,867 contiguous common months; zero-lag correlation is negative, lag changes the density, and its ordinary grid converges at the documented tolerance.

### Interaction and presentation

- Dragging any heatmap updates all crosshairs to identical coordinates and updates both attached conditional projections correctly.
- The information checkbox switches between i(x;y) and p(x,y)i(x;y), and between raw and marginal-weighted conditional-KL profiles; the weighted field and either weighted profile integrate to the displayed mutual information.
- Changing only x₀ changes p(y|x₀) and K_Y, but not p(x|y₀) or K_X; changing only y₀ has the converse effect.
- Global MI stays fixed while the point moves; both conditional KL values may vary.
- Clicking positions the point, release preserves it, ordinary hover does not move it, and touch dragging works without unintended page scrolling inside the active plot.
- Density panels use identical color limits. The information legend communicates whether the field is pointwise bits with clipping/fading or weighted contribution density with a dynamic symmetric scale.
- Toggling `weighted` does not move any heatmap or attached profile frame vertically.
- No curve, label, legend, or control is clipped on desktop or narrow mobile layouts.
- Production build runs as a static site with no runtime server/API dependency.

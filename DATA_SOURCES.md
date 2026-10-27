# Data sources

## Adult height and weight

The **Height vs Weight** family is derived from the U.S. Centers for Disease Control and Prevention, National Center for Health Statistics, National Health and Nutrition Examination Survey (NHANES) 2017–2018 public-use files.

Official source files and documentation:

- [Body Measures (BMX_J) documentation](https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/BMX_J.htm) and [XPT data](https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/BMX_J.XPT)
- [Demographic Variables and Sample Weights (DEMO_J) documentation](https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/DEMO_J.htm) and [XPT data](https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/DEMO_J.XPT)
- [NHANES analytic guidelines](https://wwwn.cdc.gov/nchs/nhanes/analyticguidelines.aspx)

The body-measures documentation states that trained health technicians measured standing height and weight in a Mobile Examination Center. It also directs analysts to use NHANES examination sample weights. The demographics documentation identifies `WTMEC2YR` as the 2017–2018 two-year examination weight.

### Variables and cohort

The two files are joined one-to-one using the public respondent key `SEQN`. The derived cohort keeps records satisfying all of the following:

- `RIDAGEYR >= 20` (adult at screening);
- nonmissing measured standing height `BMXHT` in centimeters;
- nonmissing measured weight `BMXWT` in kilograms;
- positive, nonmissing MEC examination weight `WTMEC2YR`; and
- not identified as pregnant (`RIDEXPRG != 1`).

This produces 5,120 adults after excluding 55 known pregnancies. Pregnancy status is publicly reported only for women aged 20–44, so this filter can only use the status released by NCHS. The visualization is descriptive and is not a clinical reference.

### Transformation used by the explorer

Each retained record contributes its normalized `WTMEC2YR` survey weight to a 128 × 160 height–weight histogram. The source histogram spans 124–212 cm and 20–275 kg, containing every retained measurement and padding for the kernel tails. The browser smooths that histogram with a separable Gaussian kernel. At the default smoothing setting, the kernel standard deviations are 2.4 cm in height and 5.5 kg in weight. The smoothing slider scales both bandwidths together from 0.25 to 1.6; at its minimum the bandwidths are 0.60 cm and 1.38 kg, revealing distinct clouds around isolated occupied bins.

The generated asset records the raw survey-weighted marginal 0.5th–99.5th percentiles—145.1–192.8 cm for height and 44.7–164.2 kg for weight—as transformation checks. At runtime, all panels use the corresponding 0.5th–99.5th percentiles of the currently smoothed density, converted to feet–inches and pounds. The complete 124–212 cm by 20–275 kg histogram domain is normalized and used for MI, conditional densities, and KL divergence; clipping affects only what is drawn.

The weighted cohort means are 167.911 cm and 84.347 kg; the weighted Pearson correlation is 0.448. These are transformation checks, not population estimates with design-based confidence intervals. The explorer uses weights for density estimation but does not perform the stratified/clustered variance estimation required for formal NHANES inference.

The generated histogram contains no participant identifiers. It is stored as little-endian Float32 bin masses in `src/data/nhanesHeightWeight.ts`. The original XPT files are intentionally not checked into the repository.

### Rebuilding the derived asset

Download `BMX_J.XPT` and `DEMO_J.XPT` from the official pages above, install Python with pandas and NumPy, then run:

```sh
python3 scripts/prepare_nhanes_height_weight.py \
  BMX_J.XPT DEMO_J.XPT src/data/nhanesHeightWeight.ts
```

The generated module records SHA-256 checksums for both source files, along with the cohort size and validation statistics. This makes it possible to verify that a rebuilt asset used the same CDC releases.

## Niño 3.4 and Southern Oscillation Index

The **Niño 3.4 vs SOI** family is derived from monthly index files published by the NOAA Physical Sciences Laboratory (PSL):

- [NOAA PSL monthly climate/ocean index collection](https://psl.noaa.gov/data/timeseries/month/)
- [Niño 3.4 description and downloads](https://psl.noaa.gov/data/timeseries/month/Nino34/) and [standard-format data](https://psl.noaa.gov/data/timeseries/month/data/nino34.long.anom.data)
- [Southern Oscillation Index description and downloads](https://psl.noaa.gov/data/timeseries/month/SOI/) and [standard-format data](https://psl.noaa.gov/data/timeseries/month/data/soi.long.data)

NOAA defines this Niño 3.4 series as the HadISST1.1 sea-surface-temperature anomaly averaged over 5°N–5°S, 170°W–120°W, relative to the 1981–2010 climatology; its units are degrees Celsius. The SOI series is the standardized Tahiti–Darwin pressure difference supplied by the Climatic Research Unit and based on the method of Ropelewski and Jones (1987). These are physically distinct ocean and atmosphere measurements.

### Alignment and transformation

The preparation script reads NOAA's year-by-month text tables, treats the documented `-99.99` sentinel as missing, and retains months with valid values in both files. The generated asset contains 1,867 contiguous monthly pairs from January 1870 through July 2025. At zero lag, the raw Pearson correlation is −0.579, which provides a transformation check and explains the negatively sloped cloud.

The aligned values are stored as two little-endian Float32 arrays in `src/data/noaaEnso.ts`. For a selected integer lag `τ`, the browser pairs

```text
X = Niño 3.4(t),    Y = SOI(t + τ).
```

Thus positive `τ` means a later SOI value, negative `τ` means an earlier SOI value, and the available pair count is `1867 − |τ|`. The slider spans −12 to +12 months.

Each lagged sample is deposited in a 128 × 128 histogram and smoothed with a separable Gaussian kernel whose fixed standard deviations are 0.18 °C for Niño 3.4 and 0.24 standardized SOI units. The generated asset records the raw full-series marginal 0.5th–99.5th percentiles (−1.874–2.320 °C and −3.220–2.847 SOI) as checks. At runtime, all panels show the 0.5th–99.5th percentiles of the KDE for the selected lag. The full padded histogram domain remains in normalization and every information calculation. The density and every information quantity are recomputed deterministically when the lag changes.

The source files used for the checked-in derived asset have these SHA-256 checksums:

```text
nino34.long.anom.data  46e501b91f624ef85b525d73fbb427f9d04d30411ba6e5c7cff579b35fb4ff01
soi.long.data          496cfd97caf2bb1750cc2ade93fdff894a760ad79f7fba2374084e67fa750513
```

### Interpretation limits

Adjacent monthly observations are serially correlated, so 1,867 pairs do not represent 1,867 independent realizations; the effective sample size is smaller and depends on lag and the estimand. The explorer visualizes a smoothed empirical distribution and does not provide sampling uncertainty or an effective-sample-size correction. Long-term changes in observations and climate may also make a single stationary density an approximation.

Lagged mutual information is symmetric with respect to the paired variables and measures statistical association. A peak at a positive or negative lag does not by itself establish causal direction: common drivers, persistence, seasonal processing, and the broad duration of ENSO events can all produce lagged dependence.

### Rebuilding the derived asset

Download the two NOAA standard-format files linked above, install Python with NumPy, then run:

```sh
python3 scripts/prepare_noaa_enso.py \
  nino34.long.anom.data soi.long.data src/data/noaaEnso.ts
```

The generated module records both source checksums, the common date span, summary statistics, percentile limits, and the packed aligned series. The original NOAA text files are intentionally not checked into the repository.

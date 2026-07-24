---
raw: "../../raw/physionet-cinc-2019-raw.md"
type: source-note
authority: moderate
---

# PhysioNet/CinC Challenge 2019 (Early Sepsis Prediction)

**What it is.** A public early-warning benchmark and de-identified ICU dataset for predicting sepsis
onset hour-by-hour from routine vitals and labs. Records come from three US hospital systems. See
[[physionet-cinc-2019-raw]] for the full column list, labelling rule, and metric.

**Authority.** Moderate. A widely-used challenge dataset with a peer-reviewed summary, but **not** a
clinical guideline and **setting-specific** (three US ICUs). It supports *methodological* and
*feasibility* claims, not clinical thresholds.

**Key claims it supports.**
- Early prediction of sepsis **hours before onset** is feasible from routinely-collected vitals and
  labs, with no waveform. → [[early-sepsis-ml-model]], [[why-early-detection-is-possible]]
- A defensible **time-zero** for an adult sepsis model exists (the Sepsis-3 utilization proxy, with
  the label shifted 6 h before onset). → [[early-sepsis-ml-model]]
- The data are **sparse and irregular** (most lab cells missing at a given hour), so a usable model
  must be missingness-tolerant. → [[early-sepsis-ml-model]]

**Limitations.** The label is a **proxy** for Sepsis-3 and inherits its biases; the cohort is three
US ICUs, so performance **must be revalidated** before use elsewhere ([[generalisation-and-setting]]);
adult-only (nothing for the [[nicu-sepsis-gap]]). The data are licensed and **never enter this repo**.

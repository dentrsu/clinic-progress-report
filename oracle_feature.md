# Oracle Analytics: A Complete Methodological Guide

> **Who is this for?** Students, instructors, and administrators who want to understand _exactly_ how the Oracle calculates scores, forecasts, and recommendations — and where its limitations lie.

---

## Overview: What is the Oracle?

The **Oracle** is a heuristic analytics engine built into the Clinic Progress tracker. It continuously monitors a student's treatment record activity and uses **rule-based math** (not machine learning) to answer three questions:

1. **Where are you now?** → Progress Score (0–100)
2. **How fast are you moving?** → 30-Day Velocity
3. **When will you finish?** → Estimated Completion Date

A "heuristic" model means it uses **simplified, human-interpretable rules** derived from domain knowledge — not statistical training data. Think of it as an experienced advisor following a structured checklist, not an AI.

---

## Part 1: Progress Score (0–100)

### What it measures

The **verified completion percentage** — what fraction of your total required RSU + CDA units have been successfully verified by an instructor.

### The Formula

```
progress_score = round(verified_completion_pct × 100)

verified_completion_pct =
  (sum of RSU + CDA on all VERIFIED records)
  ÷
  (sum of minimum_rsu + minimum_cda across ALL requirements)
```

### Why it works this way

- Only **verified** records count. "Pending verification" and "completed" records are excluded from the score because they haven't been officially confirmed yet.
- This gives a **conservative, trustworthy** number — it represents locked-in, auditable progress.

### Caution

> [!WARNING]
> The denominator includes **every requirement in the system**, not just the ones that apply to this student's current division. This is an MVP-era simplification. Students who are only doing work in one division will see a lower score than expected.

---

## Part 2: Verified Velocity (30-Day)

### What it measures

How many RSU units (specifically `rsu_units`) were verified within **the last 4 weeks** and **the last 8 weeks**.

### The Formula

```
v_verified_4w = SUM(rsu_units) WHERE status='verified'
                AND verified_at >= NOW() - 4 weeks

v_verified_8w = SUM(rsu_units) WHERE status='verified'
                AND verified_at >= NOW() - 8 weeks
```

The **displayed 30-day velocity** shown on the dashboard (`velocity_30d`) is directly mapped from `v_verified_4w`.

### Why `verified_at` — not `created_at`?

A student may create a record (submit a case) months before it gets verified. Using `created_at` would attribute that progress to the past, making the velocity appear zero even if recent verifications happened. Using `verified_at` correctly attributes progress to the moment it was **confirmed as real, locked-in progress**.

### Why two windows (4w and 8w)?

- **4 weeks** is more sensitive — it reflects what's happening _right now_.
- **8 weeks** is more stable — it smooths out a single burst of activity.

Both are measured to give the forecast a stable base (see Part 3).

### Caution

> [!WARNING]
> Velocity is based on RSU units only, not CDA units. Students in divisions where CDA is the primary metric may see their velocity underrepresented.

> [!NOTE]
> Velocity resets toward zero if no verifications happen. A student who worked hard for 2 months but then paused will see their velocity declining week-over-week, which is intentional — it reflects current momentum, not historical achievement.

---

## Part 3: Estimated Completion Date (Forecast)

### How it thinks

The Oracle asks: _"If you keep moving at your current verified speed, when will you reach 100%?"_

### The Formula (Step by Step)

**Step 1 — Determine the best available monthly velocity:**

```
v_monthly_velocity = GREATEST(
  v_verified_8w / 2.0,   -- 8-week total ÷ 2 = avg monthly rate (more stable)
  v_verified_4w,         -- 4-week total = direct monthly rate (more current)
  0                      -- floor at zero (never negative)
)
```

The model uses **whichever is larger**: the 8-week annualised average or the 4-week rate. This prevents the forecast from collapsing to zero just because there was a slow stretch in week 5–8.

**Step 2 — Calculate remaining work as a percentage:**

```
remaining_pct = 1 - verified_completion_pct
```

**Step 3 — Estimate months remaining:**

```
v_months_remaining = CEIL( (remaining_pct × 100) / v_monthly_velocity )
```

The `× 100` converts the velocity from "raw RSU units" to a comparable "percentage points per month" scale for the calculation.

**Step 4 — Project the date:**

```
v_forecast_month = date_trunc('month', TODAY + v_months_remaining MONTHS)
```

### Example Walkthrough

Given this student's data:

- Progress: **18%** verified
- 4-week velocity: **21.25 RSU units/month**
- 8-week velocity: **~0** (no verifications in weeks 5–8)

```
v_monthly_velocity = GREATEST(0/2, 21.25, 0) = 21.25
remaining_pct      = 1 - 0.18 = 0.82
months_remaining   = CEIL((0.82 × 100) / 21.25) = CEIL(82/21.25) = CEIL(3.86) = 4
forecast_date      = March 2026 + 4 months = July 2026
```

This matches the displayed date of **1/7/2569** (July 1, 2026 BE).

### Why this is a heuristic, not a prediction

The model **assumes velocity is constant**. In reality:

- Students work in bursts before deadlines.
- Some requirements take longer than others.
- Instructor availability affects verification speed.

The model doesn't know any of this. It linearly projects the current momentum forward.

### Cautions

> [!CAUTION]
> If no records have been verified in the last 4 or 8 weeks, `v_monthly_velocity = 0`, and the system **cannot generate a forecast**. The display will show "Analyzing..." This is by design — a forecast with zero velocity would extrapolate to infinity, which is meaningless.

> [!WARNING]
> The forecast assumes the student maintains **exactly the same rate** of verified work. A sudden pause (illness, exams) will cause the forecast date to shift forward significantly on the next recalculation.

> [!NOTE]
> The forecast recalculates every time a treatment record is created, updated, or verified. It is not a static projection — it updates in near real-time.

---

## Part 4: Risk Level (Green / Yellow / Orange / Red)

### What it measures

The **Risk Score** is a 0–100 penalty system. The higher the score, the higher the risk. The score determines the color level.

### Penalty Rules

| Condition                             | Penalty                 | Why                                                    |
| ------------------------------------- | ----------------------- | ------------------------------------------------------ |
| No activity for ≥30 days              | **+25 pts**             | Inactivity is an early warning sign for falling behind |
| No activity for ≥60 days              | **+15 pts** (+40 total) | Prolonged inactivity requires urgent intervention      |
| ≥10 records pending verification      | **+15 pts**             | Backlog means progress isn't being locked in           |
| Zero verified velocity (8w)           | **+25 pts**             | No momentum means the forecast cannot even run         |
| Within 90 days of graduation deadline | **+20 pts**             | Time pressure compounds all other risks                |

### Risk Level Thresholds

| Score  | Level                     | Meaning                                             |
| ------ | ------------------------- | --------------------------------------------------- |
| 0–24   | 🟢 **Green (On Track)**   | Progress is healthy, no significant risks detected  |
| 25–49  | 🟡 **Yellow (At Risk)**   | One factor needing attention                        |
| 50–74  | 🟠 **Orange (High Risk)** | Multiple factors — intervention likely needed       |
| 75–100 | 🔴 **Red (Critical)**     | Immediate action required to avoid graduation delay |

### Why additive penalties?

Each risk factor is **independent** — multiple risks compound. A student who is inactive _and_ near graduation _and_ has zero velocity hits 25+20+25 = 70 points (Orange) from just those three factors. This is intentional: the system escalates faster when multiple signals align.

### Caution

> [!NOTE]
> Risk level reflects **current state only**. A student who has been at "Red" for 2 months but just had a burst of verifications will immediately drop to "Green" on the next refresh. There is no memory of historical risk.

---

## Part 5: Explanations & Recommendations

### How explanations are generated

After computing each metric, the Oracle deletes all prior explanation records for that student and inserts fresh ones. Only **triggered** factors appear — if you have no backlog, the `PENDING_VERIFICATION_BACKLOG` explanation will not appear.

| Factor Code                    | Trigger Condition     | Display Label                                    |
| ------------------------------ | --------------------- | ------------------------------------------------ |
| `INACTIVE_30D`                 | `inactive_days >= 30` | No recorded progress in the last 30 days         |
| `PENDING_VERIFICATION_BACKLOG` | `pending_count >= 10` | High number of pending verifications             |
| `LOW_VERIFIED_VELOCITY_8W`     | `v_verified_8w <= 0`  | Low verified completion velocity in last 8 weeks |

### How recommendations are generated

Recommendations are prioritized actions based on detected risks:

| Priority | Type                         | Trigger             | Message                                                           |
| -------- | ---------------------------- | ------------------- | ----------------------------------------------------------------- |
| 1        | `CLEAR_PENDING_VERIFICATION` | Any pending records | "Prioritize getting completed work verified to lock in progress." |
| 2        | `RESUME_ACTIVITY`            | Inactivity ≥30 days | "Plan and start 1–2 cases this week to restore momentum."         |

---

## Part 6: Overall Cautions & Known Limitations

> [!CAUTION]
> **The Oracle does not know about individual student circumstances.** Medical leave, clinic closures, public holidays, and exam periods are not factored in. The model will show declining metrics during any pause period regardless of the reason.

> [!WARNING]
> **Progress Score uses system-wide requirements as the denominator.** If not all requirements have minimum RSU/CDA values set, the denominator may be underestimated, inflating the score.

> [!WARNING]
> **Velocity excludes CDA units.** Students in CDA-heavy divisions see lower velocity figures. A future enhancement should weight RSU + CDA proportionally.

> [!NOTE]
> **All calculations are re-run from scratch on each refresh.** There is no historical trend line, weighted average, or seasonal adjustment. The model is a precise snapshot of the current moment.

> [!IMPORTANT]
> **This model is a decision-support tool, not a definitive academic assessment.** A "Red" status does not mean a student will fail. A "Green" status does not guarantee graduation on time. Instructors and advisors should use this as a conversation starting point, not a final judgment.

---

## Summary: When to Trust It, When to Be Cautious

| Situation                                | Trust Level | Why                                                      |
| ---------------------------------------- | ----------- | -------------------------------------------------------- |
| Active student, consistent verifications | ✅ High     | Velocity is stable, forecast is meaningful               |
| First few weeks with only 1–2 records    | ⚠️ Low      | Too little data; forecast is a rough estimate            |
| Student returning after a long pause     | ⚠️ Medium   | Velocity will be zero until new verifications accumulate |
| CDA-heavy division                       | ⚠️ Low      | RSU-only velocity undercounts real progress              |
| Near graduation deadline                 | ✅ High     | Risk score and deadline logic are accurate               |

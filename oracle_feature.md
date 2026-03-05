# Oracle Analytics: How It Works

The Oracle is the "intelligence engine" of the Clinic Progress Report system. It uses a mathematical model to analyze current student progress and predict future success.

## 1. The Core Calculation (Velocity)

The Oracle looks at **Velocity**: how many RSU/CDA units have been successfully verified in the last **4 weeks** and **8 weeks**. This "speed" is used to project the path forward.

## 2. The Risk Score (0–100)

The **Risk Level** (Green, Yellow, Orange, Red) is determined by a penalty-based scoring system:

- **Inactivity (-25 to -40 pts):** No recorded patient progress in 30 or 60 days.
- **Backlog (-15 pts):** More than 10 records waiting for verification (pending). Unverified progress isn't "locked in."
- **Zero Momentum (-25 pts):** No units verified in the last 8 weeks.
- **Deadline Proximity (-20 pts):** Within 90 days of the graduation deadline.

## 3. The Forecast (Completion Date)

The Oracle takes **Remaining Requirements** and divides them by **Verified Velocity**.

- High speed translates to a closer "Est. Completion" date.
- Low or zero speed results in "Analyzing..." or a significantly delayed date.

## 4. Explanations & Bottlenecks

The Oracle identifies the **biggest bottleneck**—usually the factor contributing the highest penalty (e.g., "Low verified velocity in last 8 weeks").

## 5. Recommended Actions

Based on detected risks, the Oracle provides prioritized actions:

- **Backlog detected:** "Prioritize getting completed work verified."
- **Inactivity detected:** "Plan and start 1–2 cases this week to restore momentum."

---

**Summary:** The Oracle rewards consistent, verified progress and identifies risks early to prevent graduation delays.

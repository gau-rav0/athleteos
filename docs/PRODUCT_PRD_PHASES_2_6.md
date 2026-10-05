# AthleteOS Product PRD — Phases 2–6

Status: Product roadmap after Phase 1 sync reliability gate

## Product thesis

AthleteOS turns Samsung Health / Galaxy Watch data into an explainable personal performance system. Samsung Health is the sensor and collection layer. AthleteOS is the interpretation and decision layer.

The product must answer three questions well:
1. Am I progressing?
2. Am I recovering?
3. What should I do today / tomorrow?

It must remain transparent. Every score must expose its inputs, baselines, confidence and missing-data state. Do not copy proprietary formulas from WHOOP, Garmin, Apple or BodyVault. Borrow the product concepts, interaction patterns and useful physiological framing, then implement open, testable logic.

## Non-negotiable principles

- Personal baselines over population norms where possible.
- No fake precision.
- No score if required inputs are missing.
- Show contributors, not only a number.
- Correlation is not causation.
- Wearable calorie estimates are noisy and must not be treated as exact energy expenditure.
- Strength sessions cannot be inferred accurately from wrist HR alone; label HR-based load as cardiovascular/session load.
- All calculations must be versioned and reproducible.
- Raw source data stays immutable; derived metrics are recalculable.
- Historical Samsung export already imported in Phase 1 must be merged into the same canonical timeline as future live sync. Never create a second disconnected history store.

---

# Data foundation carried forward from Phase 1

Phase 2 starts only after Phase 1 passes its 7-day reliability gate.

The canonical database must already contain historical and live data in one timeline, including as available:
- steps
- activity summary
- sleep sessions
- sleep stages
- heart rate
- HRV when genuinely available
- workouts / exercise
- weight
- body composition
- blood oxygen
- skin temperature
- respiratory-related sleep data when available
- floors
- calories / distance
- source-device provenance

Historical import rule:
- existing Samsung export is the historical seed
- live Samsung / Health Connect sync becomes the forward source
- overlapping periods are reconciled, not duplicated
- records keep source IDs, provider, device, source timestamps and raw payload references

Derived metrics must never depend directly on one vendor-specific DTO. They read from canonical tables.

---

# PHASE 2 — Baselines, Recovery, Sleep, Readiness and Training Load

## Objective

Build the physiological intelligence layer that turns raw health data into explainable daily state.

## 2.1 Personal baseline engine

Create rolling baselines for:
- HRV
- resting HR / overnight HR
- sleep duration
- sleep midpoint / bedtime / wake time
- sleep consistency
- steps
- training load
- stress proxy when supported
- skin temperature
- respiratory rate
- SpO2

Preferred baseline design:
- short trend: 7 days
- medium trend: 28 days
- long personal baseline: 42–60 valid days
- robust statistics: median and MAD where useful
- minimum sample thresholds before a metric is labelled stable

Each derived metric includes:
- value
- baseline value
- deviation
- sample count
- confidence state
- algorithm_version

Confidence states:
- INSUFFICIENT_DATA
- LOW
- MODERATE
- HIGH

## 2.2 Sleep engine

Outputs:
- total sleep time
- time in bed
- sleep efficiency when supportable
- bedtime
- wake time
- midpoint
- bedtime variability
- wake-time variability
- 7-day consistency
- sleep debt versus configured target
- stage breakdown when data quality supports it
- nap detection where available
- sleep quality contributors

Avoid over-weighting consumer sleep stages. Stage data is useful context, not a clinical truth source.

Sleep day = date of waking for dashboard aggregation.

## 2.3 HRV status

If genuine RMSSD is available:
- normalize against personal baseline
- consider log transform for analysis
- calculate 7-day central tendency
- compare against 42–60 day baseline
- classify: BELOW_BASELINE / NORMAL / ABOVE_BASELINE / INSUFFICIENT_DATA

If RMSSD is not available:
- do not relabel Samsung proprietary values as RMSSD
- use Samsung-derived score only under its original name
- clearly label source and semantics

## 2.4 Resting / overnight HR status

Calculate:
- nightly central tendency
- 7-day rolling average
- long baseline
- deviation from baseline

Flag meaningful upward deviations only after enough history exists.

## 2.5 Training load engine

Borrow the useful concepts from Apple and Garmin without copying proprietary math.

Cardio/session load hierarchy:
1. TRIMP-like HR-based load if valid HR samples exist
2. duration × intensity estimate if HR is incomplete
3. session-RPE only if user later chooses to provide it

Store:
- session load
- daily load
- 7-day rolling acute load
- 28-day rolling baseline / chronic load
- relative load classification
- load monotony
- weekly strain

Apple-style comparison:
- compare last 7 days to previous / rolling 28-day baseline
- classify WELL_BELOW / BELOW / STEADY / ABOVE / WELL_ABOVE

Garmin-style concepts to emulate conceptually:
- acute load
- recovery time concept
- training status
- load distribution when enough workout-type data exists

Do not claim ACWR predicts injury. If shown, it is a context metric only.

## 2.6 Recovery / readiness engine

Create two layers:

### Morning Readiness
Inputs may include:
- HRV status
- resting HR deviation
- sleep quantity
- sleep consistency
- sleep debt
- recent training load
- recent stress proxy
- optional temperature / respiratory anomaly inputs

### Current Readiness
Morning score plus same-day changes such as:
- completed workout load
- unusually high activity
- nap
- prolonged inactivity / stress proxy if supported

Use weighted normalized contributors, but expose every contribution.

Example output:
- readiness_score: 0–100
- readiness_band: POOR / LOW / MODERATE / HIGH / PRIME
- confidence
- top_positive_contributors
- top_negative_contributors
- explanation

Do not calculate a score if the model lacks the required minimum inputs.

## 2.7 Recovery ledger

For each day, show why readiness moved:
- sleep contribution
- HRV contribution
- RHR contribution
- training-load contribution
- stress contribution
- nap contribution
- anomaly contribution

This is strongly inspired by the transparent contribution-ledger idea used in products such as BodyVault.

## 2.8 Training status

Initial states:
- NO_STATUS
- DETRAINING
- RECOVERING
- MAINTAINING
- PRODUCTIVE
- HIGH_LOAD
- STRAINED

Rules must use multi-day trend, not one-day reactions.

## 2.9 Today recommendation

Deterministic rule engine first, LLM later.

Outputs:
- TRAIN_HARD
- TRAIN_NORMAL
- TRAIN_EASY
- RECOVERY_ONLY

Also produce a plain-English rationale.

Example:
“Normal lower-body session is reasonable. Sleep was adequate and HRV is within baseline, but recent load is moderately elevated, so avoid adding extra conditioning.”

No diagnosis or medical claims.

## Phase 2 screens

TODAY
- Readiness
- Today recommendation
- contributor ledger
- sleep summary
- current load
- steps
- weight trend teaser

RECOVER
- HRV
- RHR
- sleep
- stress / recovery context
- vitals deviations

TRAIN
- session history
- acute load
- 28-day baseline
- relative load
- status

## Phase 2 Definition of Done

- at least 30 days historical daily canonical data recalculated successfully
- 60-day baseline when history permits
- scores are deterministic and versioned
- every score has contributor breakdown
- insufficient data produces explicit missing state
- historical imported days and live-sync days behave identically in analytics
- unit tests for baseline, load and readiness calculations

---

# PHASE 3 — Real AthleteOS Dashboard and Progress / Cut Intelligence

## Objective

Replace V0 with the polished daily product.

## Core navigation

Keep the product small:
1. Today
2. Train
3. Recover
4. Progress
5. Insights

Do not add navigation items merely because data exists.

## 3.1 Today

Top section:
- readiness score + band
- short recommendation
- confidence

Contributor strip:
- HRV
- Sleep
- RHR
- Load
- Stress / anomaly

Secondary cards:
- sleep
- 7d load vs 28d baseline
- steps
- weight trend
- planned workout

Every card opens a drill-down.

## 3.2 Progress / Cut intelligence

Primary cut metrics:
- latest weight
- 7-day EMA / rolling median
- 30-day trend
- weekly kg change
- weekly % bodyweight change
- target-rate band configurable by user

Performance retention:
- PR / benchmark trend
- workout frequency
- cardio performance trend
- running pace / HR relation where data exists

Interpretation rule:
“Weight falling + performance retained + recovery acceptable = cut progressing well.”

Do not use wearable calorie burn as exact deficit.

Optional derived estimate:
- trend-implied energy balance from body-mass trend
- clearly marked rough estimate
- never presented as measured TDEE

## 3.3 PR / benchmark log

User explicitly does not want sets/reps logging.

Manual logging stays minimal:
- exercise
- benchmark value
- unit
- date
- optional note

Examples:
- bench top set
- squat top set
- deadlift top set
- pull-ups
- 5K time
- jump / sprint benchmark later

## 3.4 Historical trend explorer

Available ranges:
- 7d
- 28d
- 90d
- 1y
- all

Overlay selected metrics where statistically sensible.

Do not overload charts with 12 axes.

## 3.5 Visual design

Dark-first, information dense, minimal.

Principles:
- large primary number only when actionable
- sparklines for context
- muted secondary data
- explicit data quality badges
- no decorative gauges without meaning
- trend arrows only when statistically/clinically useful

## Phase 3 Definition of Done

- responsive web dashboard
- historical and live data rendered from same API
- no hardcoded personal health values
- all missing-data states handled
- mobile-friendly
- drill-down explanations for every score

---

# PHASE 4 — Personal Insights, Journal and Reports

## Objective

Turn accumulated data into personal evidence instead of generic health tips.

## 4.1 Minimal journal

Keep friction tiny.

Optional tags such as:
- alcohol
- late meal
- late caffeine
- high stress
- travel
- illness
- sauna
- nap
- hard leg day
- meditation

User can configure up to a small number of active tags.

Do not build a diary platform.

## 4.2 Your Data Shows engine

For each candidate relationship:
- minimum n threshold (default >=30 valid observations)
- compare exposed vs unexposed days
- lag 0 / 1 / 2 days where relevant
- effect size
- confidence interval where practical
- sample count
- data coverage

Example:
“On nights with sleep >=7h30m, next-day HRV has been 8% higher across 46 comparable nights.”

Always show:
- association, not causation
- sample size
- confidence

Do not surface weak correlations as insights.

## 4.3 Automatic anomaly detection

Potential alerts:
- HRV significantly below baseline several days
- RHR significantly above baseline
- sleep debt accumulating
- load spike
- sudden step / activity collapse
- unusual temperature / respiratory pattern when supported

Avoid medical diagnosis.

## 4.4 Weekly Report

Sections:
- readiness average
- sleep
- HRV / RHR trend
- load
- workouts
- steps
- weight / cut
- PR / benchmark changes
- notable insight
- next-week suggestion

## 4.5 Monthly Report

Focus on progression rather than daily noise:
- weight trend
- consistency
- fitness / cardio trend
- training-load progression
- sleep consistency
- recovery resilience
- personal relationships discovered

## Phase 4 Definition of Done

- journal takes <10 seconds/day when used
- weak correlations suppressed
- reports reproduce exactly from database
- every claim links to underlying observations

---

# PHASE 5 — Training Plan Builder and Adaptive Programming

## Objective

Turn AthleteOS from analytics into an athlete-programming system.

## 5.1 Program model

Support blocks built from:
- strength
- hypertrophy
- conditioning
- running
- mobility
- ATG / knees-over-toes-style accessories
- Olympic-lift technique / power work
- Westside-inspired max-effort / dynamic-effort concepts where user chooses
- general athleticism

Do not claim one philosophy is universally optimal.

## 5.2 User constraints

Program inputs:
- days/week
- session duration
- equipment
- injury / movement exclusions
- current goals
- cut / maintenance / gain
- running goals
- priority lifts

## 5.3 Minimal logging philosophy

Do not require full set-by-set gym logging.

Automatic:
- session start/end
- duration
- HR
- cardio load

Manual optional:
- benchmark / top set
- session difficulty (one tap) if user later accepts it
- completed / skipped

## 5.4 Adaptive decision layer

Adaptations should be conservative.

Examples:
- low readiness one day -> reduce conditioning / volume, not rewrite program
- sustained low readiness + high load -> deload suggestion
- sustained high readiness + low load -> progression suggestion
- cut with falling performance + poor recovery -> reduce deficit/training stress suggestion, framed cautiously

## 5.5 Progression rules

Versioned deterministic rules for:
- session progression
- weekly volume progression
- conditioning progression
- run progression
- deload triggers

LLM may explain or help edit the plan, but must not be the sole controller.

## Phase 5 Definition of Done

- user can create / edit a training week
- plan references current recovery/load state
- adaptation decisions are logged with reason
- no forced detailed set logging

---

# PHASE 6 — AthleteOS Coach

## Objective

Natural-language interface over trusted AthleteOS computations.

## 6.1 Coach responsibilities

Allowed:
- explain today’s readiness
- summarize last week
- compare training blocks
- answer “should I train hard today?” using deterministic metrics
- explain weight / recovery trends
- suggest program adjustments subject to rules

Not allowed:
- invent missing metrics
- diagnose disease
- override safety gates
- pretend correlation is causal

## 6.2 Tool-first architecture

LLM receives structured tools such as:
- get_today_state
- get_readiness_contributors
- get_training_load
- get_sleep_trend
- get_weight_trend
- get_recent_workouts
- get_personal_insights
- get_plan

The LLM never calculates core physiology from raw JSON itself when a validated analytics service exists.

## 6.3 Explanations

Answer format:
1. recommendation
2. 2–4 strongest reasons
3. uncertainty / missing data
4. optional adjustment

## Phase 6 Definition of Done

- coach answers are grounded in tool outputs
- numerical claims trace to database records / derived metrics
- hallucination tests
- safety rules for medical / injury language

---

# Product-level data model additions after Phase 1

Suggested derived tables:
- daily_metrics
- sleep_daily
- recovery_daily
- readiness_daily
- training_sessions
- training_load_daily
- body_weight_daily
- benchmark_events
- journal_events
- personal_insights
- weekly_reports
- monthly_reports
- training_plans
- training_plan_sessions
- algorithm_versions

Every derived row should include algorithm_version where relevant.

---

# Algorithms and transparency contract

For every derived score:
- formula lives in source control
- version is stored with result
- inputs are queryable
- baseline window is explicit
- sample threshold is explicit
- missing input behavior is explicit
- unit tests cover edge cases

No proprietary-vendor score should be reverse-engineered and presented as an exact clone.

---

# Source-inspired product concepts

BodyVault concepts to borrow conceptually:
- personal baseline framing
- readiness contribution ledger
- “your data shows” personal relationships
- reporting and behavior-to-biomarker interpretation
- action-oriented daily state

WHOOP concepts to borrow conceptually:
- recovery + strain + sleep as one system
- journal-tag relationships
- personal baseline rather than static population targets

Garmin concepts to borrow conceptually:
- continuously updated training readiness
- acute load
- training status
- recovery time concept
- HRV status
- multi-day sleep / stress context

Apple concepts to borrow conceptually:
- simple 7-day versus 28-day training-load framing
- clean trend UX
- overnight vitals deviations

None of the above implies copying source code, proprietary coefficients, branding or protected assets.

---

# Global acceptance criteria

AthleteOS is not considered “good” merely because it renders many metrics.

It is good when:
- it automatically captures data
- old and new history are continuous
- it explains its calculations
- it distinguishes missing versus normal
- it reduces decision fatigue
- it helps training decisions without pretending to be a doctor
- the user can understand the reason behind every important recommendation

Final product statement:

Samsung collects the body. AthleteOS interprets it. AthleteOS tells the user what matters and what to do next.

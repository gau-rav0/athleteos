# Codex execution contract after Phase 1

Do not start this roadmap until Phase 1 sync passes its 7-day reliability gate.

Read:
- `docs/PHASE1_PRD.md`
- `docs/PRODUCT_PRD_PHASES_2_6.md`

## Historical continuity requirement

The historical Samsung export already imported during Phase 1 is part of the permanent AthleteOS timeline.

Before Phase 2 work:
1. verify imported historical records and live-sync records share the same canonical schema
2. reconcile overlapping dates
3. preserve provenance
4. ensure derived analytics query both historical and live records identically
5. never create a separate “old data dashboard”
6. never hardcode values from the export into application code

## Git workflow

Work in milestone-sized commits.

Suggested commits:
- `feat: add personal baseline engine`
- `feat: add sleep and recovery metrics`
- `feat: add training load engine`
- `feat: add explainable readiness engine`
- `feat: build AthleteOS daily dashboard`
- `feat: add cut and progress intelligence`
- `feat: add personal insights engine`
- `feat: add weekly and monthly reports`
- `feat: add training plan model`
- `feat: add adaptive training rules`
- `feat: add grounded AthleteOS coach`

Before each push:
- run tests
- inspect staged diff
- verify no health exports, secrets, SDK binaries or personal raw values are committed
- document migrations

Push completed milestone commits to the existing repository:
`gau-rav0/athleteos`

Do not create a new repository.

## Phase gates

### Gate A — Phase 1 reliability
Must pass before Phase 2:
- automatic sync
- no unexplained missing days
- no duplicate records
- update reconciliation works
- offline recovery works
- historical overlap reconciled

### Gate B — Analytics validation
Must pass before UI polish:
- baseline calculations tested
- readiness contributors reproducible
- missing-data logic tested
- training-load calculations tested
- algorithm versions persisted

### Gate C — Product UI
Must pass before Insights:
- Today / Train / Recover / Progress views use real canonical data
- no fake placeholders
- drill-down explanations work

### Gate D — Insights
Must pass before Coach:
- sample-size thresholds enforced
- weak correlations suppressed
- insight claims link to source observations

### Gate E — Coach
Coach only launches after deterministic analytics and training rules are stable.

## Product constraint

Do not turn the roadmap into a feature-count competition. Prefer fewer high-signal metrics and explainability over dozens of decorative cards.

At the end of every milestone, output:
1. files changed
2. migrations added
3. tests run and results
4. remaining blockers
5. manual device verification needed
6. commit SHA
7. push result

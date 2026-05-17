# Issue #22 — Responsive auto-layout v2: working notes

Scratch document capturing where a grilling session landed before
restarting. Not authoritative. The GitHub issue and DESIGN.md §7.1 remain
the sources of truth until this is promoted into them.

## Goal

Replace today's single-threshold sidebar collapse with a layout model that
separates **sidebar visibility** from **sidebar width**, gives the user a
clear way to reach the sidebar on a narrow viewport, and runs all
visibility/width math through one helper so render code and key handlers
can't disagree.

## Today (for reference)

- Sidebar width: `clamp(28, floor(viewportWidth * 0.25), 60)` — continuous.
- Sidebar visibility: stored boolean `sidebarVisible`. Toggled by `s`.
  Filter (`/`) force-shows the sidebar and snapshots prior visibility for
  restore on Esc.
- The `<80 cols → collapse` rule in DESIGN.md §7.1 is documented but the
  current code doesn't actually re-evaluate on resize; it's effectively a
  startup-only behavior. Verify against the code before locking the new
  model in.
- `[` / `]` walk `BrowserCtx.files`, which is wired to `displayedFiles`
  (the filtered list). So when a filter is applied and the sidebar is
  hidden, bracket navigation walks the filtered set with no UI cue. This
  is a **pre-existing** discoverability gap, not a v2-induced one.

## The model we converged on

Two pieces of state, two pure functions, no runtime "modes."

### State

- `shown: boolean` — user's explicit preference. Mutated only by `s` and
  by the launch flag.
- `focus: "sidebar" | "reader"` — already exists.

### Visibility

```
visible = shown || focus === "sidebar"
```

That is the entire visibility rule.

### Rendering

- `shown === true` → sidebar renders **inline** (pushes the reader).
- `shown === false && focus === "sidebar"` → sidebar renders as a
  **drawer** (absolute-positioned overlay on the left, painting over the
  reader; opentui supports this — `HelpOverlay.tsx` already uses the same
  primitive).

A drawer exists *because the sidebar has focus while not shown*. Focus
leaves → drawer disappears. There is no separate "close" operation; the
drawer's lifecycle is the focus state.

### Width

Pure function of viewport. Decoupled from visibility:

```
resolveSidebarWidth(viewport, preferred) =
  clamp(preferred, SIDEBAR_MIN, viewport - DIVIDER - READER_MIN)
```

Same formula for inline and drawer. Until persistent config (#13) lands,
`preferred` is derived from viewport (matching today: `floor(width * 0.25)`
clamped to `[28, 60]`).

### Launch

`--sidebar=auto|on|off` (default `auto`) initialises `shown`:

- `auto` — consult the viewport bucket *once*: `roomy` / `comfortable`
  start `shown=true`, `tight` starts `shown=false`. Buckets are launch-
  only; they are not consulted again.
- `on` — `shown=true`. Honored even on a viewport too narrow to fit
  cleanly; reader gets whatever space is left.
- `off` — `shown=false`. Sidebar still reachable on demand by focusing it
  (`/`, `tab`).

There is no runtime `--layout` mode and no mode-cycle key. The issue's
three modes (`auto`, `compact`, `full`) collapse into the three launch
values of `--sidebar`.

## What this model eliminates (vs the issue text)

| Issue concept | Status |
|---|---|
| Tristate `intent` (auto / force-shown / force-hidden) | not needed |
| Runtime mode cycle key (`--layout` at runtime) | not needed |
| Force-open override on tight | not needed — `s` does it; `/` does it via focus |
| Bucket auto-clear on resize | not needed — buckets are launch-only |
| `full` mode "fall back to hidden if too narrow" | not needed — `shown` is shown, period |
| Discrete bucket → width mapping | not needed — width is continuous |

## Concrete `s` behavior

| Current state | `s` pressed | Outcome |
|---|---|---|
| `shown=false`, focus=reader | toggle | `shown=true`, focus moves to sidebar, inline sidebar appears |
| `shown=true`, focus=reader | toggle | `shown=false`, sidebar disappears, focus stays in reader |
| `shown=true`, focus=sidebar | toggle | `shown=false` AND move focus to reader (otherwise the drawer would appear immediately — "hide" should hide) |
| `shown=false`, focus=sidebar (drawer up) | toggle | `shown=true`, drawer becomes inline; focus stays in sidebar |

## Concrete `/` filter behavior

The current filter code (Browser.tsx) does its own focus management and
snapshots `sidebarVisible` for Esc-restore. Under the new model, the
snapshot is unnecessary — focus leaving the sidebar already dismisses any
drawer. The filter just needs to take focus.

| Starting state | `/` opens | Esc | Return (match) | Return (no match) |
|---|---|---|---|---|
| `shown=false`, focus=reader | drawer appears (focus moves to sidebar/filter row) | focus back to reader → drawer goes | file opens in reader → focus moves to reader → drawer goes | treat as Esc |
| `shown=true`, focus=reader | inline sidebar already there; focus moves to filter row | focus back to reader; sidebar stays inline | file opens; focus moves to reader; sidebar stays inline | treat as Esc |

The "filter row inside sidebar" pattern is preserved unchanged from
DESIGN.md §7.2. Whether the sidebar is inline or drawer, the filter row
lives in it.

## Remaining open questions

### Q1. Filter-applied + sidebar-hidden discoverability

**This is the one decision still owed.** A user types `/ readme`, picks
`README.md`, the drawer (or sidebar) goes away, they read for ten minutes,
then press `]`. They get the next file in the *filtered* set with no UI
cue that filter is still active. Pre-existing in today's code; inherited
unchanged by the new model.

Three options, ranked by my preference:

1. **Footer chip when filter is applied** — persistent affordance in
   the footer's hint row, e.g. `filter: readme · esc to clear`. Costs
   ~20 cols of footer real estate while filter is applied. Surfaces an
   invariant the user can otherwise only discover by trying something.
   The footer chrome (#36, shipped) has the slot for this.
2. **Accept and document** — help overlay mentions the rule. Cheapest;
   admits the rough edge.
3. **Losing the sidebar clears the filter** — symmetric and
   discoverable, but kills the "filter then read with brackets" workflow
   which is genuinely useful.

### Q2. Responsive-resize regression

Locking visibility at launch means a user who opens house on a wide
terminal and then tiles it narrow keeps the sidebar inline (squeezing the
reader) until they `s`. Today the documented behavior is `<80 cols →
collapse`, though it may not be implemented. Question: do we want **any**
viewport-driven visibility change after launch, or is the rule strictly
"the user said `shown=true`, respect it"?

A middle ground worth considering: viewport changes never alter `shown`,
but when geometry can't fit `SIDEBAR_MIN + DIVIDER + READER_MIN`, the
sidebar silently renders as drawer instead of inline. `shown` stays
`true`; only the rendering swaps. The user's preference is preserved;
the reader stays readable. This adds one branch to the renderer but no
state.

### Q3. Preferred width source

Until #13 lands, `preferred` is derived from viewport. After #13, it
should be sourced from config. No real choice here, just a sequencing
note for the implementation.

## Test plan sketch

Three layers.

1. **`resolveSidebarWidth` unit tests** — pure function of `(viewport,
   preferred)`. ~5 cases covering: clamps to MIN, clamps to preferred,
   clamps against reader-min ceiling, very narrow viewport (formula
   returns < MIN — caller decides what to do).

2. **Visibility predicate tests** — `visible = shown || focus ===
   "sidebar"`. Trivial; one or two cases for documentation value.

3. **Integration tests** (boot TUI, send keys):
   - `s` in each of the four (shown, focus) combinations (table above).
   - `/` from `shown=false`, focus=reader: drawer appears, Esc dismisses
     it, Return picks a file and dismisses it.
   - `/` from `shown=true`: no drawer involved.
   - Filter survives a resize that crosses today's `<80 cols` boundary.
   - `--sidebar=auto|on|off` startup paths.
   - `--sidebar=on` on a too-narrow viewport: assert chosen geometry
     (depends on Q2).
   - `]` after filter commit walks the filtered set (existing behavior
     — regression test it before any work on Q1).

## What did **not** make the cut, and why

Recorded so future-me doesn't re-derive these.

- **Tristate intent.** Initially attractive (symmetric auto-clear, force-
  open generalized). Rejected because it requires the bucket rule to be
  consulted every render and the user has to keep the auto-clear rule in
  their head. `shown` as a sticky boolean is simpler.
- **Discrete bucket-driven widths.** Issue's table suggested
  `comfortable → min, roomy → preferred`. Rejected because the continuous
  clamp formula already produces the right behavior at every width and
  doesn't snap.
- **Filter rendered in the footer in compact mode.** Looks clean until
  you ask where the match list renders. Either it's a command palette
  (#70's job, not this issue's) or it hijacks the reader pane. Rejected.
- **"Any navigation action auto-opens the sidebar."** Tempting one-liner
  that collides with drawer-focus semantics, erodes the "no sidebar"
  contract of `--sidebar=off`, doesn't help users who never navigate, and
  installs a cross-cutting obligation on every future navigation feature.
  Rejected.
- **Runtime `--layout` mode cycle key.** Once the model is just `shown`
  + focus, there is nothing to cycle. `s` is the entire surface.

## Sequencing

- This work no longer depends on #36 — that landed.
- It does not block on #13; `preferred` can be derived until config arrives.
- DESIGN.md §7.1 needs a full rewrite at the end of this work, not at the
  start. The current §7.1 describes the old single-threshold model and
  should be replaced with the `shown || focus === "sidebar"` rule and the
  decoupled width formula.
- §7.3 reserved keys are unaffected — no new bindings beyond `s` which
  already exists.

## Glossary terms (candidates for CONTEXT.md, once finalized)

Not added to CONTEXT.md yet — these depend on Q1 and Q2 being resolved.

- **sidebar visibility** — `shown || focus === "sidebar"`.
- **`--sidebar`** (launch flag) — `auto | on | off`.
- **viewport bucket** — launch-only; one-shot hint feeding `--sidebar=auto`.
- **drawer** — the rendering of the sidebar when it is visible-because-
  focused while `shown === false`.
- **sidebar width** — `clamp(preferred, MIN, viewport - DIVIDER -
  READER_MIN)`, independent of visibility.

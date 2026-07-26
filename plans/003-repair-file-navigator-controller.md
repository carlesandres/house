# Plan 003: Make the navigator controller commit-safe and debounce-stable

> **Executor instructions**: Execute this plan from the preserved Plan 002 implementation commit
> `2755a57`, not from `main`. Follow each step in order and run every verification command. Modify
> only files listed under "Scope." Stop and report if a STOP condition occurs; do not broaden the
> repair. The reviewer maintains `plans/README.md` during isolated execution.
>
> **Drift check (run first)**:
> `git diff --stat 2755a57 -- packages/ui/src/file-navigator/useFileNavigator.ts packages/ui/test/use-file-navigator.test.tsx packages/ui/test/FileNavigator.test.tsx`
> Any output means the repair baseline has drifted. Compare the current code with the excerpts below;
> stop if the two reviewed defects or the test harness no longer match.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 002 implementation branch `advisor/002-extract-file-navigator` at `2755a57`
- **Category**: bug
- **Planned at**: repair baseline commit `2755a57`, 2026-07-26
- **Parent issue**: https://github.com/carlesandres/house/issues/235

### Execution status

**DONE at `f252e47` after executor and independent advisor review.** Commit
`f252e47862a43002639c826d44dd04e558a5c1f6` changes exactly:

- `packages/ui/src/file-navigator/useFileNavigator.ts`
- `packages/ui/test/use-file-navigator.test.tsx`
- `packages/ui/test/FileNavigator.test.tsx`

Verified: focused UI tests 25 pass; controller tests pass repeatedly; package/workspace typecheck,
lint, and format pass; House reports 444 pass, 7 skip, and 1 todo; `@house/ui` reports 25 pass;
`verify:github` reports 2 pass; standalone build and npm pack pass; artifact/private-workspace
sanitation passes; the isolated worktree is clean. The repair remains on preserved branch
`advisor/002-extract-file-navigator`, ready for delivery but not cherry-picked or merged by the
advisor.

## Why this matters

Plan 002's isolated implementation passes every functional, packaging, and release gate, but advisor
review found two high-risk defects in its reusable controller. It publishes uncommitted props through
refs during render, and its debounce timer can be restarted forever by ordinary inline callbacks.
House does not expose the second bug because Browser passes stable module-level callbacks, so the
generic package needs direct regressions before its otherwise-complete implementation can be approved.

## Current state

The clean pre-repair baseline reviewed for this plan was committed in this order:

```text
90bae4c refactor(ui): add file navigator controller
15362db refactor: integrate shared file navigator
2755a57 fix(release): strip private workspace dependency
```

Relevant files at `2755a57`:

- `packages/ui/src/file-navigator/useFileNavigator.ts:130-245` — controller hook under repair.
- `packages/ui/test/use-file-navigator.test.tsx` — controller harness and 11 passing tests.
- `packages/ui/test/FileNavigator.test.tsx` — renderer harness and 10 passing tests.
- All House integration, package topology, npm sanitation, and documentation changes are already
  committed and out of scope for this repair.

The problematic render path currently has this shape:

```ts
const filesRef = useRef(files)
const getIdRef = useRef(getId)
const getPathRef = useRef(getPath)
const filterRef = useRef(filter)
filesRef.current = files
getIdRef.current = getId
getPathRef.current = getPath
filterRef.current = filter

stateRef.current = reconcile(currentState, filter(files, currentState.appliedQuery), getId)
```

Those writes occur before commit. An abandoned or retried render can therefore change values read by
the previously committed controller.

The debounce effect currently has this shape:

```ts
useEffect(() => {
	cancelTimer()
	if (query === stateRef.current!.appliedQuery) return
	timerRef.current = setTimeout(() => applySearch(query), debounceMs)
	return cancelTimer
}, [debounceMs, filter, getId, getPath, query])
```

Fresh inline callback identities restart the timer. This was independently reproduced by committing
unrelated rerenders every 6 ms with a 30 ms debounce: after ten rerenders, `appliedQuery` was still
empty instead of `"b"`.

Repository conventions:

- Bun workspace and Turborepo; TypeScript is strict NodeNext ESM with `.ts` import extensions.
- Tabs, no semicolons, 100 columns, trailing commas.
- Tests use `testRender` and `act`; no PTY tests.
- Every exported symbol requires TSDoc, but this repair must not change the public API.

## Repair contract

The implementation must preserve all Plan 002 behavior while satisfying both invariants below.

### 1. Render attempts cannot publish operational state

After the hook's one-time lazy initialization, rendering must be observationally pure with respect to
state used by event methods and timers:

- Do not assign to `stateRef.current`, `filesRef.current`, accessor/filter refs, timer refs, or any
  equivalent operational mutable cell during render.
- It is valid and necessary to calculate a reconciled candidate from the current render's `files`,
  `getId`, `filter`, and the last committed controller state. Use that candidate for the snapshot
  returned by the current render so file/selection reconciliation does not gain a one-frame lag.
- Publish the candidate and the current `files`, `getId`, `getPath`, and `filter` to operational refs
  only in `useLayoutEffect` or an equivalent commit-phase mechanism that runs before user input can
  be handled. An effect that runs after paint and creates an observable stale frame is not sufficient.
- A render that suspends, throws, is retried, or is superseded before commit must leave the previously
  committed controller, its snapshots, its callbacks, and any pending timer unchanged.
- Synchronous actions (`flushSearch`, movement, selection, `cancelAutoSelect`) must continue updating
  the committed operational state before requesting a React render. Several actions in one keyboard
  batch must still observe one another, as required by Plan 002.
- Commit publication must not overwrite a newer synchronous action or timer result with a candidate
  derived from older committed state. Choose the smallest mechanism that makes this true; do not add
  a general state store or expose an internal revision API.

The lazy-initialization write is the sole render-time ref-write exception. It cannot be observed by a
previously committed controller because none exists for that hook instance yet. Keep duplicate-ID
validation and filtering pure; do not suppress their existing render-time errors.

### 2. Debounce lifetime follows semantic inputs

The pending search deadline is controlled by the immediate query and debounce duration, not by
callback identity:

- Schedule or replace the timer only when `query` or `debounceMs` changes after commit.
- Fresh identities for `filter`, `getId`, or `getPath` must not cancel or postpone an existing timer.
  `getPath` is presentation-only and must not participate in search scheduling at all.
- At the deadline, filtering and reconciliation must use the latest **committed** `files`, `filter`,
  and `getId`, even if those values committed after the timer was scheduled.
- Continue cancelling the timer when the semantic query/duration changes, `flushSearch` applies a
  query synchronously, or the hook unmounts.
- A callback-only committed rerender may update the commit-synchronized callback refs, but it must not
  run the timer effect cleanup. The original deadline remains in force.

Using stable wrappers, helper functions, or a committed input record is an implementation choice.
Do not solve identity churn by requiring callers to memoize callbacks, omitting latest callback
updates, comparing function source, or adding callback props to a second timer lifecycle.

## Preserved behavior

The repair must not alter these already-passing Plan 002 contracts:

- Initial query application, `initialSelectedId` precedence, and the 50 ms default.
- ID uniqueness errors, ID-based selection, streamed-reranking preservation, disappearance clamping,
  null selection, and first-result auto-selection.
- Synchronous post-flush snapshots and batched movement/selection methods.
- `cancelAutoSelect` rearming only after the applied query changes.
- The public exports and types in `packages/ui/src/index.ts` and
  `packages/ui/src/file-navigator/types.ts`.
- `FileNavigator` frame, row, theme, visibility, and windowing behavior.
- House integration, keyboard ownership, fuzzy ranking, release sanitation, and package topology.

## Commands you will need

| Purpose           | Command                               | Expected on success                    |
| ----------------- | ------------------------------------- | -------------------------------------- |
| Package tests     | `bun run --cwd packages/ui test`      | all controller and renderer tests pass |
| Package typecheck | `bun run --cwd packages/ui typecheck` | exit 0                                 |
| Package lint      | `bun run --cwd packages/ui lint`      | exit 0; no warnings/errors             |
| All typechecks    | `bun run typecheck`                   | both workspaces pass                   |
| All tests         | `bun run test`                        | both workspaces pass                   |
| Release checks    | `bun run verify:github`               | exit 0                                 |
| Standalone        | `bun run build:standalone`            | host smoke passes                      |
| npm stage         | `bun run npm:pack`                    | dry-run pack succeeds                  |

## Scope

**Allowed implementation files** — no others may change:

- `packages/ui/src/file-navigator/useFileNavigator.ts` — repair render/commit publication and timer
  lifecycle only.
- `packages/ui/test/use-file-navigator.test.tsx` — add controller regressions and the minimum harness
  support they need.
- `packages/ui/test/FileNavigator.test.tsx` — add a visible pre-passive-effect public-field probe and
  preserve hidden-state coverage.

The reviewer, not the repair executor, owns status changes in `plans/README.md` and the Plan 002/003
documents. Those planning files are not part of the implementation commit.

**Non-goals / forbidden changes**:

- No public API, exported type, package manifest, dependency, lockfile, Turborepo, or build-script
  change.
- No change to `FileNavigator.tsx`, row/empty-state rendering, or House source/tests. If the visible
  commit probe or hidden preservation test exposes a renderer defect, stop and report it rather than
  silently widening this plan.
- No change to House filtering, discovery, selection policy, keyboard routing, responsive layout,
  theme mapping, documentation, or changelog.
- No `flushSync`, package-owned keyboard handling, React Context, external store, callback-memoization
  requirement, or new dependency.
- No broad hook rewrite or opportunistic cleanup. Retain Plan 002's API and pure reconciliation
  helpers unless a minimal local adjustment is needed for commit safety.
- No PTY test. Use the existing OpenTUI `testRender`/`act` package harness.

## Implementation guidance

Keep two concepts distinct:

1. The **render candidate** is derived without mutation from the last committed state and the props
   participating in the current render. It supplies the controller fields rendered in that attempt.
2. The **committed operational snapshot** is the only state read or changed by previously committed
   controller methods and timer callbacks. Commit-phase synchronization advances it to the successful
   render's candidate and latest inputs.

This separation is the required architecture, but the executor may choose ref names and helper
boundaries. Before coding, reason through these sequences:

- Files change and commit: the committing frame already renders the reconciled selected file; layout
  publication then makes that exact state available to input methods.
- Files/callbacks change and the render suspends: the old committed controller still sees old files,
  old callback behavior, and old selection.
- A query timer is pending while inline callbacks commit repeatedly: the deadline does not move, but
  the callback fired at that deadline sees the most recently committed files, filter, and ID
  accessor.
- A synchronous action or timer updates state while another render attempt exists: no later commit may
  roll the operation back to a stale candidate.

Avoid an effect-only reconciliation that renders old files/selection for one frame. Also avoid
capturing the current render's callbacks directly in long-lived event methods or timer callbacks;
those paths must dereference committed inputs at call time. Preserve timer cleanup on unmount without
making callback-only renders execute that cleanup.

## Steps

### Step 1: Confirm the preserved baseline

Run from the Plan 002 worktree:

```bash
test "$(git rev-parse HEAD)" = "2755a5732e2babf9c864b32c7e28610c1164499a"
git status --short
git diff --stat 2755a57..HEAD -- \
  packages/ui/src/file-navigator/useFileNavigator.ts \
  packages/ui/test/use-file-navigator.test.tsx \
  packages/ui/test/FileNavigator.test.tsx
bun run --cwd packages/ui test
```

Read the hook and both test files rather than implementing from the excerpts alone. Confirm that the
render-time assignments and callback-dependent debounce effect shown under "Current state" still
exist.

**Acceptance criteria**:

- `HEAD` is exactly `2755a57`; the drift command and status are empty.
- The package suite passes before new tests are added.
- The hook and harness still match the reviewed baseline. Otherwise a STOP condition applies.

### Step 2: Add focused regressions and prove the defects

First extend `packages/ui/test/use-file-navigator.test.tsx` with these three tests.

**Committed callback-churn debounce**:

- Add an unrelated harness revision/tick that can force a committed rerender without changing query
  or debounce duration.
- For this test, create `getId`, `getPath`, and `filter` inline inside the harness so every revision
  receives fresh function identities. Do not accidentally reuse the module-level test helpers.
- Change the controlled query once, then commit multiple unrelated rerenders at intervals comfortably
  shorter than `debounceMs`. Continue churn beyond the original deadline and assert the query has
  already applied before waiting one full debounce period after the final rerender.
- Use a generous timing ratio rather than an exact millisecond equality. For example, a 100 ms delay
  with roughly 20 ms committed churn over at least 140 ms leaves a clear distinction: fixed code fires
  around the original deadline; baseline code still has nearly a full delay pending after the last
  commit.
- Assert filtered results and selection as well as `appliedQuery`, proving the timer performed real
  reconciliation. Ensure every churn update is committed through `act`/`renderOnce`; render attempts
  that never commit do not reproduce this bug.
- While the timer is pending, commit at least one new `files` array with observably different entries
  and a distinguishable `getId` implementation (for example, a new revision prefix). Keep query and
  `debounceMs` unchanged. Continue callback churn after that semantic update. The original deadline
  must not restart because either the files array or accessor identity changed.
- At the original deadline, assert `filteredFiles` contains the latest committed file objects, the
  selected file/index is reconciled from those files, and ID-based selection accepts the latest ID
  scheme rather than the schedule-time scheme. This must fail an implementation that closes over the
  files or `getId` present when the timer was created.
- Use one append-only invocation log shared by the inline callbacks. Tag every filter and `getId` call
  with a monotonically increasing sequence, callback revision, query (for filter), and file key. The
  first filter event for the target non-empty query is the timer-time call because render candidates
  still use the old applied query before the deadline. Assert that event has the latest committed
  callback revision and latest file keys, then assert the following reconciliation ID events use the
  latest committed `getId` revision. Keep the test filter independent of `getId` so those following ID
  events unambiguously belong to controller reconciliation. Do not use a single `lastCalledRevision`
  value: a render caused by the timer can overwrite it and make schedule-time callback capture look
  correct.
- Prefer deterministic/fake time only if Bun's timer controls can advance the OpenTUI/React harness
  without changing commit behavior. Otherwise use monotonic time, a debounce much longer than one
  `act`/`renderOnce`, place the latest commit shortly before the original deadline, and assert
  immediately after crossing that deadline but well before one delay has elapsed from the latest
  commit. Never rescue the old implementation by waiting a full debounce interval after the final
  files/callback commit.

**Abandoned/suspended render isolation**:

- Capture the externally callable controller in a layout effect (or another commit-only test probe),
  not by assigning the test variable during render. A render-time test capture would itself publish
  the value this regression is meant to reject.
- Mount and commit one set of files/accessors/filter behavior. Start a subsequent render with
  observably different files and callback behavior, call `useFileNavigator`, then suspend below the
  hook with a controllable thenable under `Suspense` (or use an equivalent deterministic React
  abandoned-render harness).
- Prove the candidate render was attempted but did not commit. Before resolving it, inspect and invoke
  the previously committed controller. `getSnapshot`, `flushSearch`, and at least one selection action
  must continue using only the committed files, IDs, filtering behavior, and selection.
- Supersede/abandon the suspended candidate or resolve it only during cleanup, and leave no pending
  promise/timer. The test must not infer safety merely from fallback text.
- Include an assertion that would fail from the baseline `stateRef.current = reconcile(...)` write and
  one that would fail from baseline latest-input ref writes. Different candidate files plus a
  distinguishable filter/ID accessor are sufficient.

**Stale commit cannot roll back a synchronous action**:

- Add a separate one-shot commit-interleaving harness. Mount the hook and commit an initial selection.
  Then start a normal rerender from that committed state with a changed files array so the hook derives
  a candidate that still carries the old selection.
- Render a child probe below the component that called `useFileNavigator`. In the child's layout
  effect, invoke `selectLast` (or another unambiguous synchronous controller action) through the
  controller from the previous commit. In React's current reconciler, descendant layout effects run
  before the ancestor hook's layout effects, so this deterministically performs the action after the
  candidate was rendered but before the hook can publish that candidate.
- Let the commit and the action-triggered nested render settle, then assert the selected file/index is
  the action's result. An unconditional parent layout-effect assignment of the stale render candidate
  would restore the old selection and must fail this test.
- Guard the child action by a one-shot token tied to that commit so it cannot run again during the
  nested rerender. After `useFileNavigator`, register a harness layout effect that appends the
  post-publication controller snapshot. Same-fiber layout effects run in hook declaration order, so
  the expected log is descendant action first, then the harness's post-publication snapshot for that
  generation. Assert this order and the final selection; do not infer interleaving only from the final
  value.
- This regression may pass at `2755a57`, which publishes during render. Its purpose is to reject the
  naive repair that merely moves the current assignment into an unguarded layout effect.

Then strengthen `packages/ui/test/FileNavigator.test.tsx`:

- Keep the existing hide/reopen persistence test.
- Add a commit-only child probe that receives the exact controller object passed to a visible
  `FileNavigator` in the same render. From the child's `useLayoutEffect`, append a record by reading
  the controller object's render-derived public fields directly: `appliedQuery`, `filteredFiles`,
  `selectedFile`, and `selectedIndex`. Select a non-default file, then commit a files change that
  removes/repositions it and requires reconciliation.
- Do **not** call `controller.getSnapshot()` in this child probe. `getSnapshot()` is intentionally
  operational/commit-backed and may still represent the prior commit while descendant layout effects
  run before the parent hook's publication layout effect. This test concerns the public fields on the
  exact controller object produced by that render, which are what the visible `FileNavigator` receives.
- Inspect the **first** appended public-field record for that update. Before passive effects run, it
  must already contain the new files and reconciled selection/index. Also assert the visible
  navigator's resulting window. A passive-effect-only implementation that first renders old public
  fields and corrects them in a later render must fail even if `act` eventually flushes both renders.
- Tag records with the externally requested update generation so later corrective commits cannot
  overwrite or masquerade as the first commit. The probe must append records rather than retain only
  the latest public fields.
- Keep or add hidden files/dimensions/selection updates only as preservation coverage for retained
  scrolling. Do not cite hidden reconciliation as evidence that publication happened before passive
  effects: hidden work can settle before reveal and cannot establish first-commit timing.

Run the targeted red check before editing source:

```bash
bun run --cwd packages/ui test -- use-file-navigator.test.tsx FileNavigator.test.tsx
```

**Acceptance criteria**:

- Existing tests, the stale-commit guard, and the visible pre-passive/hidden preservation tests pass on
  the baseline.
- The callback-churn test fails because the applied query remains stale after the original deadline.
- The suspended/abandoned-render test fails because the old controller observes candidate inputs or
  reconciled state.
- Failures are assertion failures demonstrating the reviewed defects, not act warnings, hangs,
  unhandled promises, renderer errors, or timing noise.

The two baseline-defect tests must be red. The stale-commit and pre-passive tests guard against unsafe
repair shapes and are expected to remain green on the render-mutating baseline. If either defect test
passes unchanged on the baseline, verify that it truly commits files/callback churn or truly executes
an uncommitted render. Stop if a valid regression cannot be made red deterministically; do not weaken
the contract to fit the harness.

### Step 3: Repair `useFileNavigator`

Modify only `packages/ui/src/file-navigator/useFileNavigator.ts`.

1. Retain predictable lazy initialization, then derive render reconciliation into a local candidate
   without assigning operational refs.
2. Make the current render's public snapshot come from that candidate so committed file/selection
   updates remain frame-correct.
3. In a layout/commit phase, publish the successful candidate and latest files/accessors/filter for
   synchronous methods and timer callbacks. Ensure the publication cannot roll back a newer action.
4. Keep event methods synchronous and ref-backed. They must read only committed inputs and update the
   operational state before dispatching a rerender.
5. Restrict debounce scheduling dependencies to `query` and `debounceMs`. Let the timer callback read
   latest committed inputs at execution. Keep semantic replacement, flush, and unmount cancellation.
6. Remove all post-initialization render-time assignments to operational refs. Do not hide writes in
   a helper invoked during render.

Do not require one specific mechanism beyond the repair contract. In particular, a layout effect is
the expected publication seam, but copying a stale candidate unconditionally is not acceptable if it
can overwrite a newer timer/action result. Prefer a small local guard or re-derivation over a new
abstraction if concurrency requires it.

**Acceptance criteria**:

- All new controller regressions pass repeatedly, including the commit-interleaving action guard.
- Existing synchronous action, flush, auto-select, duplicate-ID, streaming, and clamping tests remain
  unchanged and pass.
- Search timing does not depend on `filter`, `getId`, or `getPath` identity.
- A successful prop commit remains visible in its first frame, while an unsuccessful render cannot be
  observed through the old controller.

### Step 4: Run focused package verification

Run formatting only on the three allowed files if needed, then execute:

```bash
bun x oxfmt \
  packages/ui/src/file-navigator/useFileNavigator.ts \
  packages/ui/test/use-file-navigator.test.tsx \
  packages/ui/test/FileNavigator.test.tsx
bun run --cwd packages/ui test -- use-file-navigator.test.tsx FileNavigator.test.tsx
bun run --cwd packages/ui test
bun run --cwd packages/ui typecheck
bun run --cwd packages/ui lint
bun run --cwd packages/ui format:check
git diff --check
```

Run the focused controller test more than once to catch timer or Suspense cleanup flakiness:

```bash
bun run --cwd packages/ui test -- use-file-navigator.test.tsx
bun run --cwd packages/ui test -- use-file-navigator.test.tsx
```

**Acceptance criteria**:

- Every command exits 0 on two consecutive focused controller runs.
- There are no act warnings, leaked timers/promises, unhandled rejections, or post-test updates.
- Formatting touches only the three allowed files.

### Step 5: Re-run all Plan 002 integration and release gates

The repair is not complete based on package tests alone. Run the full repository gates that already
passed at `2755a57`:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run format:check
bun test
bun run test
bun run verify:github
bun run build:standalone
bun run npm:pack
test -f apps/house/dist/npm/main/package.json
test -d apps/house/dist/npm/main/dist
if rg '@house/ui|workspace:' \
  apps/house/dist/npm/main/package.json apps/house/dist/npm/main/dist; then
  exit 1
else
  rg_status=$?
  test "$rg_status" -eq 1
fi
git diff --check
git diff --name-only 2755a57
git status --short
```

Also prove that no Plan 002 integration/package file changed:

```bash
git diff --exit-code 2755a57 -- \
  apps/house bun.lock bunfig.toml turbo.json package.json \
  packages/ui/package.json packages/ui/tsconfig.json packages/ui/bunfig.toml \
  packages/ui/src/file-navigator/FileNavigator.tsx \
  packages/ui/src/file-navigator/types.ts packages/ui/src/index.ts \
  DESIGN.md CONTRIBUTING.md CHANGELOG.md plans
```

**Acceptance criteria**:

- Every positive gate exits 0; both npm-stage paths exist; `rg` returns exactly 1 (no matches). A match
  or an `rg` error (exit code 2 or greater) fails verification.
- The final exit-code diff is empty.
- `git diff --name-only 2755a57` and `git status --short` list exactly the three allowed files.
- No generated build output, lockfile change, or unrelated formatting is tracked.
- The executor reports results to the reviewer but does not mark Plans 002/003 DONE.

## Test plan

Controller regressions:

- Repeated **committed** rerenders with fresh inline `filter`, `getId`, and `getPath` identities cannot
  postpone a pending query past its original semantic deadline.
- Files and ID semantics change during the pending interval without restarting it; append-only call
  evidence proves the deadline uses latest committed files/filter/`getId`, not schedule-time captures
  or a later render's overwritten recorder value.
- A suspended and subsequently abandoned render cannot change the old controller's snapshot, flush
  behavior, selection behavior, or input callbacks.
- A synchronous action executed after candidate render but before candidate publication survives the
  commit and its nested rerender.

Preservation coverage:

- All 11 baseline controller tests remain green without weakened assertions.
- Initial query, flush, timer cancellation, selected-ID stability, disappearance clamping, empty
  recovery, movement, auto-select cancellation, and duplicate-ID failure remain green.
- A layout-phase append-only probe proves the render-derived public fields passed to the first visible
  commit for changed files/selection are reconciled before passive effects; it does not call the
  operational `getSnapshot()` before parent publication. Hidden updates continue to preserve the
  retained scroll window.

Repository coverage:

- House-only and all-workspace tests pass.
- Typecheck, lint, and format pass at package and repository levels.
- Frozen install, GitHub release checks, standalone smoke, npm pack, and private-dependency sanitation
  remain unchanged and pass.

## Done criteria

- [ ] Baseline is exactly `2755a57`, with no pre-existing drift in repair files.
- [ ] Only the three allowed files changed.
- [ ] No operational ref is assigned during render after one-time lazy initialization.
- [ ] The current render uses a pure reconciled candidate; committed file changes do not appear one
      frame late.
- [ ] Abandoned, suspended, retried, or superseded renders cannot publish candidate props/state to a
      previously committed controller, action, or timer.
- [ ] Commit publication cannot overwrite a newer synchronous action or timer result.
- [ ] The debounce lifecycle depends only on `query` and `debounceMs`.
- [ ] Callback-only committed rerenders update latest committed behavior without moving the deadline.
- [ ] `getPath` has no role in search scheduling.
- [ ] Flush, unmount, query replacement, and duration replacement still cancel the appropriate timer.
- [ ] Repeated callback/files/getId churn regression passes at the original deadline and append-only
      events prove timer-time use of all latest committed semantic inputs.
- [ ] Suspended/abandoned-render regression passes using a commit-only controller capture.
- [ ] Commit-interleaving regression proves a stale candidate cannot roll back a newer synchronous
      action.
- [ ] Visible layout-phase probe proves the first commit's render-derived public fields are reconciled
      before passive effects without requiring pre-publication `getSnapshot()` to be current.
- [ ] Hidden-state regression preserves retained scrolling without being used as commit-timing proof.
- [ ] All baseline package, House integration, workspace, release, standalone, and npm gates pass.
- [ ] Public API, package topology, House behavior, docs, and lockfile remain byte-for-byte unchanged
      from `2755a57`.

## STOP conditions

Stop and report rather than improvising if:

- The worktree is not exactly at `2755a57`, any repair file has drift, or baseline package tests fail.
- A deterministic in-process test cannot execute and abandon/suspend a render after the hook without
  act warnings, hangs, or test-owned render-time publication.
- Either baseline-defect regression (callback starvation or abandoned-render leakage) does not fail
  against the baseline implementation after its harness is validated.
- Correctness requires changing the public controller API, House integration, `FileNavigator.tsx`,
  package metadata, dependencies, lockfiles, build scripts, or documentation.
- Correctness appears to require `flushSync`, package-level keyboard handling, caller memoization,
  React Context, or an external store.
- Commit-safe publication necessarily introduces a visible stale frame or loses Plan 002's
  synchronous multi-action behavior.
- A pending timer/action can still be rolled back by a later stale render candidate and a scoped fix
  is not clear.
- The visible commit probe or hidden-state test exposes an existing renderer bug rather than a hook
  regression.
- Any focused or full verification gate fails twice after one reasonable repair within scope.
- npm staging gains an `@house/ui` or `workspace:` reference, or any Plan 002 integration/package file
  differs from `2755a57`.

## Reviewer checklist

- [ ] Diff is based on `2755a57` and contains only the hook and two package test files.
- [ ] Render contains no post-initialization operational ref assignments, including assignments hidden
      in render-called helpers.
- [ ] Reconciliation is pure for the current frame and commit publication happens before input.
- [ ] Previously committed methods and timers dereference only committed inputs.
- [ ] Commit publication cannot roll back newer synchronous state.
- [ ] Timer effect scheduling/cleanup is driven only by `query` and `debounceMs`; `filter`, `getId`, and
      `getPath` identity churn cannot restart it.
- [ ] Timer execution uses latest committed files/filter/ID accessor.
- [ ] Callback-churn test performs repeated committed rerenders, crosses the original deadline, and
      asserts before a full post-churn delay could rescue the old implementation.
- [ ] Pending-timer test commits changed files and distinguishable ID semantics; its append-only,
      sequence-tagged events identify the timer-time filter/ID calls before later render calls.
- [ ] Suspense/abandonment test captures the controller only at commit and distinguishes both leaked
      reconciled state and leaked latest-input refs.
- [ ] One-shot child layout action occurs between candidate render and ancestor publication, and the
      stale candidate cannot roll it back.
- [ ] Visible commit probe appends `appliedQuery`, `filteredFiles`, `selectedFile`, and `selectedIndex`
      directly from the exact render-produced controller object; it does not call `getSnapshot()`
      before parent layout publication, and a later passive correction cannot hide stale public fields
      in the first commit.
- [ ] Hidden-state test remains preservation coverage and is not presented as commit-timing evidence.
- [ ] npm sanitation checks artifact existence and distinguishes no matches (`rg` 1) from search
      errors (`rg` 2+).
- [ ] Existing tests were not deleted, skipped, loosened, or converted to snapshots that obscure the
      behavioral assertions.
- [ ] Full Plan 002 integration, package, standalone, release, and npm sanitation gates pass.
- [ ] After approval, update `plans/README.md` so Plans 002 and 003 become DONE together; do not mark
      Plan 002 complete from package tests alone.

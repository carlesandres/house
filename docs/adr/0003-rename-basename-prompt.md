# ADR 0003: Basename Rename via reused PromptModal

- Status: Accepted
- Date: 2026-08-24

House gains **Rename**: change only the basename of the selected file, keeping its
parent directory unchanged. The interaction reuses the existing `PromptModal` shell
from **New file** (ADR 0002) with an optional context line for the **Action Target**
path. Bare `r` stays reserved for Reload; the binding is `shift+r` / `file.rename`.
This ships independently of Delete (#20).

## Context

Users need to rename the current markdown file without leaving House. CONTEXT.md
already states that renaming replaces one **File Identity** with another — it is not
an identity-preserving update. **Move** (changing parent path) is out of scope.

ADR 0002 shipped a centered `PromptModal` for **New file** and recorded the revisit
trigger: a second House prompt should reuse that shell (extract to `@house/ui` per
#248 only once the shared shell is proven under two call sites). The deletion plan
(`docs/file-deletion-plan.md`) defers rename/move and plans a `ConfirmDialog` for
destructive y/n — the wrong shape for a name field.

`DESIGN.md` §7.3 reserves bare `r` for Reload. §3 currently allows only **New file**
as a disk-write exception; Rename is a second explicit file action and must be named
there so agents do not “fix” it.

## Decision

### Action

- Binding id `file.rename`, key `shift+r`. Gated on `hasSelected` (same File-group
  rule as `E` / `O`). Focus-agnostic when selected. Palette title: `Rename…`.
  No footer hint (match `N`).
- Do not bind bare `r`. Do not require `$EDITOR` / `$VISUAL` (Rename is not a
  create→edit hand-off).

### Domain

- **Rename** changes only the basename; parent directory stays the same.
  Nested files stay nested (`notes/foo.md` → `notes/bar.md`).
- Opening the prompt freezes an **Action Target**: the selected file’s
  **File Identity**, parent directory, and root-relative path at open time.
  Submit operates on that target, not the live selection.
- Esc: close, restore previous focus, leave query and selection untouched.

### Prompt shell

- Reuse `PromptModal` in `apps/house`. Keep `floatingOverlay` kind `prompt`.
  Distinguish purpose with a Browser-owned ref/mode (`new-file` | `rename`), not a
  second overlay kind and not a forked modal component.
- Opening Rename replaces palette / status popover and closes filter editing
  (same single-floating-overlay rule as New file).
- Add optional `context?: string` to `PromptModal`. New file omits it; Rename
  passes the Action Target’s root-relative path (truncate like other long paths).
- Chrome: title `Rename`, placeholder `File name`, hints `enter rename  esc cancel`,
  context = Action Target relative path.
- Prefill the input with the current basename; caret at end. Do not select-all
  unless `PromptRow` already supports selection without new machinery.
- Never rewrite the input field while typing (same discipline as ADR 0002).
- Keys while open: same swallow rules as New file (printable including space;
  Backspace/Delete edit; Enter submits; Esc cancels; no quit / palette / sidebar
  motion). Suppress duplicate submit while a rename is pending.

### Resolve (shared helper)

- Generalize `resolveNewFileName` into a shared pure helper with a mode
  (`new-file` | `rename`): same validation and `.md` normalization / warnings.
- Mode-specific blocking copy for path-shaped input:
  - `new-file`: keep `name must be a single file in the discovery root`
  - `rename`: `name must be a single file name` (destination is same parent, not
    necessarily the Discovery Root)
- Hidden names, controls, `.` / `..`, and extension rules stay identical.
- Live warnings after a successful resolve:
  - Extension warnings as today.
  - Filter: if the current query is non-empty and would not show the destination
    **relative path** (`join(parentRelative, basename)`), warn
    `filter will change to <basename>` (match check uses the full relative path;
    the replacement query string is the new basename — same product copy as New file).
  - Collision may be live-stated when a *different* sibling exists at the
    destination; Enter remains authoritative.
- Identical resolved basename as the Action Target: Enter closes as a successful
  no-op (no filesystem call, no error).

### Filesystem

- Destination: `join(ActionTarget.parentDir, resolvedBasename)` only.
- Before renaming, re-verify the Action Target: still exists, regular file, still
  under the resolved Discovery Root, still in the captured parent. On mismatch:
  stay in the prompt with a non-retryable error (`target missing` / `target changed`).
- Destination exists as a different entry: stay in prompt, `already exists`.
  No overwrite, no swap.
- Case-only renames on case-insensitive volumes (default macOS): detect
  case-insensitive equality with different codepoints in the same parent; rename
  through a unique sibling temporary basename, then to the final name.
- Other IO failures: stay in the prompt, `rename failed: <os message>`.
- Prompt-scoped errors/warnings stay in the modal status slot (not
  `pushFooterNotice` — footer notices close floating overlays).

### After a successful rename

1. Close the prompt.
2. If the current query would hide the new relative path, set the query to the
   resolved basename (already announced by the filter warning).
3. Arm selection on the new **File Identity** (`pendingSelectionPathRef` +
   `navigator.selectPath`), same membership wait pattern as New file (~2s,
   refresh + poll). Do not splice Sidebar rows; do not full-rescan as the primary
   path.
4. If the HTML preview server’s `currentTarget()` is the old Action Target path,
   `setTarget(newPath)` so live-reload tracks the new file. If preview was on
   another file, leave it alone.
5. Do **not** open `$EDITOR`.
6. On membership timeout: keep the renamed file on disk, footer
   `renamed to <basename>, but it isn't in the file list`.

### Docs / non-goal wording

- Broaden `DESIGN.md` §3 to explicit file actions: **New file** (exclusive empty
  create) and **Rename** (basename rename of an Action Target). Still no in-app
  buffer, no overwrite, no Move.
- Update §7.2 keys / README keys table / CHANGELOG `[Unreleased]` **Added**.
- CONTEXT.md already records **Rename** and **Action Target**.

## Considered options

| Topic | Rejected | Why |
| --- | --- | --- |
| Move / path input | Out of scope | Different verb; breaks basename-only contract |
| Bind bare `r` | Conflicts with Reload reservation | §7.3 muscle memory |
| Inline Sidebar row edit | New editing affordances | Weak reuse; different grammar from New file |
| ConfirmDialog / y/n | Wrong shape | Needs a name field |
| Extract `PromptModal` to `@house/ui` first (#248) | Blocks Rename on package move | ADR 0002: extract after two call sites prove the shell |
| Implement Delete first | Different shell | ConfirmDialog does not help PromptModal reuse |
| Fork `RenameModal` | Duplicates overlay grammar | Violates reuse goal |
| Overwrite on collision | Destructive | Same reject as New file |
| Keep query when rename would hide the file | Selection vanishes | Breaks feedback; violates usable Invariant 1 pairing |
| Always open `$EDITOR` after rename | Confuses with New file | Rename is identity change only |
| Ignore case-only renames | Broken on default macOS | Two-step temp rename is the portable fix |
| File Navigator atomic rename API now | Larger `@house/ui` surface | Watcher + pending selection is enough for v1 |

## Non-goals

- **Move**, overwrite, multi-file rename, directory rename.
- Hidden-name rename (#247 still governs create; same reject in shared resolve).
- Discovery Policy preflight beyond “would the filter show it” (#249-style stays open).
- Extracting `PromptModal` to `@house/ui` (#248) — track as follow-up once Rename ships.
- Delete (#20) / ConfirmDialog package.
- Targeted File Navigator rename reconciliation API (revisit if membership waits are noisy).
- Footer hint for `R`.
- Windows-only name rules.

## Consequences

### Positive

- Second prompt reuses one shell; #248 extraction trigger is now concrete.
- **Action Target** language is shared with the future Delete plan without coupling
  implementations.
- Basename-only keeps Discovery Scope and Sidebar invariants intact.

### Negative

- Another explicit disk mutation in §3 — docs must stay honest.
- Case-only two-step rename is subtle; needs focused tests.
- `floatingOverlay` kind `prompt` now has two purposes — Browser mode/ref must stay
  obvious or the overlay branch will rot.

### Docs to update when implementing

- `DESIGN.md` §3 (file actions), §7.2 (`R` / Rename copy), §7.6 if prompt chrome gains context.
- `README.md` keys table.
- `CHANGELOG.md` `[Unreleased]` **Added**.
- `apps/house/src/io/createFile.ts` header comment (“only disk write”) — either
  broaden or point at the file-actions set.
- `CONTEXT.md` — already updated during grilling.

## Implementation Plan

- **Affected paths**
  - `apps/house/src/PromptModal.tsx` — optional `context` prop + layout height
  - `apps/house/src/new-file/resolveName.ts` (or rename module to shared
    `resolveMarkdownBasename`) — mode-specific copy; keep New file behavior locked
    by existing tests
  - New: `apps/house/src/io/renameFile.ts` — re-verify, collision, case-only
    two-step, tagged results
  - `apps/house/src/Browser.tsx` — prompt purpose mode, Action Target capture,
    open/submit/cancel, filter warning path uses destination relative path,
    pending selection wait without `editCurrent`, preview `setTarget` when needed
  - `apps/house/src/keymap/browser.ts` — `file.rename` / `shift+r` / `hasSelected`
  - `apps/house/src/commands/buildCommands.ts` — palette `Rename…`
  - Tests: unit tests for resolve mode + rename IO (incl. case-only); Browser /
    keymap tests for open/prefill/context/cancel/submit; extend filter warning
    coverage for nested relative paths
  - Docs listed above
- **Pattern to follow**: ADR 0002 prompt branch (`useKeyboard` swallow,
  prompt-scoped status, footer only after close); `pendingSelectionPathRef` +
  membership wait; `queryWouldShowRelativePath` for filter warnings; preview
  `setTarget`.
- **Pattern to avoid**: imperative Sidebar inserts; Move via path-shaped input;
  routing prompt errors through `pushFooterNotice`; binding bare `r`; opening
  editor after rename; implementing ConfirmDialog for this feature; extracting
  `@house/ui` PromptModal in the same PR unless #248 is explicitly in scope.
- **Dependencies**: none new.
- **Config**: none.

## Verification

- [ ] `shift+r` dispatches `file.rename` only when `hasSelected`; bare `r` still unbound.
- [ ] Palette lists `Rename…`; no footer hint on the binding.
- [ ] No selection: binding inactive (same as other File-group `hasSelected` actions).
- [ ] Prompt shows title `Rename`, context = Action Target relative path, prefilled
      basename, placeholder `File name`, hints `enter rename  esc cancel`.
- [ ] Esc closes; query and selection unchanged; Action Target discarded.
- [ ] Enter on identical resolved basename: close, no filesystem change.
- [ ] Path separators / `.` / `..` / hidden / controls: blocking errors, stay open.
- [ ] Extension normalization and live warnings match New file.
- [ ] Nested file `notes/foo.md` → `notes/bar.md` (parent unchanged).
- [ ] Destination collision with a different sibling: `already exists`, stay open.
- [ ] Target missing/replaced between open and Enter: non-retryable prompt error,
      no rename.
- [ ] Case-only rename (`meeting.md` → `Meeting.md`) succeeds on a case-insensitive
      volume via two-step temp rename.
- [ ] Active query that would hide the new relative path: live filter warning;
      Enter renames, query becomes new basename, new path selected.
- [ ] After success, `$EDITOR` is not spawned.
- [ ] Preview serving the old path is retargeted to the new path; preview of another
      file is untouched.
- [ ] Membership timeout: disk rename kept, footer
      `renamed to <basename>, but it isn't in the file list`.
- [ ] While prompt open: `q` types; `ctrl+c` does not quit; `ctrl+p` does not open
      palette; arrows do not move Sidebar.
- [ ] `PromptModal` remains under `apps/house`; Delete / ConfirmDialog not introduced.
- [ ] `bun test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass.

## Revisit triggers

- #248 — extract `PromptModal` now that two call sites exist.
- Membership waits feel flaky after rename — then consider File Navigator-owned
  rename reconciliation (parallel to deletion plan slice 4).
- Users ask for **Move** / nested destination paths — new ADR; do not silently
  widen basename-only.
- Delete (#20) lands — share **Action Target** / re-verify vocabulary; keep
  ConfirmDialog separate from PromptModal.

# Confirmed file deletion plan

Working implementation plan recovered from the interrupted OpenCode session.
This is a proposal only; no deletion behavior is implemented by this document.

## Goal

Allow users to delete the selected file from House through an explicit,
confirmed action, implemented with a red-green TDD loop. The implementation
should establish a reusable boundary for confirmed file actions without
implementing rename or move yet.

## Settled decisions

- Bind deletion to lowercase `d` from either browser pane and expose it in the
  palette/help.
- Open a confirmation overlay showing the target's root-relative path.
- `y/Y` confirms; `n/N`, Escape, and Ctrl+C cancel. Unrelated keys do nothing.
- Capture an immutable **Action Target** when confirmation opens.
- Immediately before unlinking, verify that the target still exists, is the
  same regular file, and remains beneath the resolved discovery root.
- Accept the residual TOCTOU race inherent in portable `lstat` followed by
  `unlink`; do not add platform-specific native filesystem code for v1.
- Preserve the active filter after deletion.
- Select the row that takes the deleted row's index, falling back to the
  preceding row when deleting the last row; select nothing if the projection
  becomes empty.
- Reconcile the removed path through File Navigator ownership. Do not splice
  Browser rows or trigger a full rescan.
- Keep the dialog open with a tagged error when deletion fails.
- Stop the preview server if it is serving the successfully deleted file.
- Suppress duplicate confirmation and cancellation while deletion is pending.

## Component boundary

Create a private, publication-ready workspace package containing:

- a controlled generic `Modal`, and
- a `ConfirmDialog` specialization.

The package should use package-neutral props, peer dependencies, explicit
exports, terminal-size-aware absolute positioning, and `zIndex`. It owns
overlay rendering, keyboard semantics, pending state, and error presentation.

House owns deletion wording, semantic colors, Action Target state, filesystem
operations, and preview cleanup.

The host must suppress the underlying Browser keymap while the modal is open;
OpenTUI keyboard events do not provide propagation cancellation.

Public npm naming and release automation remain deferred.

## TDD implementation slices

Each item is a separate red-green cycle rather than a batch of tests written
up front.

1. **Cancellation tracer** — Add a Browser integration test using a real
   temporary file. Press `d`, assert the Action Target appears, press Escape,
   and assert the file and selection are unchanged. Implement the minimum
   modal package and Browser integration needed to pass.
2. **Modal input isolation** — Prove movement, quit, palette, and other
   Browser bindings do not fire while confirmation is open. Cover `n/N`,
   Ctrl+C, and unrelated keys; route overlay input before the Browser keymap.
3. **Confirmed deletion** — Press `d`, then `y`; assert the selected file is
   unlinked and disappears from the File Navigator. Add the tagged deletion
   service and `file.delete` binding.
4. **Targeted reconciliation** — Add a File Navigator-owned API that validates
   and reconciles specified removed paths without a full scan. Matching watcher
   deletion events should become no-ops after reconciliation.
5. **Post-delete selection** — Cover middle-row, last-row, and only-row
   deletion. Correct the existing first-row fallback in `FileNavigatorCore`.
6. **Filtered deletion** — Delete under an active search projection. Preserve
   the query and select the nearest surviving projected row, including a
   zero-result query after its final match is deleted.
7. **Replacement protection** — Open confirmation, replace or remove the path,
   then confirm. Refuse deletion and show a non-retryable changed-target error.
   Cover a symlink and directory replacement.
8. **Resolved-root containment** — Allow deletion beneath an explicitly
   symlinked root while rejecting a target that escapes the resolved discovery
   scope.
9. **Failure and retry** — Inject permission and unlink failures through the
   filesystem seam. Keep the dialog open with an error and avoid reconciliation
   or preview shutdown when unlink fails.
10. **Preview cleanup** — Delete the file currently served by the preview and
    assert the server stops only after successful unlink.
11. **Component coverage** — Test the public package interface for controlled
    visibility, rendering, sizing, key semantics, pending state, errors, and
    callbacks. Add a small package-local extraction example.
12. **Quality gates** — Run focused tests after each slice, then run:
    `bun run format`, `bun test`, `bun run typecheck`, `bun run lint`, and
    `bun run format:check`.

## Documentation updates

When implementation begins, update the following as applicable:

- `CONTEXT.md`: define **Action Target**, without making inode semantics part
  of the domain term.
- `DESIGN.md`: revise the disk-write non-goal and document explicit file
  actions, confirmation overlays, targeted reconciliation, and key routing.
- `docs/file-navigator-design.md`: document targeted removal reconciliation and
  nearest-row selection.
- `README.md`: document `d` and confirmation behavior.
- `CONTRIBUTING.md`: document the modal host contract and key handling.
- `ROADMAP.md`: update issue #20's status.
- `CHANGELOG.md`: add the feature under `[Unreleased]`.
- The dialog package README: document its API, input contract, theming, and
  extraction constraints.

No ADR is warranted yet; the package boundary remains inexpensive to reverse
before publication.

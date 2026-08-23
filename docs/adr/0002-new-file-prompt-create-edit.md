# ADR 0002: Replace nameless `N` with prompt-create-select-edit

- Status: Accepted
- Date: 2026-08-23

House’s **New file** action (`N` / `shift+n`) used to suspend the TUI and hand `$EDITOR` the
Discovery Root with no path. That is replaced by a prompt that creates an empty `.md` file at the
Discovery Root, waits for the File Navigator to admit it, selects it, and runs the same Open in
editor path as `E`. House may write a new empty markdown file as a prelude to that hand-off; it
still has no in-app buffer and does not overwrite.

Follow-ups already filed: hidden names ([#247](https://github.com/carlesandres/house/issues/247)),
`PromptModal` extraction ([#248](https://github.com/carlesandres/house/issues/248)), Discovery
Policy preflight at the prompt ([#249](https://github.com/carlesandres/house/issues/249)).

## Context

`DESIGN.md` §3 says House is not an editor and does not write to disk. `N` was the workaround:
open a nameless editor session in the Discovery Root and let the editor create the file. Selection
and query stayed put.

That is a poor New file: the name is chosen in `$EDITOR`, House does not select the result, and
there are two editor launch paths (path vs cwd-only). The product we want is create → membership →
select → `E`.

Doing that requires a string prompt (none exists), a narrow write exception, and overlay rules that
do not fight `DESIGN.md` §7.4 Invariant 1 (the Sidebar is only `filter(pool, query)`) or §7.6 (at
most one floating overlay; footer notices close floating overlays).

## Decision

### Action

- Keep the binding id `file.new` and the key `shift+n`. Focus-agnostic. Not gated on `hasSelected`.
  No footer hint. Palette title: `New file…`.
- Remove `editNewInRoot` (cwd, no path). Do not keep a second nameless-editor command.
- If `$VISUAL` / `$EDITOR` is unset, do not open the prompt; keep the footer notice
  `set $EDITOR or $VISUAL to use N`. Renderer-unavailable stays a footer notice, same as `E`.

### Prompt

- New render-only `PromptModal` in `apps/house` (not `@house/ui`; see #248). Scrim + centered box,
  same overlay grammar as `CommandPalette`: parent owns value, messages, and keyboard.
- Add `floatingOverlay` kind `prompt`. Opening it replaces palette / status popover and closes
  filter editing. Title `New file`, placeholder `File name`, hints `enter create  esc cancel`, no
  prefill.
- Never rewrite the input field (no auto-`.md`, no trim-in-place, no case folding in the box).
- Esc: close, restore previous focus, leave query and selection untouched.
- Keys while open: printable including space append; Backspace/Delete edit; Enter submits; Esc
  cancels. Swallow everything else — including `ctrl+c` (no quit) and `ctrl+p` (no palette). Arrows
  must not move the Sidebar or reader.

Do not treat this overlay as the trigger to implement scoped keymap composition (`DESIGN.md` §12).
Handle keys in the same `useKeyboard` branch style as the palette.

### Resolve (submit-time; also drives live warnings)

Pure helper, unit-tested. Input is the field string; output is either a blocking error or a
resolved basename plus zero or more warnings.

1. If the raw string contains a control character (`U+0000`–`U+001F` or `U+007F`):
   `name contains invalid characters`.
2. Trim ends. If empty: `name required`.
3. If it contains `/` or `\`, or the trimmed name is `.` or `..`:
   `name must be a single file in the discovery root`.
4. If the trimmed name starts with `.`: `hidden names aren't supported yet` (#247).
5. Extension:
   - already ends with `.md` (exact): basename unchanged, no extension warning.
   - matches `/\.md$/i` but is not exact `.md`: stem + `.md`, warning
     `extension will be saved as .md`.
   - otherwise: append `.md`. If the trimmed name contains a `.` (including a trailing dot):
     warning `will be created as <basename>`.
6. Stem case and internal spaces are preserved. No Unicode preflight, no slugger.

Live (as they type), after a successful resolve:

- Filter: if the current query is non-empty and the File Navigator search would not score a
  Discovery-Root file whose `relativePath` is the resolved basename, warning
  `filter will change to <basename>`. Use the same matching rule as `fuzzySearch`
  (`fuzzysort.single` on lowercased query vs lowercased relative path). Do not invent a
  substring-only check.
- Extension warnings as above.
- Both warnings may show together (two lines). Blocking errors replace the warning slot.
- Empty-name error waits for Enter (do not error an empty field on open).
- Collision may be live-stated when the path already exists; Enter is still authoritative via
  exclusive create.

Do not show a resolved-name preview for the implicit `foo` → `foo.md` case.

### Create

- Path: `join(Discovery Root, basename)` only. No nested dirs, no escape.
- Exclusive create (`wx` / `O_EXCL`). Empty file (0 bytes). `EEXIST` (file or directory) → stay in
  the prompt, `already exists`. Other IO → stay in the prompt, `create failed: <os message>`.
- This is the only disk write. No overwrite, no truncate.

### After a successful write

1. Close the prompt.
2. If the current query would hide the file, set the query to the resolved basename (already
   announced by the filter warning).
3. Arm selection by File Identity (`pendingSelectionPathRef` + `navigator.selectPath`, same pattern
   as `shift+a`).
4. Wait until the File Navigator snapshot contains that path, up to **2 seconds**.
5. Then call the same Open in editor function as `E` (`editCurrent`).
6. On timeout: keep the file, do not edit, footer
   `created <basename>, but it isn't in the file list`.
   v1 does not preflight gitignore / Discovery Policy (#249).

Editor spawn / non-zero after a successful create: file stays selected; same footer notices as `E`.

### Feedback split

- Prompt-scoped messages (blocking validation, live warnings, create IO) live in the modal status
  slot. They clear when the input changes. No TTL on in-prompt messages. **Do not** send these
  through `pushFooterNotice` — footer notices close floating overlays (`DESIGN.md` §7.6).
- Session-scoped failures (no editor, renderer unavailable, membership timeout, editor spawn /
  non-zero) stay on the footer with the existing TTL.
- If the visual language duplicates, extract a presentational status line (`error` | `warning` +
  text) for the modal. Do not merge it with `StatusPopover`.

## Considered options

| Topic | Rejected | Why |
| --- | --- | --- |
| Keep nameless `N` beside this flow | Two New file verbs | Splits muscle memory; the prompt is the product |
| Open existing on collision | Silent “open” | New must not become `E` |
| Overwrite | Destructive | Out |
| Nested create / basename-strip | `notes/foo` surprises | First iteration is Discovery Root only |
| Allow leading-dot names | File never joins the collection by default | #247 |
| Silent filter replacement | User loses the query without notice | Advisory warning, then proceed |
| Block on filter mismatch | Cannot create `meeting.md` while filtering `readme` | Too harsh |
| Skip wait; `openInEditor(path)` | Second editor launch; may edit without selecting | Contradicts “same as `E`” |
| Keep the modal open until membership | Prompt becomes a spinner; mixes scopes | Close, then wait |
| Rewrite the input to show `.md` | Manipulates typing | Warn only when they already typed an extension |
| Put `PromptModal` in `@house/ui` now | Package is File Navigator / Sidebar, one consumer | #248 |
| Footer for validation errors | Footer closes the overlay | Split by scope |
| Scoped keymap composition | `useKeyboard` branches still readable | `DESIGN.md` §12 still deferred |

## Non-goals

- In-app editing, templates, or non-empty stubs.
- Hidden-file create (#247), nested paths, creating outside the Discovery Root.
- Discovery Policy preflight at the prompt (#249).
- Extracting `PromptModal` to `@house/ui` (#248).
- Footer hint for `N`.
- Changing default Discovery Policy.
- Windows-only name rules.

## Consequences

### Positive

- One editor launch path (`E`).
- Named files appear in the File Navigator and become the selection before edit.
- First write is a hard, testable contract (empty, exclusive, Discovery Root, `.md` only).

### Negative

- Punches a hole in `DESIGN.md` §3. Docs and the non-goal wording must be updated so the next
  agent does not “fix” the write.
- A gitignored (or otherwise policy-hidden) name can be created and then only reported after 2s
  (#249).
- Filter replacement is a visible query mutation after Enter.

### Docs to update when implementing

- `DESIGN.md` §3 (narrow write exception), §7.2 (`N` copy), §7.6 (`prompt` overlay).
- `README.md` keys table.
- `CHANGELOG.md` `[Unreleased]`: **Changed** `N`, not an added second action.
- `CONTEXT.md` already records **New file** and **Discovery Root**.

## Implementation Plan

- **Affected paths**
  - New: `apps/house/src/PromptModal.tsx` (and a tiny status-line helper if extracted)
  - New: `apps/house/src/io/createFile.ts` (exclusive empty create)
  - New: `apps/house/src/new-file/resolveName.ts` (pure resolve + warning list)
  - `apps/house/src/Browser.tsx` — overlay, keyboard branch, open/submit/wait/`E`
  - `apps/house/src/keymap/browser.ts` — `file.new` runs `openNewFilePrompt`; drop `editNewInRoot`
  - `apps/house/src/commands/buildCommands.ts` — palette title `New file…`
  - `apps/house/src/PromptRow.tsx` — reuse as the input line; do not fork
  - Tests: `apps/house/test/file-group.test.ts`, `keymap.test.ts`, new unit tests for `resolveName`
    and `createFile`, `apps/house/test/browser.test.tsx` for the modal, rewrite
    `apps/house/test/pty/editor-new-file.test.ts`
  - Docs listed above
- **Pattern to follow**: `CommandPalette` (render-only + Browser-owned keys + `floatingOverlay`);
  `pendingSelectionPathRef` + `navigator.selectPath` for post-create selection; `editCurrent` for
  the hand-off; footer notices only after the prompt is gone.
- **Pattern to avoid**: imperative Sidebar inserts; `openInEditor` without a selection; routing
  prompt errors through `pushFooterNotice`; rewriting `PromptRow`’s `query`; putting the modal in
  `packages/ui`; implementing `Keymap.scope`.
- **Dependencies**: none new. Matching can use `fuzzysort` (already in `@house/ui`) from House only
  if importing the package strategy is awkward; do not add a second fuzzy library.
- **Config**: none. Not an `@house/options` catalog key.

## Verification

- [ ] `shift+n` still dispatches `file.new` with and without a selection; plain `n` does not.
- [ ] Palette lists `New file…`; no footer hint on the binding.
- [ ] Unset `$EDITOR`/`$VISUAL`: prompt never opens; footer `set $EDITOR or $VISUAL to use N`.
- [ ] Prompt shows title `New file`, placeholder `File name`, hints `enter create  esc cancel`.
- [ ] Esc closes, restores prior focus, query and selection unchanged; input is not rewritten
      while typing.
- [ ] Enter on empty/whitespace: `name required`, stay open, no file.
- [ ] `notes/foo`, `../x`, `/tmp/x`, `foo\bar`, `.`, `..`: path error, stay open.
- [ ] `.notes` / `.md`: hidden error, stay open.
- [ ] Existing file or directory at the resolved path: `already exists`, stay open, not truncated.
- [ ] `foo` creates `foo.md` (0 bytes) at the Discovery Root; `foo.md` does not double-append;
      `foo.MD` → `foo.md`; `foo.txt` → `foo.txt.md`.
- [ ] `foo.txt` shows live `will be created as foo.txt.md`; `foo.MD` shows live
      `extension will be saved as .md`; `foo.md` shows no extension warning; `foo.` warns append.
- [ ] Active query that would hide the file: live `filter will change to <basename>`; Enter still
      creates, query becomes that basename, file is selected, then `E`.
- [ ] Query that already matches: query unchanged.
- [ ] After create, `E` runs on the new file (not the previous selection); nameless cwd launch is
      gone.
- [ ] Membership timeout: file remains, no edit, footer
      `created <basename>, but it isn't in the file list`.
- [ ] While the prompt is open, `q` types `q`; `ctrl+c` does not quit; `ctrl+p` does not open the
      palette; arrows do not move the Sidebar.
- [ ] `PromptModal` lives under `apps/house`; `@house/ui` is unchanged.
- [ ] `bun test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass.

## Revisit triggers

- #247 (hidden create), #248 (`PromptModal` in `@house/ui`), #249 (Discovery Policy preflight).
- Close-then-wait-then-`E` feels wrong in real use (flash of House, 2s miss) — then reconsider
  keeping the modal pending or editing by path.
- A second House prompt needs the same shell — extract per #248 rather than copying.
- `useKeyboard` overlay branches become hard to follow — then `DESIGN.md` §12 keymap composition.

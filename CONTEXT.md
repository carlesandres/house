# House

House is a terminal document browser whose navigation language separates filesystem-backed file
navigation from the visual region that presents navigation choices.

## Language

**File Navigator**:
A filesystem-backed navigation capability that keeps a selectable file collection synchronized with
a directory and presents it through a Sidebar.
_Avoid_: File list, Sidebar

**Sidebar**:
A visual navigation region that renders an already-prepared collection and its current selection.
_Avoid_: File Navigator, filesystem browser

**Browse Order**:
The ordering applied to a File Navigator's collection when no search query is active.
_Avoid_: Search ranking

**Search Ranking**:
The relevance-first ordering applied to files that match an active query.
_Avoid_: Browse order, filesystem sort

**File Order Strategy**:
A named policy that determines Browse Order without changing Search Ranking.
_Avoid_: Search ranker

**Discovery Root**:
The directory House walks from, and the location where a new file is created.
_Avoid_: vault, target dir, root dir

**Discovery Scope**:
The root and recursion boundary that determine which filesystem entries may belong to a File
Navigator.
_Avoid_: Search scope

**Discovery Policy**:
Caller-supplied rules that determine which files and directories may belong to a Discovery Scope.
_Avoid_: Browse order, search filter

**File Identity**:
The normalized absolute path used to retain selection and metadata for one discovered file.
_Avoid_: Display path, inode

**Search Strategy**:
A replaceable policy that matches and ranks files for an active query.
_Avoid_: File Order Strategy

**New file**:
The command that prompts for a name, creates an empty markdown file at the Discovery Root, waits for File Navigator membership, selects it, and opens it in `$EDITOR`.
_Avoid_: New note

**Rename**:
The command that changes only the basename of the selected file, keeping its parent directory unchanged.
_Avoid_: Move, relocate, retitle

**Action Target**:
The specific file captured when a destructive or identity-changing prompt opens, used for the rest of that action instead of the live selection.
_Avoid_: Current selection, focused row

**Option**:
A typed catalog entry whose initial value is resolved from CLI, env, file, or default and then held in a runtime session.
_Avoid_: Setting, config key (when meaning the live typed value), preference

**Footer control**:
A compact, clickable footer chrome chip that reflects and mutates one Option that opted into the footer.
_Avoid_: Footer hint, StatusIndicator (generic chip; a footer control may render as one), keymap hint

**Activate**:
The primary click interaction on a Footer control that toggles, cycles, or otherwise advances that Option's value.
_Avoid_: Click handler, toggle (too narrow — Activate also covers cycle)

## Relationships

- A **File Navigator** presents its current file collection through one **Sidebar**.
- A **Sidebar** does not discover or watch files.
- **Search Ranking** takes precedence over **Browse Order** while a query is active.
- A **File Order Strategy** determines **Browse Order** and may be replaced without changing the
  selected file.
- A **Discovery Scope** is bounded by one **Discovery Root**.
- A **Discovery Scope** strictly limits discovered membership; the native watcher may observe a
  broader root as long as out-of-scope events cannot populate the collection.
- A **Discovery Policy** applies consistently to initial discovery and live synchronization.
- Renaming a file replaces one **File Identity** with another; it is not an identity-preserving update.
- A **Search Strategy** determines **Search Ranking** independently of the active **File Order
  Strategy**.
- **New file** creates an empty markdown file at the **Discovery Root**; the **File Navigator** admits it as a
  **File Identity** before it can be selected and opened in `$EDITOR`.
- **Rename** replaces one **File Identity** with another in the same parent directory; it is not a **Move**.
- An **Action Target** is captured when **Rename** (and future confirmed file actions) open; submit operates on that target, not on whatever the live selection has become.
- An **Option** may opt into one **Footer control**; **Activate** advances that Option's session value.

## Example dialogue

> **Dev:** "Should the **Sidebar** rescan the directory after a file is created?"
> **Domain expert:** "No. The **File Navigator** synchronizes the collection; the **Sidebar** only presents it."

> **Dev:** "Should a recently modified weak match precede an exact filename match?"
> **Domain expert:** "No. **Search Ranking** is relevance-first; recency belongs to **Browse Order**."

> **Dev:** "If the user moves the Sidebar while the Rename prompt is open, which file gets renamed?"
> **Domain expert:** "The **Action Target** captured when the prompt opened — not the live selection."

> **Dev:** "Is the wrap `W` in the footer a keymap hint?"
> **Domain expert:** "No. It is a **Footer control** for the wrap **Option**; clicking it **Activate**s a toggle. Keymap hints are a separate footer row for essential keys."

## Flagged ambiguities

- “FileNavigator” previously named the presentation-only pane; resolved: **File Navigator** means the
  filesystem-backed capability, while **Sidebar** means its presentation surface.
- “vault” / “target dir” / “root dir” were used for the directory House opens on; resolved: that
  directory is the **Discovery Root**.
- “New note” was used for creating a markdown file there; resolved: the action is **New file**.
- “Rename” was used loosely for path changes; resolved: **Rename** is basename-only; changing parent path is **Move** (out of scope).
- “Current selection” was conflated with the file an open prompt will act on; resolved: that frozen file is the **Action Target**.

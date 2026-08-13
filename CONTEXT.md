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

## Relationships

- A **File Navigator** presents its current file collection through one **Sidebar**.
- A **Sidebar** does not discover or watch files.
- **Search Ranking** takes precedence over **Browse Order** while a query is active.
- A **File Order Strategy** determines **Browse Order** and may be replaced without changing the
  selected file.
- A **Discovery Scope** strictly limits discovered membership; the native watcher may observe a
  broader root as long as out-of-scope events cannot populate the collection.
- A **Discovery Policy** applies consistently to initial discovery and live synchronization.
- Renaming a file replaces one **File Identity** with another; it is not an identity-preserving update.
- A **Search Strategy** determines **Search Ranking** independently of the active **File Order
  Strategy**.

## Example dialogue

> **Dev:** "Should the **Sidebar** rescan the directory after a file is created?"
> **Domain expert:** "No. The **File Navigator** synchronizes the collection; the **Sidebar** only presents it."

> **Dev:** "Should a recently modified weak match precede an exact filename match?"
> **Domain expert:** "No. **Search Ranking** is relevance-first; recency belongs to **Browse Order**."

## Flagged ambiguities

- “FileNavigator” previously named the presentation-only pane; resolved: **File Navigator** means the
  filesystem-backed capability, while **Sidebar** means its presentation surface.

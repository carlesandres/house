# ⌂ house

A terminal markdown reader and navigator — themable and configurable, with a keyboard-driven modern UI. Browse a directory of `.md` files without leaving the terminal.

![house demo](tape/house.gif)

## Features

- **30+ themes** with dark and light tones
- **Responsive layout**
- **Fuzzy search** across nested folders (`.gitignore`-aware)
- **Command palette**
- **Keyboard-driven**
- **Open in browser**
- **Open in `$EDITOR`**

Requires [Bun](https://bun.sh) on `PATH`.

## Runtime requirements

- Bun: required to run `house`.
- npm install/upgrade path: Node `>=22.22.2` (Node 24 LTS recommended).

Supported on macOS and Linux; Windows is unsupported and unvalidated (see [#129](https://github.com/carlesandres/house/issues/129)).

## Install

```bash
npm install -g @carlesandres/house
# or
bun add -g @carlesandres/house
```

## Upgrade

```bash
npm i -g @carlesandres/house
# or
bun add -g @carlesandres/house
```

## Usage

```
house [path] [options]
```

By default, `house` opens the browser over the configured discovery root: the current directory, or the git root when `defaultRoot = "git"` is configured. Use `--root <dir>` to browse a specific directory.

`[path]` seeds the initial sidebar filter query. It does **not** set the discovery root; use `--root <dir>` for that.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--theme <name>` | `opencode` | Starting theme (see list below) |
| `--tone dark\|light` | `dark` | Starting tone |
| `--width <N>` | — | Cap rendered markdown width at N columns |
| `--show <list>` | `""` | Reveal normally-skipped entries; comma-separated subset of `hidden`, `gitignored`. Use `--show ""` to clear. |
| `--root <dir>` | current directory | Discovery root to walk; overrides `defaultRoot` config/env |
| `--sort <mode>` | `dirs-first` | Sidebar order: `dirs-first` or `files-first` |
| `--sidebar <mode>` | `auto` | Initial sidebar visibility: `auto`, `on`, or `off` |
| `--focus <mode>` | `filter` | Startup focus: `sidebar`, `reader`, or `filter`. `filter` opens the sidebar filter prompt immediately. |
| `--serve` | off | Serve the given path as HTML in the browser (skips TUI) |
| `--port <N>` | OS-assigned | Port for `--serve` |
| `--no-mdx` | off | Exclude `.mdx` files from discovery |
| `--no-update-check` | off | Suppress the "newer version available" check (also via `NO_UPDATE_NOTIFIER=1`) |
| `--config-path` | — | Print the resolved config-file path and exit |
| `-h`, `--help` | — | Show help and exit |
| `-v`, `--version` | — | Print version and exit |

## Configuration

house reads optional defaults from a TOML file:

```
$XDG_CONFIG_HOME/house/config.toml   (defaults to ~/.config/house/config.toml)
```

Run `house --config-path` to print the exact location.

```toml
# ~/.config/house/config.toml
theme = "tokyonight"
tone  = "dark"
mdx   = true
show  = ["hidden", "gitignored"]
focus = "filter"
defaultRoot = "cwd" # or "git"
```

Supported keys: `theme`, `tone`, `mdx`, `show`, `focus`, `defaultRoot`.

`show` is a list of normally-skipped categories to opt into. Known categories: `hidden` (dot-prefixed entries), `gitignored` (entries matched by a `.gitignore`). Default is the empty list. Hard skips (`node_modules`, `.git`, `.venv`) always apply.

Precedence, highest to lowest:

1. CLI flags (`--theme`, `--tone`, `--no-mdx`, `--show`, `--focus`, `--root`)
2. Env vars (`HOUSE_THEME`, `HOUSE_TONE`, `HOUSE_MDX`, `HOUSE_SHOW`, `HOUSE_FOCUS`, `HOUSE_DEFAULT_ROOT`)
3. Config file
4. Built-in defaults (`opencode` / `dark` / `mdx = true` / `show = []` / `focus = "filter"` / `defaultRoot = "cwd"`)

`HOUSE_SHOW` takes a comma-separated list (`HOUSE_SHOW=hidden,gitignored`). For `show` specifically, each source completely replaces the next — categories don't merge across layers. Press `shift+a` in the TUI to round-trip between the configured set and the full vocabulary without editing config.

The file is optional — a missing file is fine. Invalid keys, unknown themes, or malformed TOML fail loudly with a one-line error. Per-project config (`.house/config.toml`) and additional keys are deferred.

## Keys

### Global

| Key | Action |
|-----|--------|
| `q` / `ctrl+c` | Quit |
| `tab` | Toggle focus (sidebar ↔ reader) |
| `s` | Toggle sidebar visibility |
| `?` | Show / dismiss help overlay |
| `ctrl+p` | Command palette |
| `O` | Open current file in browser as HTML |
| `E` | Open current file in `$EDITOR` (`$VISUAL` takes precedence) |
| `t` | Next theme |
| `T` | Previous theme |
| `L` | Toggle dark / light tone |

### Sidebar

| Key | Action |
|-----|--------|
| `j` / `↓` | Move selection down |
| `k` / `↑` | Move selection up |
| `J` | Jump down 8 |
| `K` | Jump up 8 |
| `space` / `pagedown` / `ctrl+d` | Page down |
| `b` / `pageup` / `ctrl+u` | Page up |
| `g` | First file |
| `G` | Last file |
| `/` | Filter files (fuzzy match on path) |
| `A` | Toggle hidden + gitignored entries (session-only; round-trips with the configured `show`) |
| `↵` / `→` / `l` | Open file (focus reader) |

### Reader

| Key | Action |
|-----|--------|
| `esc` / `←` / `h` | Back to sidebar |
| `[` | Previous file |
| `]` | Next file |

## Themes

33 built-in themes, all sourced from the [opencode](https://github.com/anomalyco/opencode) TUI palette:

`aura` · `ayu` · `carbonfox` · `catppuccin` · `catppuccin-frappe` · `catppuccin-macchiato` · `cobalt2` · `cursor` · `dracula` · `everforest` · `flexoki` · `github` · `gruvbox` · `kanagawa` · `lucent-orng` · `material` · `matrix` · `mercury` · `monokai` · `nightowl` · `nord` · `one-dark` · `opencode` · `orng` · `osaka-jade` · `palenight` · `rosepine` · `solarized` · `synthwave84` · `tokyonight` · `vercel` · `vesper` · `zenburn`

Each theme supports dark and light tones. Cycle with `t` / `T`; toggle tone with `L`.

For the supported semantic theme tokens and their intended usage, see
[DESIGN.md §7.5](https://github.com/carlesandres/house/blob/main/DESIGN.md#75-theming).

## Inspiration

- [glow](https://github.com/charmbracelet/glow) — render markdown on the CLI, with pizzazz
- [ghui](https://github.com/kitlangton/ghui) — keyboard-driven terminal UI for GitHub pull requests
- [hunk](https://github.com/modem-dev/hunk) — review-first terminal diff viewer for agent-authored changesets
- [opencode](https://github.com/anomalyco/opencode) — terminal UI whose palette inspired house's themes

## License

MIT

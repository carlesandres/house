# house

A terminal markdown reader built on [opentui](https://github.com/anomalyco/opentui).
Point it at a directory and navigate its `.md` files without leaving the terminal.

![house demo](tape/house.gif)

Requires [Bun](https://bun.sh) on `PATH`.

## Install

```bash
npm install -g @carlesandres/house
# or
bun add -g @carlesandres/house
```

## Upgrade

```bash
npm update -g @carlesandres/house
# or
bun add -g @carlesandres/house
```

## Usage

```
house [options] <path>
```

`<path>` can be a directory (walks for `.md` files) or a single `.md` file.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--theme <name>` | `opencode` | Starting theme (see list below) |
| `--tone dark\|light` | `dark` | Starting tone |
| `--config-path` | — | Print the resolved config-file path and exit |

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
```

Precedence, highest to lowest:

1. CLI flags (`--theme`, `--tone`)
2. Env vars (`HOUSE_THEME`, `HOUSE_TONE`)
3. Config file
4. Built-in defaults (`opencode` / `dark`)

The file is optional — a missing file is fine. Invalid keys, unknown themes,
or malformed TOML fail loudly with a one-line error. Per-project config
(`.house/config.toml`) and additional keys are deferred.

## Keys

### Global

| Key | Action |
|-----|--------|
| `q` / `ctrl+c` | Quit |
| `tab` | Toggle focus (sidebar ↔ reader) |
| `s` | Toggle sidebar visibility |
| `?` | Show / dismiss help overlay |
| `o` | Open current file in browser as HTML |
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
| `↵` / `→` / `l` | Open file (focus reader) |

### Reader

| Key | Action |
|-----|--------|
| `esc` / `←` / `h` | Back to sidebar |
| `[` | Previous file |
| `]` | Next file |

## Themes

33 built-in themes, all sourced from the
[opencode](https://github.com/anomalyco/opencode) TUI palette:

`aura` · `ayu` · `carbonfox` · `catppuccin` · `catppuccin-frappe` ·
`catppuccin-macchiato` · `cobalt2` · `cursor` · `dracula` · `everforest` ·
`flexoki` · `github` · `gruvbox` · `kanagawa` · `lucent-orng` · `material` ·
`matrix` · `mercury` · `monokai` · `nightowl` · `nord` · `one-dark` ·
`opencode` · `orng` · `osaka-jade` · `palenight` · `rosepine` · `solarized` ·
`synthwave84` · `tokyonight` · `vercel` · `vesper` · `zenburn`

Each theme supports dark and light tones. Cycle with `t` / `T`; toggle tone with `L`.

## Inspiration

- [glow](https://github.com/charmbracelet/glow) — render markdown on the CLI, with pizzazz
- [ghui](https://github.com/kitlangton/ghui) — keyboard-driven terminal UI for GitHub pull requests
- [hunk](https://github.com/modem-dev/hunk) — review-first terminal diff viewer for agent-authored changesets

## License

MIT

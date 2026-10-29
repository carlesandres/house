<!--
Thanks for the contribution. A few quick checks before you submit:

- DESIGN.md §3 (non-goals) and §7.3 (reserved keys) are firm.
- For new features, the proposal already exists as an issue.
- Tests + typecheck + lint + format:check pass locally (`bun test`,
  `bun run typecheck`, `bun run lint`, `bun run format:check`).
-->

## Summary

<!-- What does this PR change, and why? Keep it short. The diff says what; you say why. -->

## Test plan

<!-- Bulleted list of what you ran / what you eyeballed. -->

- [ ] `bun test` passes
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run format:check` passes
- [ ] If TUI behavior changed: ran the binary against a real directory and looked at it
- [ ] If keymap changed: every new binding has at least one test
- [ ] If users or maintainers will notice: added a `.changeset/*.md` note (`bun run changeset`)

## Notes for the reviewer

<!-- Anything non-obvious? Trade-offs you made? Things you'd push back on if reviewed? -->

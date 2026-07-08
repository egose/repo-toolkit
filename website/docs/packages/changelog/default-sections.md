---
sidebar_label: Default Sections
sidebar_position: 6
---

# Default Sections

`@repo-toolkit/changelog` ships with a `DEFAULT_TYPES` mapping. When no
`types` option is supplied, these rules apply.

## Visible Sections

| Type       | Section                  |
| ---------- | ------------------------ |
| `feat`     | Features                 |
| `fix`      | Bug Fixes                |
| `revert`   | Reverts                  |
| `docs`     | Documentation            |
| `refactor` | Code Refactoring         |
| `perf`     | Performance Improvements |
| `build`    | Build System             |
| `e2e`      | End-to-end Testing       |

## Hidden by Default

These commit types are omitted from the changelog (via `effect: 'hidden'`):

- `fix(deps)`
- `ci`
- `chore`
- `style`
- `test`
- `release`

To surface any of them, pass a `types` array that includes the type with a
`section` and omits `effect: 'hidden'` (or sets `hidden: false`). See
[Preset Options](./preset-options) for the full `types` schema.

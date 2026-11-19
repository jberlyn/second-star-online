# Terrain Navigating

Terrain Navigating is stored for every character but has no effect. It is a hidden slot that content could use in future.

| | |
|---|---|
| Kind | Unused |
| Starting value | 1 |
| Rises from | Nothing |
| Cap | 100 |
| Medal | None |
| Counts towards | Nothing |

## How it works

Terrain Navigating is skill 16 in the stored list (`skills` in [classes.json](../../../packages/data/content/classes.json)). It is not in the skill panel, nothing raises it, and no rule reads it. It is kept so that saved characters keep the original's layout.

## Adding content

A new use for it needs a way to raise it, something that reads it, and an entry in `skillPanel` to show it; see [Meditation](meditation.md#adding-content).

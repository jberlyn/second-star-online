# Item Identification

Item Identification is stored for every character but has no effect. It is a hidden slot that content could use in future.

| | |
|---|---|
| Kind | Unused |
| Starting value | 1 |
| Rises from | Nothing |
| Cap | 100 |
| Medal | None |
| Counts towards | Nothing |

## How it works

Item Identification is in the stored skills (`skills` in [classes.json](../../../packages/data/content/classes.json)), marked `hidden`, so the Skills page leaves it out. Nothing raises it and no rule reads it. It is kept because 1.6 saved it. The Identify spell does not use it.

## Adding content

A new use for it needs a way to raise it, something that reads it, and the `hidden` mark taken off its row to show it; see [Meditation](meditation.md#adding-content).

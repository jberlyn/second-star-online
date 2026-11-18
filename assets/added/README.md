# Art and sound added to the game

Art and sounds made for Second Star Online (not from the original) go here, one folder per kind.
The asset build (`bun run assets:build`) packs them next to the originals; code and content refer
to them by name. Never edit an atlas by hand.

## Folders

| Folder | Holds | Built into |
|---|---|---|
| `tiles/` | map tiles | the `tiles` atlas (also needs a `tiles.json` row, on palette page 10, slot 50 onwards) |
| `bodies/` | monster and morph bodies | the `bodies` atlas |
| `paperdoll/` | worn-item layers | the `paperdoll` atlas |
| `fx/` | spell and effect frames (`<member>-<n>.png`, `x<member>-<n>.png` for a trail) | the `fx` atlas |
| `items/` | item pictures: bag icons and ground items | the `items` atlas |
| `sounds/` | `<name>.wav` or `<name>.mp3` | `packages/data/assets/sounds/`, listed in `index.sounds` |

An unknown folder, a file with no sidecar, a sidecar with no file, a sidecar whose `group` is not
its folder, or a sound that is not really a WAV or MP3 fails the build with the file's path.

## Sidecars

Every file has a sidecar JSON with the same name. Art:

```json
{ "group": "paperdoll", "regX": 25, "regY": 6, "key": "green", "prov": "authored", "note": "Frost Bow, south-facing walk frame 2" }
```

- `key`: `none`, `green` (0,255,0 becomes transparent), `white`, or `matte` (edge-connected white).
- `regX`, `regY`: the registration point, as for an original member.

Sound (nothing else is allowed; the channel belongs to the content row that plays it):

```json
{ "group": "sounds", "prov": "authored", "note": "Ice crack, recorded for Ice Shard" }
```

## Names

- A file's name (without `.png`, `.wav` or `.mp3`) is its sprite or sound name. It must not match
  an original member of that group (any case), and two sounds may not differ only by case.
- Code and content refer to sprites by name: a spell's FX run by its `member`, an item by its name.

## What each kind needs

- **Hit rects.** `fx`, `bodies` and `items` art gets its hit rectangle from its image size and
  registration point (1.6's `intersects` uses a member's bounding rectangle, whatever is
  transparent). Run `bun run data:build` after adding art there; `data:check` fails until you do.
- **Item icons.** An added item's catalogue row (`items.json`) has `"icon": "added"`, and its picture
  is `items/<item name>.png`. A data test fails if the file or its sidecar is missing.
- **Tiles.** A tile also needs its `tiles.json` row, and goes on palette page 10 (slot 50 onwards), then page 11 and later.
- **Sounds.** A sound is played by naming it in a content row: a spell FX run's `sounds`
  (`spells.json`), `gather.json`, or `swing.sounds` in `item-rules.json`. A data test fails if a
  content row names a sound that is not built.
- **UI art** (window pictures, house ghosts) is not added here. A UI picture is placed by
  coordinates written in client code, so new UI art comes with the code that draws it.

New art or sound that changes what players see or hear gets a `docs/differences-from-fso.md` entry.

The original art is in `../original/`, listed in `../original/usage.md`. Worked examples are in [the modding guide](../../docs/modding.md). The sidecar schema is `packages/data/schema/added-asset.ts`.

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
| `sounds/` | `<name>.wav` or `<name>.mp3` | `packages/data/assets/sounds/` (git-ignored build output that `assets:build` creates), listed in `index.sounds` |

An unknown folder, a file with no sidecar, a sidecar with no file, a sidecar whose `group` is not
its folder, or a sound that is not really a WAV or MP3 fails the build with the file's path.

## Sidecars

Every file has a sidecar JSON with the same name. Art:

```json
{ "group": "paperdoll", "regX": 25, "regY": 6, "key": "green", "prov": "authored", "note": "Frost Bow, south-facing walk frame 2" }
```

- `key`: `none`, `green` (0,255,0 becomes transparent), `white`, or `matte` (edge-connected white).
- `regX`, `regY`: the registration point, as for an original member.
- `mirrored` (optional, `true` only): the image is a north frame (`-F<n>-N`) of a paperdoll layer
  or body, drawn mirrored the way 1.6 drew its back views, and the build flips it. Leave it out
  when the art is drawn as it should look from behind. Set it on every north frame of a layer or
  body or on none; the build fails otherwise.

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
- **North frames.** 1.6 drew the paperdoll's and most bodies' back views mirrored, holding the
  weapon in the left hand; those originals are marked `"mirrored": true` in
  `../original-sidecars.json` and the build flips them (`packages/data/build/assets-lib/mirror.ts`). Draw a
  new north frame as it should look, the right hand on the viewer's right. If you start from an
  original north frame instead, keep it as it is and set `"mirrored": true`; the boot and bare-feet
  layers do. A paperdoll layer flips about the body's centre line, column 22, so keep its pixels
  within columns 0 to 44. A body flips about the centre line of its standing frame, `-F2-N`, which
  it must have.
- **Tiles.** A tile also needs its `tiles.json` row, and goes on palette page 10 (slot 50 onwards), then page 11 and later.
- **Sounds.** A sound is played by naming it in a content row: a spell FX run's `sounds`
  (`spells.json`), `gather.json`, or `swing.sounds` in `item-rules.json`. A data test fails if a
  content row names a sound that is not built.
- **UI art** (window pictures, house ghosts) is not added here. A UI picture is placed by
  coordinates written in client code, so new UI art comes with the code that draws it.

New art or sound that changes what players see or hear gets a `docs/differences-from-fso.md` entry.

## Generated art

Some added art is made by a script instead of drawn by hand. Change the script and run it again
rather than editing its output:

- `bodies/55-*` (Boat) and `bodies/56-*` (Battleship) rider frames:
  `bun packages/data/build/art/ships.ts`, then `bun run data:build`. Add `--preview <dir>` for a
  contact sheet and previews on water.
- `fx/CannonballShot*` (the Battleship's shot) and `items/CannonballBag` (the Cannonball's
  13 px icon, shown in place of the 1.6 one): `bun packages/data/build/art/cannonball.ts`, then
  `bun run data:build`. Add `--preview <dir>` for a preview sheet.

The original art is in `../original/`, listed in `../original/usage.md`. Worked examples are in [the modding guide](../../docs/modding.md). The sidecar schema is `packages/data/schema/added-asset.ts`.

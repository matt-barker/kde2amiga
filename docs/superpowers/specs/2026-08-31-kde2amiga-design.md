# kde2amiga — KDE Icon Theme → Amiga NewIcons Converter

## Purpose

A web-based tool that converts KDE icon themes (SVG and/or PNG source icons)
into Amiga NewIcons-format `.info` files, for use on a real Amiga 1200
(TF1260/68LC060, AmigaOS 3.2.3, Directory Opus 5) reached over SMB. May be
made publicly available later.

## Goals

- Convert individual icons or whole batches from a KDE theme into NewIcons
  `.info` files that render correctly under Directory Opus 5 / NewIcons-aware
  Workbench.
- Run the actual image/palette/encoding work client-side in the browser —
  no server-side image processing.
- Support tagging specific converted icons as AmigaOS-wide default icons
  (drawer, disk, tool, project, trashcan) so one icon can replace the
  fallback icon for an entire object type system-wide.
- Be simple to spin up locally now, with a documented (not yet built) path
  to Docker/Unraid hosting later.

## Non-goals (v1)

- No server-side conversion path.
- No Docker packaging (documented as future work only).
- No bulk "convert an entire theme" default — user selects which icons to
  convert.
- No manual per-icon override of the selected-state effect (one effect
  choice applies to the whole job).

## Architecture

Single static single-page app (React + Vite) plus a minimal Node/Express
server with exactly two responsibilities: serving the built static app, and
proxying "fetch icon theme by URL" requests (to work around browser CORS
restrictions — the browser cannot fetch arbitrary cross-origin zips
directly). The proxy enforces a response size cap. No other server-side
logic exists; all image decoding, quantization, effect generation, and
NewIcons encoding happens in the browser.

### Client-side modules

- **Input**: accepts a dropped/selected zip or folder, or a URL (routed
  through the proxy). Validates it looks like a KDE icon theme.
- **Theme parser**: reads the theme's directory structure and `index.theme`
  to enumerate available icons (name, category, sizes, formats present).
- **Decode**: rasterizes SVGs to bitmaps via `<canvas>` at the user-chosen
  output size; loads PNGs directly and resizes if needed.
- **Quantize**: builds one shared palette (default 256 colors, user
  configurable, capped appropriately for AGA/NewIcons) across every icon
  selected for the current job, then maps each icon's pixels onto it.
- **Selected-state generator**: derives each icon's "selected" (highlighted)
  image from its already-quantized normal image, using a user-chosen effect
  (invert / brighten / darken / tint / glow surround), so both states stay
  on the shared palette.
- **NewIcons encoder**: packs each icon's normal + selected images and
  shared palette into an Amiga `.info` file: a standard `DiskObject`
  header plus the NewIcons tooltype-encoded image data format. The exact
  byte-level encoding rules need to be researched from the NewIcons format
  spec during implementation — this is a pure byte-packing algorithm with
  no OS dependency, so it's well-suited to JS, but the spec details aren't
  pinned down yet and should be treated as a research spike in the
  implementation plan.
- **Default-icon tagging**: lets the user mark up to one converted icon per
  role (Drawer / Disk / Tool / Project / Trashcan). Tagged icons are named
  `def_drawer.info`, `def_disk.info`, `def_tool.info`, `def_project.info`,
  `def_trashcan.info` respectively and placed under a `Sys/` folder in the
  output zip, mirroring `ENVARC:Sys/`. This relies on AmigaOS's built-in
  fallback mechanism: when Workbench needs an icon for an object with no
  matching individual `.info` file, it falls back to the appropriate
  `def_*.info`, normally kept in `ENVARC:Sys/` (persisted) and copied to
  `ENV:Sys/` at boot (the live copy Workbench actually reads). Directory
  Opus 5 honors this same standard mechanism.
- **Output**: zips all generated files client-side and triggers a browser
  download; includes a short README noting that `Sys/` contents should be
  copied to both `ENVARC:Sys/` and `ENV:Sys/` to take effect immediately
  without a reboot.

## Pipeline / GUI flow

1. **Load theme** — upload a zip/folder, or paste a URL fetched via the
   proxy.
2. **Select icons** — gallery view of discovered icons with checkboxes;
   user picks which ones to convert.
3. **Configure job** — output size (single size per job, user-configurable),
   palette size, selected-state effect. Palette strategy is fixed as
   shared/global (not user-configurable).
4. **Assign special roles (optional)** — mark converted icons as
   Drawer/Disk/Tool/Project/Trashcan defaults.
5. **Convert** — runs entirely client-side; per-icon progress and a live
   preview grid (normal + selected states) as icons complete.
6. **Download** — one zip: converted `.info` files at top level, tagged
   defaults under `Sys/`, plus README.

## Error handling

- Malformed/unrecognized zip contents → clear error, no crash.
- SVGs that fail to rasterize (unsupported filters, external references) →
  skipped with a per-icon warning; rest of the batch continues.
- URL fetch failures (bad URL, non-zip response, oversized download) →
  surfaced in the UI; proxy enforces a size cap.
- Quantization/edge cases (icons with more distinct colors than fit even
  pre-quantization, fully transparent icons, degenerate tiny images) →
  handled with sane fallbacks; never aborts the whole batch.

## Testing

- Unit tests for the pure-logic pieces: quantization, NewIcons binary
  encoding (checked byte-for-byte against known-good sample `.info` files
  where obtainable), selected-state effects.
- A handful of small hand-built fixture icon themes (SVG/PNG) run through
  the full pipeline in integration tests.
- Manual verification loop: convert a small batch, copy over SMB to the
  real A1200, confirm Directory Opus 5 renders normal and selected states
  correctly, and that tagged `def_*.info` files apply as system-wide
  fallbacks. This is the real ground truth given how idiosyncratic Amiga
  icon rendering can be — automated tests can't fully substitute for it.

## Deployment (v1 scope)

Local development only: `npm run dev` / a simple Node server for local use.
Docker packaging and Unraid deployment are explicitly out of scope for v1
and left as documented future work once the tool is validated locally.

## Tech stack

- Frontend: React + Vite (TypeScript).
- Server: Node/Express (proxy + static hosting only).
- Zip creation (client-side) and SVG rasterization via `<canvas>`; specific
  quantization and zip libraries to be chosen during implementation
  planning.

## Open questions for implementation planning

- Exact NewIcons `.info` binary/tooltype-encoding format details (research
  spike).
- Which JS quantization approach/library to use for the shared palette.
- Practical palette size cap (256 is the NewIcons/AGA ceiling, but a smaller
  default may look better across a themed icon set — needs visual testing
  against the real hardware).

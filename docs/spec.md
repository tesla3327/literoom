## Detailed spec: Nuxt 4 + Nuxt UI 4 Lightroom-core workflow (local-first, hosted web app, Tauri-ready)

### One sentence

A desktop, offline-first photo culling + editing web app that works primarily in Chromium browsers using persistent folder access, supports Sony a6600 RAW + JPEG, provides non-destructive edits (basic panel + tone curve + crop/rotate/straighten + gradients), selective copy/paste, histogram with clipping indicators, and simple JPEG export with filename templating; ML subject/background masks are WebGPU-only and can be disabled until vNext.

---

# 1) Product requirements

## 1.1 Primary workflow

1. **Choose a folder** containing photos (RAW/JPEG).
2. App scans folder, generates **thumbnails** quickly and **previews** progressively.
3. User culls with **Pick** / **Reject** flags using keyboard.
4. User edits picks with:

   - Basic global adjustments
   - Tone curve
   - Crop/rotate/straighten
   - Linear and radial masks
   - Histogram with clipping indicators

5. User **copies settings** from one photo, then **pastes selectively** (checkbox groups) to one or many photos.
6. User exports selected photos to a user-chosen folder as **JPEG** with **numbering + basic templating**.

## 1.2 Non-goals (v1)

- Cloud sync, multi-device libraries, accounts
- Ratings, stars, color labels (only Pick/Reject)
- Tiling / deep zoom rendering
- Brush masking (unless added later)
- Full Lightroom-grade color profiling and lens correction (unless added later)
- Non-JPEG export formats (TIFF/PNG), printing workflows

## 1.3 Platform requirements

- **Hosted web app** (static or server-hosted) that runs entirely offline after load.
- **Desktop only** UX assumptions (keyboard, mouse/trackpad).
- **Primary browser target:** Chromium family (Chrome/Edge/Brave) with File System Access API.
- **Fallback behavior:** App may run without persistent folder access on Safari/Firefox, but persistent access is a key requirement; fallback can be explicitly limited or placed behind a “limited support” warning.

## 1.4 Future packaging target

- Architecture must be compatible with **Tauri** later:

  - isolate filesystem access behind an abstraction
  - avoid browser-only assumptions in core catalog logic
  - keep heavy compute in worker/WASM modules that can also run in Tauri

---

# 2) Core concepts and definitions

## 2.1 Asset

A single source image file located on disk:

- RAW (Sony a6600 ARW) or JPEG
- Identified by stable key (handle + metadata + hash)

## 2.2 Catalog

A persistent record of:

- which folders are included
- discovered assets
- per-asset flags (pick/reject)
- per-asset edit settings + masks
- caches (thumbnail/preview availability)
  Catalog data is stored locally (IndexedDB/OPFS) but **original files remain on disk**.

## 2.3 Thumbnail vs Preview

- **Thumbnail**: small, fast, for grid/filmstrip browsing. Must not block scrolling.
- **Preview 1x**: medium-large (default 2560 long edge) for loupe/edit view.
- **Preview 2x**: larger (default 5120 long edge) generated after 1x so initial work isn’t blocked.
  No tiling in v1.

## 2.4 Non-destructive edit model

Edits are stored as parameters and masks; they never overwrite the original file. Export produces rendered JPEGs.

---

# 3) User stories and UX requirements

## 3.1 First run onboarding

- Show a brief explanation:

  - best supported in Chromium browsers
  - why folder permission is needed
  - data stays local; originals remain on disk

- Provide a “Choose folder” primary action.

## 3.2 Folder selection & persistent access

### Requirements

- User can select a folder via File System Access API.
- App requests read access; optionally write access if sidecars are stored next to images.
- App stores folder handles to reopen catalogs without reselecting folders (Chromium).
- On app reload:

  - if permissions still granted, catalog opens automatically
  - if permissions revoked, show recovery UI (“Re-authorize folders”)

### Recovery UI

- List missing/unavailable folders
- Button to reselect/re-authorize each folder
- Clear messaging about what’s unavailable until restored

## 3.3 Import and scanning

### File discovery

- Scan folder recursively or non-recursively (choose one; default should be recursive if photographers use subfolders).
- Detect supported file types:

  - **Required:** Sony a6600 RAW (ARW), JPEG
  - Optional: DNG or additional RAW types can be added later

- For unsupported files:

  - ignore silently or show in an “Unsupported files” report panel

### Import progress

- Show:

  - number of files found
  - thumbnails generated
  - previews generated (1x and 2x)

- Allow user to start culling as soon as thumbnails exist.

### Incremental rescans

- Provide a “Rescan folder” action that:

  - finds new files
  - detects removed files
  - updates cache validity if file modified

## 3.4 Culling workflow

### Views

- **Grid view** (default): thumbnails in responsive grid
- **Loupe view**: single image large preview + filmstrip
- Filmstrip is present in Loupe and optionally in Edit

### Actions

- Flagging:

  - Pick, Reject, Clear

- Filtering:

  - All / Picks / Rejects / Unflagged

- Navigation:

  - next/prev
  - jump to next unflagged (optional but useful)

### Keyboard requirements

- `P` = Pick
- `X` = Reject
- `U` = Clear
- Arrow keys = previous/next
- `Enter` or `E` = go to Edit
- `G` = Grid, `D` = Develop/Edit style shortcuts (optional)

### Performance requirements

- Grid scrolling must remain smooth; thumbnails are lazy-loaded.
- Loupe should switch photos quickly (show cached 1x preview or temporary scaled thumbnail until ready).

## 3.5 Editing workflow

### Layout

- Center: main image preview canvas with zoom/pan
- Right panel: edit tools grouped in collapsible sections
- Left panel: histogram + clip warnings + optionally preset list later

### Tools (v1)

#### Basic global adjustments

- White balance: Temp, Tint
- Exposure
- Contrast
- Highlights
- Shadows
- Whites
- Blacks
- Vibrance
- Saturation

**Behavior**

- Slider changes update the displayed preview.
- During dragging:

  - a “draft render” may be used (faster)
  - refined render after debounce/on release

#### Histogram with clipping indicators

- Display RGB histogram (and optionally luminance overlay if desired).
- Show **highlight and shadow clipping** indicators:

  - highlight clipping: any channel above threshold
  - shadow clipping: any channel below threshold

- Provide toggles:

  - show/hide highlight clipping overlay on the preview
  - show/hide shadow clipping overlay on the preview

**Update rule**

- Histogram reflects the current edit settings and current preview pipeline (not thumbnail).
- Histogram updates should be debounced during slider drag.

#### Tone curve

- Tone curve editor UI:

  - add control point
  - drag points
  - delete point
  - reset curve

- Curve is smooth (spline-like) and produces natural transitions.
- v1 supports a composite curve; per-channel can be later.
- Must integrate with preview pipeline and histogram/clipping behavior.

#### Crop/rotate/straighten

- Crop:

  - freeform + aspect presets (e.g., Original, 1:1, 4:5, 16:9)
  - lock/unlock aspect

- Rotate:

  - slider or numeric input

- Straighten (horizon fix):

  - tool lets user draw a line along the horizon; the app computes rotation

- Optional: flip horizontal/vertical (nice to have)

**Non-destructive**

- Crop/rotate do not alter originals; applied at export.

#### Local masks (non-ML)

- Linear gradient mask:

  - position/angle
  - feather

- Radial gradient mask:

  - ellipse position/size
  - feather
  - invert option

For each mask:

- user can create, select, reorder, enable/disable, delete
- mask has its own adjustment set (subset of basic panel)
- show a mask overlay toggle in the preview

### Zoom/pan behavior (no tiling)

- Base display uses preview 1x and 2x only.
- Interaction rules:

  - zooming and panning should be immediate using UI transforms
  - after a short delay, app swaps to higher detail if available:

    - if zoom level exceeds what 1x can support, and 2x exists, switch source

- If 2x preview not ready, continue showing scaled 1x and update once ready.

### Edit persistence

- All edits persist automatically (no save button).
- Must store a versioned edit schema to support future migrations.

## 3.6 Copy/paste settings (selective)

### Copy

- “Copy settings…” action stores settings from current photo into clipboard.

### Paste

- “Paste settings…” opens a modal with checkbox groups:

  - Basic adjustments
  - Tone curve
  - Crop/transform
  - Masks (linear/radial separately; optionally “all masks”)

- User chooses what to paste.

### Apply targets

- Paste to current photo.
- Paste to selected photos in grid (multi-select supported).
- If no selection, paste applies only to current photo.

### UX details

- Show a confirmation toast/snackbar after applying to many photos.
- Provide “Clear clipboard” action (optional).

## 3.7 Export

### Export inputs

- Destination folder (user selected via folder picker)
- File naming template + numbering:

  - include original filename token
  - include sequence number token with padding
  - optionally date token (basic)

- JPEG quality slider
- Resize option:

  - none, or long-edge pixels

### Export scope

- Default: export Picks only
- Option: export current selection
- Rejects are excluded unless user explicitly includes them.

### Output behavior

- Export creates files in destination folder.
- If collision:

  - either increment number or show error with resolution (choose one; default should auto-increment)

### Progress

- Export progress dialog:

  - total count, current file, ETA not required

- On completion: open destination folder (if possible) or show path.

---

# 4) System architecture requirements

## 4.1 High-level components

- **Nuxt UI frontend**: routing, UI state, keyboard shortcuts, canvas presentation
- **Catalog service**: manages assets, handles, flags, edit state persistence, rescans
- **Render service**: communicates with worker; requests thumbs/previews/histogram
- **Worker**: performs decoding + rendering + histogram computations
- **WASM module**: Rust pipeline for image operations

## 4.2 Worker-only compute

- Heavy compute must not run on the main thread.
- UI never imports the WASM module directly (enforced).

## 4.3 Preview generation strategy

- For each asset, maintain caches:

  - thumbnail
  - preview 1x
  - preview 2x

- Generation order:

  1. thumbnail ASAP
  2. preview 1x next
  3. preview 2x only after 1x exists and system is idle or low priority

- Previews are regenerated when edits change, but:

  - use debounce/coalescing
  - avoid queue buildup during slider drag

- Maintain a “latest render wins” policy.

## 4.4 Edit pipeline correctness expectations (v1)

- Visual correctness should be “good enough” for practical editing, not necessarily Lightroom-identical.
- Sony a6600 RAW decoding should work reliably; perfect color matching is not required initially.

## 4.5 Abstractions to keep Tauri option open

- File access and persistence must be behind interfaces:

  - list directory, read file bytes, write sidecar, write export

- Avoid direct dependency on browser APIs in core domain modules.

---

# 5) Data requirements

## 5.1 Catalog persistence

Store locally:

- catalog metadata (name, folders)
- asset list (stable IDs, filenames, timestamps, metadata summary)
- flags (pick/reject)
- edit settings (versioned)
- cache keys/availability
- UI preferences (grid size, last view, preview sizes)

## 5.2 Sidecar format

- JSON
- Versioned schema
- Stored:

  - either next to image files in a dedicated hidden app folder, or in app storage if filesystem writes aren’t possible

- Contents:

  - edit parameters
  - masks
  - crop/transform
  - tone curve points
  - optional: history later

## 5.3 Template naming

Support a minimal set of tokens:

- `{orig}` original filename without extension
- `{seq}` sequence number with padding (e.g. `{seq:4}`)
- `{date}` capture date (optional)
- static text
  Example: `{orig}_{seq:4}.jpg`

---

# 6) ML features (planned, not necessarily in v1)

## 6.1 Scope

- Subject mask
- Background mask
- WebGPU-only support; no fallback path required.

## 6.2 Requirements

- ML runs in worker.
- Mask results cached per photo (at least at preview 1x resolution).
- Masks integrate into mask stack like other masks:

  - can be enabled/disabled
  - can have local adjustments

- UI communicates “WebGPU required” when unavailable.

---

# 7) Quality requirements

## 7.1 Responsiveness

- Grid: smooth scrolling, thumbnails stream in.
- Loupe: quick navigation; display something immediately (thumb scaled) then replace with preview.
- Edit: slider drag should not freeze UI; slight latency acceptable; updates coalesced.
- Zoom/pan: immediate (transform-only); improved detail once 2x available.

## 7.2 Reliability

- Catalog survives reload and offline.
- Permission recovery is clear and recoverable.
- Rescan doesn’t corrupt flags or edits.
- Export is deterministic and won’t overwrite unexpectedly.

## 7.3 Accessibility & UX basics

- Keyboard shortcuts are documented in-app (help modal).
- Focus management works (modal traps focus, shortcuts disabled when typing).
- High-contrast selection states for picked/rejected.

---

# 8) Testing and tooling requirements

## 8.1 Web testing (Nuxt/Vue)

### Unit tests (Vitest)

Required coverage areas:

- edit state schema validation + migrations
- copy/paste selection logic
- filename templating parser/renderer
- catalog indexing + filter logic (picked/rejected/unflagged)
- permission state handling logic (capability layer)

### E2E tests (Playwright)

- Use **Demo Catalog mode** (mock pipeline and file access).
- Smoke flows:

  1. open app → load demo catalog → grid displays
  2. pick/reject via keyboard → filter picks
  3. open edit → move slider → histogram updates (mocked)
  4. copy settings → paste selectively to another photo
  5. export picks → verify export list/requests (mocked)

Worker/WASM can be mocked for v1 e2e; this is explicitly acceptable.

## 8.2 Rust testing

- Unit tests for:

  - tone curve interpolation and LUT generation invariants
  - histogram binning and clipping detection
  - crop/rotate/straighten math

- Property-based tests are encouraged where they add confidence, especially for curves and histogram invariants.
- Linting and formatting:

  - formatting gate
  - clippy gate with warnings as errors

## 8.3 Linting/typechecking

- Type checking required in CI:

  - TS/Vue typecheck

- Linting required in CI:

  - ESLint

- Formatting consistency required (Prettier + rustfmt).

---

# 9) Development environment requirements

Local development must match CI to ensure consistent behavior.

## 9.1 Node.js

- **Required version:** Node.js 22+ (LTS)
- Nuxt 4 tooling (ESLint, Vitest, build tools) requires modern JS features only available in Node 22+
- Use `nvm` to manage Node versions:
  ```bash
  nvm install 22
  nvm use 22
  ```

## 9.2 Package manager

- **Required:** pnpm 9+
- Install via corepack or standalone installer:
  ```bash
  corepack enable
  corepack prepare pnpm@latest --activate
  ```

## 9.3 Rust toolchain

- **Required:** Rust stable (latest) via rustup
- The `rust-toolchain.toml` file specifies the exact toolchain
- Ensure rustup-managed toolchain is used (not system Rust):
  ```bash
  # Verify rustup is managing your Rust installation
  which rustc  # Should be ~/.cargo/bin/rustc
  rustc --version  # Should be 1.80+ (stable)
  ```
- Required components: `rustfmt`, `clippy`
- Required target: `wasm32-unknown-unknown`

## 9.4 Additional tools

- **wasm-pack:** Required for building WASM modules
  ```bash
  cargo install wasm-pack
  ```

---

# 10) CI/CD requirements (hosted project)

CI must run on every PR:

- install deps with pnpm
- lint (TS)
- typecheck (TS)
- unit tests (Vitest)
- e2e tests (Playwright) in demo mode with traces on failure
- Rust checks:

  - fmt
  - clippy
  - tests

- WASM build step to ensure Rust package stays buildable

---

# 11) Feature flags and dev modes

## 11.1 Demo Catalog mode (required)

Purpose: deterministic local dev + CI e2e.

- loads a fixed set of images and metadata from bundled assets
- uses the same UI flows but with:

  - mock file handles
  - mock render/histogram responses
  - mock export writes

## 11.2 Capability flags

- FS Access supported/unsupported
- WebGPU available/unavailable
- Worker available/unavailable (should be required)

---

# 12) Acceptance criteria checklist (v1)

A v1 build is “done” when:

- User can select a folder and the app persists access across sessions (Chromium).
- App scans folder, shows grid of thumbnails quickly.
- User can pick/reject photos via keyboard and filter by flag.
- User can open edit view and adjust basic sliders + tone curve + crop/rotate/straighten.
- Histogram renders and shows highlight/shadow clipping indicators; overlay toggles work.
- Copy settings and paste selectively (checkbox modal) works for single and multiple targets.
- Export dialog supports destination folder selection, JPEG quality, resize, and filename templating with numbering.
- App runs offline after first load and survives refresh with catalog intact.
- CI passes with lint/typecheck/unit/e2e (demo) and Rust fmt/clippy/test + wasm build.

---

If you want one more tightening pass: tell me whether folder scanning is **recursive** by default, and whether sidecars must be written **next to files** or can live **only in app storage** for v1.

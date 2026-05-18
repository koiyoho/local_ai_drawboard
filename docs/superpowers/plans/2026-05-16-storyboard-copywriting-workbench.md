# Storyboard Copywriting Workbench Implementation Record

Date: 2026-05-16
Status: Completed
Released: v0.1.10 / commit `1dbbcd8`
Manual UI review: Passed on 2026-05-18

## Goal

Build Phase 1 of the image/video workbench: platform-aware copywriting brief, structured storyboard generation, storyboard editing, and per-shot start-frame, end-frame, and video prompt generation without connecting any video model.

## Implemented Scope

- Added first-class storyboard data linked one-to-one with a board.
- Added Chinese and English short-video platform presets for Douyin, Xiaohongshu, WeChat Channels, TikTok, YouTube Shorts, and Instagram Reels.
- Added structured storyboard generation from raw copy through the configured text provider.
- Added editable storyboard shots with create, update, duplicate, delete, reorder, status, and Markdown export.
- Added per-shot prompt generation for:
  - start-frame prompt
  - end-frame prompt
  - video prompt
- Added per-shot start-frame and end-frame asset binding from the selected canvas image.
- Prompt generation now includes bound start/end frame asset context, including asset metadata and latest source generation prompt when available.
- Asset deletion clears any storyboard shot frame bindings that referenced the deleted asset.
- Markdown, JSON, and CSV storyboard exports include start/end frame asset identifiers and export-time asset lookup metadata.
- Bound frame thumbnails can open the shared asset preview and locate matching image objects on the current canvas.
- Each shot can copy a Markdown prompt package containing shot fields, bound frame assets, and start/end/video prompts.
- The shot editor shows disabled Phase 2 placeholders for start-frame and end-frame image generation without creating image jobs.
- Added the storyboard workspace tab to the board page across desktop and mobile layouts.
- Added unit, route, board payload, and smoke coverage for the storyboard workflow.

## Implemented Files

- `prisma/schema.prisma`
  - Added `StoryboardProject`, `StoryboardShot`, and `Board.storyboardProject`.
- `src/lib/platform-copywriting-presets.ts`
  - Added first-party platform copywriting and storyboard strategy presets.
- `src/lib/storyboard.ts`
  - Added schemas, normalizers, JSON parsers, prompt builders, status helpers, and reorder helpers.
- `server/routes/storyboards.ts`
  - Added storyboard project, generation, shot CRUD, prompt generation, reorder, and export routes.
- `server/app.ts`
  - Registered storyboard routes.
- `src/components/storyboard/StoryboardWorkspace.tsx`
  - Added the Phase 1 storyboard editor UI, selected-canvas-image frame binding, bound-frame preview/location actions, per-shot prompt package copy, and disabled Phase 2 frame-generation placeholders.
- `src/components/storyboard/storyboard-ui.ts`
  - Added storyboard labels and UI helper metadata.
- `src/components/BoardWorkspace.tsx`
  - Added storyboard workspace navigation and bound asset preview/location integration.
- `src/components/board-canvas/types.ts`
  - Added storyboard payload types.
- `src/app/globals.css`
  - Added storyboard layout styles and containment fixes.
- `README.md`
  - Documented the Phase 1 storyboard workbench.
- `scripts/smoke-board.mjs`
  - Added storyboard visibility, layout, frame-binding, bound asset preview/location, prompt package copy, and disabled Phase 2 placeholder smoke assertions.

## Verification Coverage

- `src/lib/storyboard.test.ts`
  - Platform presets, brief normalization, output parsing, prompt parsing, prompt instruction generation, status handling, and reorder helpers.
- `server/storyboard-routes.test.mjs`
  - Ownership checks, persistence, generated shots, shot CRUD, prompt persistence, reorder validation, and Markdown export.
- `server/board-routes.test.mjs`
  - Board payload includes formatted storyboard data without leaking raw JSON storage fields.
- `scripts/smoke-board.mjs`
  - Desktop and mobile storyboard workspace visibility, containment, mobile one-column layout, mobile six-tab single-row navigation, prompt action hierarchy, and disabled Phase 2 badge placeholders.

## Explicitly Deferred

- Video model settings.
- Video generation jobs.
- Video assets, thumbnails, preview, download, or FFmpeg/Remotion composition.
- Required first-frame/end-frame image generation.
- Direct first-frame/end-frame image generation from shot prompts.
- Frame compare/regenerate UI backed by generated image jobs.

## Follow-up Candidates

1. CSS consolidation: the current storyboard layout has both early global rules and later scoped containment rules in `src/app/globals.css`. Consolidate the duplicate blocks before adding more storyboard UI.
2. Direct frame generation: reuse existing image generation jobs to create start/end frame assets from locked prompts.
3. Frame compare/regenerate UI: add the review workflow after generated frame assets exist.
4. Video provider architecture: define a provider adapter and job lifecycle before wiring any specific model.

## Notes

The original step-by-step implementation checklist has been replaced with this record because the feature has already landed. Keeping the old unchecked task list would make the repository look as if Phase 1 still needs to be implemented.

2026-05-18 update: Phase 2A started after this Phase 1 record. Start/end frame image generation is now tracked separately in `docs/superpowers/plans/2026-05-18-storyboard-frame-generation.md`; video generation remains deferred.

# AI Matting Repair Design

**Goal**

Add a usable background-removal workflow for complex images by combining local AI matting with manual alpha-mask repair inside the current board workflow.

## Context

The current pure-color background remover is fast but fails on complex backgrounds. The newly added local AI matting path improves first-pass cutouts, but fully automatic results can still have two severe failure modes:

- the subject is partially deleted
- the background still has visible residue

These are not reliably fixable by more prompt tuning or threshold tuning alone. The system needs a repair step that lets the user correct the matte while preserving original subject colors.

## User Experience

The existing entry point stays the same:

- select an image
- right click
- choose `AI 图片 -> 删除背景`

The workflow then becomes:

1. Run local AI matting first and create a new transparent PNG asset.
2. Insert that result as a new image asset without overwriting the original.
3. Automatically enter a dedicated matting repair mode for that result.
4. Let the user repair the alpha matte with two tools:
   - `保留`: restore subject pixels that were mistakenly removed
   - `擦除`: remove leftover background pixels
5. Let the user control brush size and use undo/redo.
6. Save the repaired result as another new transparent PNG asset.

The user can also abandon repair, which keeps the AI-generated first-pass result and the original image intact.

## Core Design

### 1. AI-first, repair-second

Local AI matting remains the first step because it provides the best automatic starting point for complex backgrounds. However, the result is treated as a draft matte, not as the final output.

### 2. Repair edits alpha, not colors

Repair mode must never paint fake colors onto the result.

Instead, the system keeps:

- the original source image RGB pixels
- the AI-generated matte result alpha state

When the user repairs the matte:

- `保留` raises opacity in the selected region and restores RGB from the original source image
- `擦除` lowers opacity in the selected region toward full transparency

This guarantees that recovered pixels match the original image content instead of using approximated or synthetic colors.

### 3. Non-destructive asset flow

The workflow is intentionally additive:

- original image remains unchanged
- AI first-pass cutout is stored as a new asset
- repaired final cutout is stored as another new asset

This keeps rollback simple and avoids destructive edits to user content.

## Technical Flow

### Step A: Local AI matting

The existing remove-background route continues to:

- run local `rembg` / ONNXRuntime first
- fall back to pure-color `sharp` background removal if AI fails

This route returns a new transparent PNG asset.

### Step B: Enter repair mode

After the asset returns, the frontend opens a repair state scoped to:

- source asset id
- AI result asset id
- editable repair strokes / mask state

The repair state targets the returned cutout asset only.

### Step C: Save repaired matte

Saving the repaired result sends:

- source asset id
- AI cutout asset id
- repair brush mode (`keep` / `erase`)
- brush stroke geometry or mask raster

The backend reconstructs a final alpha channel by combining:

- the AI-generated matte
- the user repair mask

Then it composites final RGB from the original source image and writes a new transparent PNG asset.

## File-Level Design

### Frontend

`src/components/BoardWorkspace.tsx`

- extend the current remove-background flow to enter repair mode after local AI cutout creation
- add repair-mode state
- add `保留` / `擦除` brush actions
- add brush size, undo, redo, save, and cancel controls
- reuse existing canvas/overlay patterns where possible, but keep repair state logically separate from current AI edit masks

### Backend

`src/app/api/assets/[assetId]/remove-background/route.ts`

- keep existing AI-first / pure-color-fallback first-pass cutout generation

New route, likely under:

`src/app/api/assets/[assetId]/repair-background/route.ts`

- validate ownership
- load source asset and first-pass AI cutout asset
- apply repair mask to alpha channel
- preserve source RGB
- write final PNG as a new asset
- return the new asset payload

### Image Processing

New utility module, likely:

`src/lib/background-repair.ts`

Responsibilities:

- read source and cutout buffers
- derive editable alpha plane from cutout result
- apply user keep/erase repair operations
- emit final transparent PNG

This utility should stay independent from route concerns.

## Error Handling

### AI cutout failure

If local AI matting fails:

- either fall back to pure-color remover automatically
- or surface a clear failure if no fallback succeeds

The error message must make it obvious whether the result came from AI or fallback logic.

### Repair save failure

If saving fails:

- keep the current repair state in memory
- show a retryable error
- do not discard the user’s repair work

### Cancel repair

If the user cancels:

- exit repair mode
- keep the source image and first-pass AI result
- do not generate a repaired asset

## Validation Criteria

Success means the workflow is usable even when automatic cutout is imperfect.

Specifically:

- a complex-background image can be locally AI-matted without using a third-party image API
- if the first pass deletes subject areas, `保留` can restore true source pixels
- if the first pass leaves background residue, `擦除` can remove it
- saved repaired output is a true transparent PNG with alpha
- exported PNG with transparent option keeps the repaired transparency

## Scope Boundaries

Included:

- local AI matting first pass
- manual alpha repair for keep/erase
- non-destructive asset generation

Not included:

- batch repair across many images
- advanced semantic brushes beyond keep/erase
- collaborative multi-user repair sessions
- external remove-background SaaS integration

## Recommendation

Implement the repair workflow on top of the new local AI matting path instead of continuing to chase better fully automatic output. The first-pass AI cutout improves the starting point, and manual alpha repair makes the workflow reliable enough for real use on hard images.

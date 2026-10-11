# Cosmetics layers and background removal

The original blue template is the bottom background layer. Its embedded footer is excluded from that pass and restored as a separate foreground layer. Users may select the original blue background, a solid color, or transparency. Color blocks render above photos and below the selected brand logo, text and contact footer. Primary, alternate and cosmetics logos are available through existing brand permissions.

The image panel now offers background removal and undo. This sends a user-triggered paid image edit through the existing design-scene reservation and private storage flow. Image content hashes bind retries to the same original image. Only the returned alpha matte is applied to the original RGB pixels, so provider recoloring or retouching is discarded. Matte alignment and edges still require visual review. Completely opaque or effectively empty results fail instead of replacing the image. Original files are retained privately; the undo snapshot is included in the browser draft.

The generation panel also offers transparent-background generation for ordinary templates. Before/after illustrative cutouts still use their dedicated comparison prompt. Existing real/illustrative classification and other publication stages remain unchanged.

## Activation

Replace the entire existing Supabase design-scene function with supabase/functions/design-scene/index.ts and deploy updates. No new SQL is needed for this change. The monthly-budget migration remains a separate activation step.

## Validation

- before-after.cjs passed at 390 and 1280 px, including solid background pixels, color-block pixels, foreground logo priority, upload/save/atlas restoration and mocked remove/undo.
- design-editor-responsive.cjs passed six viewports, exclusive collapses, fixed preview, export and save/restore.
- design-budget.cjs passed role visibility and normal-logo priority above color blocks.
- design-scene-expansion.cjs passed mock provider tests for original RGB preservation, alpha transparency, opaque-result rejection, input validation, authenticated permissions, request identity and retries, alongside existing expansion/generation paths.
- No live Supabase write or paid provider call was performed.

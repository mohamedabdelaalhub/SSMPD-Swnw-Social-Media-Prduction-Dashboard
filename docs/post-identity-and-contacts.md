# Post identity, hook and contact data

Final publication text now uses saved hook_text, caption_text (or the legacy body/title fallback), saved CTA, and the required clinic contact fields. Existing matching text is not duplicated. The approved values come from the existing content-ai brief: phone 0236230005, WhatsApp https://wa.me/201010686264, address الجيزة، حدائق الأهرام، 45ع شارع الخزان. Both clinic brands use these contact values. No new phone or address was invented.

The design editor now initializes the headline from hook_text. Existing saved headline/layout settings take priority when reopening a saved design. Missing hooks are identified in the post preview.

The design editor shares the existing brand_logos library with videos. Primary is labeled for light backgrounds, alternate for dark backgrounds. The administrator must upload the matching artwork in those slots. The selector does not recolor or invent a logo. A selected immutable logo path and ID are saved in design version settings. Existing designs without a logo selection retain the embedded template logo. The footer is preserved when replacing the embedded upper logo. Uploaded flat images remain flat images and are not automatically rewritten.

## Activation

Run supabase/migrations/20261008_post_identity_hook_and_contacts.sql in the content dashboard Supabase project. This includes the website queue setup and can be rerun. Redeploy meta-publish-process from the full repository so its new SELECT includes brand and hook_text and it bundles the shared assets/js/publication-text.js contract. Existing website-publish-process uses the queue payload and does not require a source change for this update. Website endpoint secrets and queue schedule still need to be configured if not already activated.

Browser preview changes are deployed by GitHub Pages. Backend changes require the above activation. Local DOM, canvas and PostgreSQL tests passed for both logo variants, cross-brand rejection, footer preservation, hook initialization, required contacts, duplicate prevention, JS/SQL parity and hook-change queue updates. Actual external publication was not tested.

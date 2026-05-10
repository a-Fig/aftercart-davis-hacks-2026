-- Add 'online_pdf' to field_uploads.mode CHECK constraint so the field portal
-- can ingest exported online-inventory PDFs (Safeway shop pages, Trader Joe's
-- product listing pages, Costco warehouse pages, etc.) alongside the original
-- in-store photo modes.
--
-- Reversible: re-create the original constraint with just ('shelf_tag','wide_shot').

ALTER TABLE field_uploads DROP CONSTRAINT IF EXISTS field_uploads_mode_check;
ALTER TABLE field_uploads ADD CONSTRAINT field_uploads_mode_check
    CHECK (mode IN ('shelf_tag','wide_shot','online_pdf'));

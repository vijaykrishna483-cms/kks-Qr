-- ─── ALTER qr_codes table for new CSV structure ──────────────────────────────
-- New CSV format: email, Name, Roll No, Food Preference
-- Each person gets exactly 1 QR code.
-- We only need to ADD the roll_no column; the rest (uuid, name, email, used, food_type) stay.

ALTER TABLE qr_codes
  ADD COLUMN IF NOT EXISTS roll_no VARCHAR(50) NOT NULL DEFAULT '';

-- After running the above, update roll_no DEFAULT to NOT NULL without a default
-- (optional cleanup — run only if you want to enforce it going forward):
-- ALTER TABLE qr_codes ALTER COLUMN roll_no DROP DEFAULT;

-- To verify:
-- SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'qr_codes';

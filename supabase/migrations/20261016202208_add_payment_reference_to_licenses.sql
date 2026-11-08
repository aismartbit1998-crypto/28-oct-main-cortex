ALTER TABLE licenses ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS payment_screenshot_url text;

-- Change is_paper_mode default from true to false on bots table
ALTER TABLE bots ALTER COLUMN is_paper_mode SET DEFAULT false;

-- Optionally reset existing bots that still have the old default true
-- Only update bots where is_paper_mode = true AND was never explicitly set
-- (We skip this to avoid changing user-intentional paper bots)

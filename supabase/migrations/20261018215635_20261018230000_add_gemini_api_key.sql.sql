/*
# Add Gemini API key to api_settings
## Summary
Adds gemini_api_key column to support Google Gemini as a free-tier AI fallback.
*/
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_settings' AND column_name = 'gemini_api_key') THEN
    ALTER TABLE api_settings ADD COLUMN gemini_api_key text;
  END IF;
END $$;

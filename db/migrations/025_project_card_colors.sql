-- Optional per-project card appearance (FR: project card colors).
-- NULL = use application default styling.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS card_color text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS text_color text;

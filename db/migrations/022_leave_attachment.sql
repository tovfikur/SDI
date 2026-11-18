-- In-app leave attachments (hard copy documents): store the file reference
-- only (file id) — raw bytes live in object storage via the files service.
ALTER TABLE leave_applications ADD COLUMN attachment_file_id uuid NULL;
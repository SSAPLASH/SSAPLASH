ALTER TABLE songs ADD COLUMN cover_key varchar(300);
ALTER TABLE file_cleanup_tasks DROP CONSTRAINT file_cleanup_tasks_file_role_check;
ALTER TABLE file_cleanup_tasks ADD CONSTRAINT file_cleanup_tasks_file_role_check CHECK (file_role IN
    ('SOURCE','DRUM_STEM','ACCOMPANIMENT','SHEET_PAGE','RAW_LOG','RECORDING','STAGING','COVER'));
CREATE INDEX songs_cover_key_idx ON songs(cover_key) WHERE cover_key IS NOT NULL;

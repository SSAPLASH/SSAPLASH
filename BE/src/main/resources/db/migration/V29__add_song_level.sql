ALTER TABLE songs
    ADD COLUMN song_level varchar(12),
    ADD COLUMN level_chart_version_id bigint REFERENCES chart_versions(id) ON DELETE RESTRICT,
    ADD COLUMN level_rule_version varchar(30),
    ADD COLUMN level_duration_ms integer,
    ADD COLUMN level_legacy_fallback boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT songs_level_valid CHECK (
        (song_level IS NULL AND level_chart_version_id IS NULL AND level_rule_version IS NULL AND level_duration_ms IS NULL)
        OR (song_level IS NOT NULL AND song_level IN ('BEGINNER','INTERMEDIATE','ADVANCED') AND level_chart_version_id IS NOT NULL
            AND level_rule_version IS NOT NULL AND btrim(level_rule_version) <> '' AND level_duration_ms IS NOT NULL AND level_duration_ms > 0)
    );

UPDATE songs s SET level_legacy_fallback = true
WHERE s.status = 'READY' AND NOT EXISTS
    (SELECT 1 FROM charts c WHERE c.song_id = s.id AND c.difficulty = 'HARD');

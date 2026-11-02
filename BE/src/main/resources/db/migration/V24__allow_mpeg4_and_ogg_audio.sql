-- 기존 음원 행은 유지하고 새 오디오 MIME만 추가한다.
ALTER TABLE audio_uploads DROP CONSTRAINT audio_uploads_content_type_check;
ALTER TABLE audio_uploads ADD CONSTRAINT audio_uploads_content_type_check
    CHECK (content_type IN ('audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg'));

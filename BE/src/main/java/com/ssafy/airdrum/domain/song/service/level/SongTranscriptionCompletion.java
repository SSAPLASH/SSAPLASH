package com.ssafy.airdrum.domain.song.service.level;

import java.math.BigDecimal;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.ssafy.airdrum.domain.chart.service.generation.TranscriptionSongCompletion;

@Service
class SongTranscriptionCompletion implements TranscriptionSongCompletion {
    private final JdbcTemplate db;
    private final SongLevelService levels;

    SongTranscriptionCompletion(JdbcTemplate db, SongLevelService levels) {
        this.db = db;
        this.levels = levels;
    }

    @Override
    public void complete(long songId, BigDecimal bpm, int offsetMs, String timeSignature) {
        db.update("UPDATE songs SET status='READY',bpm=?,offset_ms=?,time_signature=?,updated_at=clock_timestamp() WHERE id=? AND deleted_at IS NULL", bpm, offsetMs, timeSignature, songId);
        levels.process(songId, true);
    }
}

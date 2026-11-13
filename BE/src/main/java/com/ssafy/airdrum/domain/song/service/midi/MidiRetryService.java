package com.ssafy.airdrum.domain.song.service.midi;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import com.ssafy.airdrum.domain.chart.exception.ChartErrorCode;
import com.ssafy.airdrum.domain.song.exception.MidiErrorCode;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStore;
import com.ssafy.airdrum.domain.song.worker.midi.MidiResynthesisSupport;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;

@Service
public class MidiRetryService {
    private final JdbcTemplate db;
    private final MidiResynthesisSupport support;

    public MidiRetryService(JdbcTemplate db, PlatformTransactionManager manager, MidiOriginalStore store) {
        this.db = db;
        this.support = new MidiResynthesisSupport(db, manager, store);
    }

    public void retry(long userId, long songId) {
        requireOwner(userId, songId);
        var source = support.lookup(songId);
        if (source == null || source.userId() != userId || !failed(songId)) {
            throw unavailable();
        }
        try {
            if (!support.hasMelody(source)) {
                throw unavailable();
            }
        } catch (BusinessException exception) {
            throw exception;
        } catch (Exception exception) {
            throw unavailable();
        }
        if (!support.enqueue(source, true)) {
            requireOwner(userId, songId);
            throw unavailable();
        }
    }

    private boolean failed(long songId) {
        var rows = db.queryForList("""
                SELECT s.accompaniment_key IS NULL AND
                  (SELECT j.status FROM midi_accompaniment_jobs j WHERE j.song_id=s.id ORDER BY j.id DESC LIMIT 1)='FAILED'
                FROM songs s WHERE s.id=? AND s.source='MIDI'
                """, Boolean.class, songId);
        return !rows.isEmpty() && Boolean.TRUE.equals(rows.getFirst());
    }

    private void requireOwner(long userId, long songId) {
        var users = db.queryForList("SELECT status FROM users WHERE id=?", String.class, userId);
        if (users.isEmpty() || !"ACTIVE".equals(users.getFirst())) {
            throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
        }
        var songs = db.queryForList("SELECT id FROM songs WHERE id=? AND owner_id=? AND deleted_at IS NULL", Long.class, songId, userId);
        if (songs.isEmpty()) {
            throw new BusinessException(ChartErrorCode.SONG_NOT_FOUND);
        }
    }

    private BusinessException unavailable() {
        return new BusinessException(MidiErrorCode.RETRY_UNAVAILABLE);
    }
}

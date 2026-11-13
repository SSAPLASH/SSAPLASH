package com.ssafy.airdrum.domain.song.worker.midi;

import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.domain.song.model.midi.MidiAccompanimentTiming;
import com.ssafy.airdrum.domain.song.repository.midi.MidiOriginalReceipts;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStore;

/** 운영 재합성과 사용자 재시도가 공유하는 원본 검증 및 큐 등록. */
public final class MidiResynthesisSupport {
    private record LockedSong(boolean deleted, String accompanimentKey) {}
    public record Source(long songId, long userId, UUID originalId, String objectKey, int sizeBytes,
                         String sha256, String timing, int durationMs) {}

    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final MidiOriginalStore store;

    public MidiResynthesisSupport(JdbcTemplate db, PlatformTransactionManager manager, MidiOriginalStore store) {
        this.db = db;
        this.tx = new TransactionTemplate(manager);
        this.tx.setTimeout(10);
        this.store = store;
    }

    public Source lookup(long songId) {
        var sources = db.query("""
                SELECT s.id,s.owner_id,o.id,o.object_key,o.size_bytes,o.sha256,v.timing::text,s.duration_ms
                FROM songs s JOIN users u ON u.id=s.owner_id
                JOIN midi_original_uploads o ON o.song_id=s.id AND o.status='ACCEPTED' AND o.user_id=s.owner_id
                JOIN charts c ON c.song_id=s.id AND c.difficulty='HARD'
                JOIN chart_versions v ON v.chart_id=c.id AND v.version=(SELECT max(v2.version) FROM chart_versions v2 WHERE v2.chart_id=c.id)
                WHERE s.id=? AND s.source='MIDI' AND s.deleted_at IS NULL AND u.status='ACTIVE'
                """, (row, rowNumber) -> new Source(row.getLong(1), row.getLong(2), row.getObject(3, UUID.class),
                    row.getString(4), row.getInt(5), row.getString(6), row.getString(7), row.getInt(8)), songId);
        return sources.isEmpty() ? null : sources.getFirst();
    }

    public boolean hasMelody(Source source) throws Exception {
        MidiOriginalReceipts.requireKey(source.userId(), source.songId(), source.originalId(), source.objectKey());
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        byte[] midi = store.get(source.objectKey(), source.sizeBytes(), source.sha256(), deadline);
        return MidiAccompanimentTiming.hasMelody(midi);
    }

    public boolean enqueue(Source source, boolean failedOnly) {
        return Boolean.TRUE.equals(tx.execute(status -> {
            var users = db.queryForList("SELECT status FROM users WHERE id=? FOR SHARE", String.class, source.userId());
            var songs = db.query("SELECT deleted_at,accompaniment_key FROM songs WHERE id=? AND owner_id=? FOR UPDATE",
                    (row, rowNumber) -> new LockedSong(row.getTimestamp(1) != null, row.getString(2)),
                    source.songId(), source.userId());
            if (users.isEmpty() || !"ACTIVE".equals(users.getFirst()) || songs.isEmpty() || songs.getFirst().deleted()) {
                return false;
            }
            var originals = db.queryForList("SELECT id FROM midi_original_uploads WHERE id=? AND song_id=? AND status='ACCEPTED' FOR UPDATE",
                    UUID.class, source.originalId(), source.songId());
            if (originals.isEmpty() || !source.equals(lookup(source.songId()))) {
                return false;
            }
            if (failedOnly) {
                if (songs.getFirst().accompanimentKey() != null) {
                    return false;
                }
                var latest = db.queryForList("SELECT status FROM midi_accompaniment_jobs WHERE song_id=? ORDER BY id DESC LIMIT 1",
                        String.class, source.songId());
                if (latest.isEmpty() || !"FAILED".equals(latest.getFirst())) {
                    return false;
                }
            }
            var inserted = db.queryForList("""
                    INSERT INTO midi_accompaniment_jobs(song_id,user_id,original_id,timing,duration_ms,status)
                    VALUES(?,?,?,?::jsonb,?,'QUEUED') ON CONFLICT DO NOTHING RETURNING id
                    """, Long.class, source.songId(), source.userId(), source.originalId(), source.timing(), source.durationMs());
            return !inserted.isEmpty();
        }));
    }
}

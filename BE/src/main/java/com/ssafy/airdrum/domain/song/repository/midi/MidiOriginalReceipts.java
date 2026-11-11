package com.ssafy.airdrum.domain.song.repository.midi;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.domain.song.exception.MidiErrorCode;
import com.ssafy.airdrum.global.error.BusinessException;

/** 원본 PUT보다 먼저 접수와 정리 근거를 확정한다. */
@Repository
public class MidiOriginalReceipts {
    public record Receipt(UUID id, long songId, String key) {}
    private final JdbcTemplate db;
    private final MidiChartRepository songs;
    private final TransactionTemplate tx;
    MidiOriginalReceipts(JdbcTemplate db, MidiChartRepository songs, PlatformTransactionManager manager) {
        this.db = db; this.songs = songs; this.tx = new TransactionTemplate(manager); this.tx.setTimeout(10);
    }
    public Receipt begin(long user, byte[] bytes, String sha) {
        return tx.execute(s -> {
            songs.requireActive(user);
            long song = db.queryForObject("SELECT nextval(pg_get_serial_sequence('songs','id'))", Long.class);
            var id = UUID.randomUUID();
            String key = "midi-original/" + user + "/" + song + "/" + id + ".mid";
            requireKey(user, song, id, key);
            db.update("""
                    INSERT INTO midi_original_uploads(id,user_id,reserved_song_id,object_key,size_bytes,sha256,status,expires_at)
                    VALUES (?,?,?,?,?,?,'RECEIVING',clock_timestamp()+interval '30 seconds')
                    """, id,user,song,key,bytes.length,sha);
            db.update("""
                    INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,midi_original_id,next_attempt_at,midi_recheck_until)
                    VALUES (?,'MIDI_ORIGINAL',?,?,clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '24 hours 30 seconds')
                    """, key,user,id);
            return new Receipt(id,song,key);
        });
    }
    /** 호출자가 회원을 먼저 잠근 동일 트랜잭션에서 실행한다. */
    public void accept(Receipt receipt, long user) {
        var rows = db.queryForList("""
                SELECT id FROM midi_original_uploads WHERE id=? AND user_id=? AND reserved_song_id=?
                AND status='RECEIVING' AND expires_at>clock_timestamp() FOR UPDATE
                """, UUID.class,receipt.id(),user,receipt.songId());
        if (rows.isEmpty()) throw new BusinessException(MidiErrorCode.STORAGE_UNAVAILABLE);
        var cleanup = db.queryForList("SELECT id FROM file_cleanup_tasks WHERE midi_original_id=? AND status='PENDING' FOR UPDATE", Long.class,receipt.id());
        if (cleanup.isEmpty()) throw new BusinessException(MidiErrorCode.STORAGE_UNAVAILABLE);
        db.update("UPDATE midi_original_uploads SET status='ACCEPTED',song_id=? WHERE id=?",receipt.songId(),receipt.id());
    }
    public void retire(Receipt receipt) {
        tx.executeWithoutResult(s -> {
            int changed = db.update("UPDATE midi_original_uploads SET status='RETIRED',retired_at=clock_timestamp() WHERE id=? AND status='RECEIVING'",receipt.id());
            if (changed > 0) db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp(),midi_recheck_until=greatest(midi_recheck_until,clock_timestamp()+interval '24 hours 30 seconds') WHERE midi_original_id=?",receipt.id());
        });
    }
    public static void requireKey(long user, long song, UUID id, String key) {
        if (!key.equals("midi-original/" + user + "/" + song + "/" + id + ".mid"))
            throw new IllegalStateException("MIDI 원본 귀속 키가 올바르지 않습니다.");
    }
}

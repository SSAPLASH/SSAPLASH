package com.ssafy.airdrum.chart.withdrawal;

import com.ssafy.airdrum.chart.asset.ChartAssetKeyPolicy;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 탈퇴 곡을 순회하며 DB 정리 등록을 별도 트랜잭션에서 처리한다. */
@Component
class SongWithdrawalCleanup {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final ChartAssetKeyPolicy keys;

    SongWithdrawalCleanup(JdbcTemplate db, PlatformTransactionManager manager, ChartAssetKeyPolicy keys) {
        this.db = db; this.keys = keys;
        this.tx = new TransactionTemplate(manager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.tx.setTimeout(10);
    }

    void processSafely(long user, long song) {
        try { tx.executeWithoutResult(status -> process(user, song)); }
        catch (RuntimeException e) { LoggerFactory.getLogger(getClass()).warn("탈퇴 곡 정리 실패 userId={} songId={} errorType={}", user, song, e.getClass().getSimpleName()); }
    }

    private void process(long user, long song) {
        var states = db.queryForList("SELECT status FROM users WHERE id=? FOR UPDATE", String.class, user);
        if (states.isEmpty() || !"WITHDRAWN".equals(states.getFirst())) return;
        var songs = db.query("SELECT accompaniment_key FROM songs WHERE id=? AND owner_id=? AND source<>'BUILTIN' FOR UPDATE", (r,n) -> new Song(r.getString(1)), song, user);
        if (songs.isEmpty()) return;
        String accompaniment = songs.getFirst().key();
        if (accompaniment != null) register(user, song, null, accompaniment);
        db.query("SELECT v.id,p->>'imageKey' FROM chart_versions v JOIN charts c ON c.id=v.chart_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.sheet_pages,'[]'::jsonb)) p WHERE c.song_id=?", r -> {
            register(user, song, r.getLong(1), r.getString(2));
        }, song);
        db.update("UPDATE songs SET deleted_at=coalesce(deleted_at,clock_timestamp()), updated_at=CASE WHEN deleted_at IS NULL THEN clock_timestamp() ELSE updated_at END WHERE id=?", song);
    }
    private record Song(String key) {}

    private void register(long user, long song, Long version, String key) {
        try {
            if (version == null) keys.accompaniment(song, key); else keys.sheet(version, key);
        } catch (IllegalStateException e) {
            LoggerFactory.getLogger(getClass()).warn("탈퇴 곡의 자산 귀속 오류 userId={} songId={} versionId={}", user, song, version);
            return;
        }
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES (?,?,?) ON CONFLICT(object_key) DO NOTHING", key, version == null ? "ACCOMPANIMENT" : "SHEET_PAGE", user);
    }
}

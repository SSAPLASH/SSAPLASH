package com.ssafy.airdrum.domain.song.service.management;

import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 탈퇴 곡을 순회하며 DB 정리 등록을 별도 트랜잭션에서 처리한다. */
@Component
public class SongWithdrawalCleanup {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final SongAssetCleanup assets;

    SongWithdrawalCleanup(JdbcTemplate db, PlatformTransactionManager manager, SongAssetCleanup assets) {
        this.db = db; this.assets = assets;
        this.tx = new TransactionTemplate(manager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.tx.setTimeout(10);
    }

    public void processSafely(long user, long song) {
        try { tx.executeWithoutResult(status -> process(user, song)); }
        catch (RuntimeException e) { LoggerFactory.getLogger(getClass()).warn("탈퇴 곡 정리 실패 userId={} songId={} errorType={}", user, song, e.getClass().getSimpleName()); }
    }

    private void process(long user, long song) {
        var states = db.queryForList("SELECT status FROM users WHERE id=? FOR UPDATE", String.class, user);
        if (states.isEmpty() || !"WITHDRAWN".equals(states.getFirst())) return;
        var songs = db.query("SELECT accompaniment_key,cover_key FROM songs WHERE id=? AND owner_id=? AND source<>'BUILTIN' FOR UPDATE", (r,n) -> new Song(r.getString(1),r.getString(2)), song, user);
        if (songs.isEmpty()) return;
        var row=songs.getFirst();
        assets.registerAll(user,song,row.accompaniment(),row.cover());
        db.update("UPDATE songs SET deleted_at=coalesce(deleted_at,clock_timestamp()), updated_at=CASE WHEN deleted_at IS NULL THEN clock_timestamp() ELSE updated_at END WHERE id=?", song);
    }
    private record Song(String accompaniment,String cover) {}
}

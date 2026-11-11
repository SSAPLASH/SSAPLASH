package com.ssafy.airdrum.domain.song.scheduler;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.domain.song.service.management.SongWithdrawalCleanup;

/** 모든 탈퇴 곡을 ID 순서로 제한된 단위로 반복 확인한다. */
@Component
public class SongWithdrawalRecovery {
    private final JdbcTemplate db;
    private final SongWithdrawalCleanup cleanup;
    private long cursor;
    SongWithdrawalRecovery(JdbcTemplate db, SongWithdrawalCleanup cleanup) { this.db=db; this.cleanup=cleanup; }
    @Scheduled(fixedDelayString="${chart.withdrawal.recovery-interval-ms:60000}")
    public synchronized void recover() {
        var rows=db.query("SELECT s.id,s.owner_id FROM songs s JOIN users u ON u.id=s.owner_id WHERE u.status='WITHDRAWN' AND s.source<>'BUILTIN' AND s.id>? ORDER BY s.id LIMIT 100",(r,n)->new long[]{r.getLong(1),r.getLong(2)},cursor);
        for (var row:rows) { cleanup.processSafely(row[1],row[0]); cursor=row[0]; }
        if (rows.size()<100) cursor=0;
    }
}

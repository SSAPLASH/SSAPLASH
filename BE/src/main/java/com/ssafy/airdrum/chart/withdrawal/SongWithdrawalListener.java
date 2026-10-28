package com.ssafy.airdrum.chart.withdrawal;

import com.ssafy.airdrum.user.UserWithdrawnEvent;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
class SongWithdrawalListener {
    private final JdbcTemplate db;
    private final SongWithdrawalCleanup cleanup;
    SongWithdrawalListener(JdbcTemplate db, SongWithdrawalCleanup cleanup) { this.db=db; this.cleanup=cleanup; }
    @TransactionalEventListener(phase=TransactionPhase.AFTER_COMMIT)
    void withdrawn(UserWithdrawnEvent event) {
        try {
            long cursor=0;
            while (true) {
                var ids=db.queryForList("SELECT id FROM songs WHERE owner_id=? AND source<>'BUILTIN' AND id>? ORDER BY id LIMIT 100",Long.class,event.userId(),cursor);
                for (long id:ids) { cleanup.processSafely(event.userId(),id); cursor=id; }
                if (ids.size()<100) return;
            }
        } catch (RuntimeException e) {
            LoggerFactory.getLogger(getClass()).warn("탈퇴 곡 목록 정리 지연 userId={} errorType={}",event.userId(),e.getClass().getSimpleName());
        }
    }
}

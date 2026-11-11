package com.ssafy.airdrum.domain.sheet.event;

import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import com.ssafy.airdrum.domain.sheet.scheduler.SheetCleanup;
import com.ssafy.airdrum.domain.user.event.UserWithdrawnEvent;

/**
 * 탈퇴 커밋 뒤 그 회원의 모든 악보 파일을 정리 큐에 등록한다. 실패해도 정리 작업자의 보호 조건이 탈퇴 회원 파일을
 * 지키지 않으므로 노출되지는 않고, 파일이 저장소에 남을 뿐이다.
 */
@Component
class SheetWithdrawalListener {
	private final JdbcTemplate db;
	private final SheetCleanup cleanup;

	SheetWithdrawalListener(JdbcTemplate db, SheetCleanup cleanup) {
		this.db = db;
		this.cleanup = cleanup;
	}

	@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
	void withdrawn(UserWithdrawnEvent event) {
		try {
			long cursor = 0;
			while (true) {
				var ids = db.queryForList("SELECT id FROM sheet_music WHERE owner_id=? AND id>? ORDER BY id LIMIT 100", Long.class, event.userId(), cursor);
				for (long id : ids) {
					cleanup.sheet(event.userId(), id);
					cursor = id;
				}
				if (ids.size() < 100) return;
			}
		} catch (RuntimeException e) {
			LoggerFactory.getLogger(getClass()).warn("탈퇴 악보 정리 등록 지연 userId={} errorType={}", event.userId(), e.getClass().getSimpleName());
		}
	}
}

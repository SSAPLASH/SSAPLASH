package com.ssafy.airdrum.withdrawal;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 탈퇴 회원의 연주 세션을 동의 여부와 관계없이 지운다(229). 남는 것은 이미 MLflow 보정 기록에 반영된 익명 집계뿐이다.
 *
 * <p>세션마다 타격 행이 많아 15초 제한이 있는 탈퇴 트랜잭션에서 지우지 않고, 주기마다 묶음으로 지운다. 대상을 이벤트가 아니라
 * 회원 상태로 찾아서 놓친 이벤트, 탈퇴 직후 도착한 업로드, 복원된 세션을 한 경로로 처리한다. {@code hits}·{@code reports}는
 * cascade로 지워지고, {@code play_raw_uploads}는 세션 참조만 NULL이 되어 {@code RawLogCleanupWorker}가 원본 객체를 회수한다.
 */
@Component
public class WithdrawnPlayCleanup {

	private static final Logger log = LoggerFactory.getLogger(WithdrawnPlayCleanup.class);

	/** 한 주기의 묶음 수 상한. 남으면 다음 주기에 이어서 지운다. */
	static final int MAX_BATCHES = 50;

	private final JdbcTemplate db;
	private final TransactionTemplate tx;
	private final boolean enabled;
	private final int batchSize;

	public WithdrawnPlayCleanup(JdbcTemplate db, PlatformTransactionManager manager,
			@Value("${play.withdrawn-cleanup.enabled:true}") boolean enabled,
			@Value("${play.withdrawn-cleanup.batch-size:20}") int batchSize) {
		this.db = db;
		this.tx = new TransactionTemplate(manager);
		this.tx.setTimeout(30);
		this.enabled = enabled;
		this.batchSize = Math.max(1, batchSize);
	}

	@Scheduled(fixedDelayString = "${play.withdrawn-cleanup.interval-ms:60000}",
			initialDelayString = "${play.withdrawn-cleanup.interval-ms:60000}")
	public void scheduled() {
		if (!enabled) return;
		try {
			int deleted = runOnce();
			if (deleted > 0) log.info("탈퇴 회원 연주 세션 삭제 {}건", deleted);
		} catch (RuntimeException ex) {
			log.warn("탈퇴 회원 연주 세션 삭제 실패. 다음 주기에 재시도합니다 errorType={}", ex.getClass().getSimpleName());
		}
	}

	/** 지운 세션 수를 돌려준다. 묶음이 차지 않으면 남은 세션이 없다는 뜻이라 멈춘다. */
	public int runOnce() {
		int total = 0;
		for (int i = 0; i < MAX_BATCHES; i++) {
			int deleted = deleteBatch();
			total += deleted;
			if (deleted < batchSize) break;
		}
		return total;
	}

	private int deleteBatch() {
		Integer deleted = tx.execute(status -> db.update("""
				DELETE FROM play_sessions WHERE id IN (
				  SELECT p.id FROM play_sessions p JOIN users u ON u.id = p.user_id
				  WHERE u.status = 'WITHDRAWN' LIMIT ? FOR UPDATE OF p SKIP LOCKED)
				""", batchSize));
		return deleted == null ? 0 : deleted;
	}

}

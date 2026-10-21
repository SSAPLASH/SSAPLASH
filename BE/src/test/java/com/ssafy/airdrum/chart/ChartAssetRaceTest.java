package com.ssafy.airdrum.chart;

import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.chart.asset.ChartAssetService;
import com.ssafy.airdrum.chart.asset.ChartAssetStore;
import com.ssafy.airdrum.common.error.BusinessException;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 테스트 자체에 트랜잭션을 두지 않아 다른 스레드의 변경 커밋을 최종 권한 조회가 확인한다. */
@SpringBootTest
class ChartAssetRaceTest {
	@Autowired ChartAssetService service;
	@Autowired JdbcTemplate db;
	@Autowired PlatformTransactionManager transactions;
	@MockitoBean ChartAssetStore store;
	long user, song, version;
	@BeforeEach void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES ('경합 테스트') RETURNING id", Long.class);
		song = db.queryForObject("INSERT INTO songs(owner_id,title,source,status) VALUES (?,'경합 테스트','AUDIO','READY') RETURNING id", Long.class, user);
		long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES (?,'EASY') RETURNING id", Long.class, song);
		version = db.queryForObject("INSERT INTO chart_versions(chart_id,version,notes,timing,note_count,generator,notation_status) VALUES (?,1,CAST(? AS jsonb),CAST(? AS jsonb),1,'MANUAL','PENDING') RETURNING id",
				Long.class, chart, ChartQueryApiTest.NOTES, ChartQueryApiTest.TIMING);
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", "accompaniment/" + song + ".wav", song);
	}
	@AfterEach void clean() {
		// V2는 RESTRICT이므로 이 테스트가 생성한 버전 → 채보 → 곡 순서로만 지운다.
		if (song != 0) {
			db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)", song);
			db.update("DELETE FROM charts WHERE song_id=?", song);
			db.update("DELETE FROM songs WHERE id=?", song);
		}
		if (user != 0) db.update("DELETE FROM users WHERE id=?", user);
	}
	@Test void committedWithdrawalDuringStorageCallRejectsResponse() throws Exception {
		race(() -> db.update("UPDATE users SET status='WITHDRAWN', withdrawn_at=now() WHERE id=?", user), "UNAUTHORIZED");
	}
	@Test void committedSongDeletionDuringStorageCallRejectsResponse() throws Exception {
		race(() -> db.update("UPDATE songs SET deleted_at=now() WHERE id=?", song), "CHART_VERSION_NOT_FOUND");
	}
	void race(Runnable mutation, String expectedCode) throws Exception {
		var signing = new CountDownLatch(1);
		var committed = new CountDownLatch(1);
		when(store.sign(any(), anyString())).thenAnswer(call -> {
			assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
			signing.countDown();
			assertThat(committed.await(10, TimeUnit.SECONDS)).isTrue();
			return new ChartAssetStore.SignedAsset("https://asset.test/private", Instant.now().plusSeconds(600));
		});
		try (var executor = Executors.newSingleThreadExecutor()) {
			var response = executor.submit(() -> service.assets(user, version));
			try {
				assertThat(signing.await(10, TimeUnit.SECONDS)).isTrue();
				new TransactionTemplate(transactions).executeWithoutResult(status -> mutation.run());
			} finally { committed.countDown(); }
			assertThatThrownBy(() -> response.get(10, TimeUnit.SECONDS)).cause()
					.isInstanceOfSatisfying(BusinessException.class,
							ex -> assertThat(ex.getErrorCode().code()).isEqualTo(expectedCode));
		}
	}
}

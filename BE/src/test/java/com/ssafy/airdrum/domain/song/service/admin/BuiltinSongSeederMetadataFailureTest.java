package com.ssafy.airdrum.domain.song.service.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;

import java.io.InputStream;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import com.ssafy.airdrum.domain.song.service.admin.BuiltinSongSeeder.Outcome;
import com.ssafy.airdrum.domain.song.model.SongMetadata;
import com.ssafy.airdrum.domain.song.repository.SongMetadataRepository;

/**
 * 255번 설계 4-1절: 메타데이터 저장이 실패하면 그 곡만 FAILED이고 곡·채보는 남으며 다음 곡은 계속 처리한다.
 * 저장소를 가짜로 바꾸므로 BuiltinSongSeederTest와 컨텍스트를 나눈다.
 */
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "auth.refresh-token.store=memory", "chart.worker.cleanup-interval-ms=86400000"})
class BuiltinSongSeederMetadataFailureTest {

	static final SongMetadata BROKEN = new SongMetadata("ROCK", List.of(), List.of(), 1, null, null, List.of(), "HUMAN", null);
	static final SongMetadata OK = new SongMetadata("POP", List.of(), List.of(), 2, null, null, List.of(), "HUMAN", null);

	@Autowired BuiltinSongSeeder seeder;
	@Autowired JdbcTemplate db;
	@MockitoBean SongMetadataRepository metadata;
	final String prefix = "메타실패검사-" + UUID.randomUUID().toString().substring(0, 8) + "-";

	@AfterEach
	void clean() {
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE title LIKE ?", prefix + "%");
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title LIKE ?)", prefix + "%");
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE title LIKE ?)", prefix + "%");
		db.update("DELETE FROM songs WHERE title LIKE ?", prefix + "%");
	}

	static byte[] midi() throws Exception {
		try (InputStream in = BuiltinSongSeederMetadataFailureTest.class.getResourceAsStream("/builtin-songs-test/midi/test-8beat.mid")) {
			return in.readAllBytes();
		}
	}

	BuiltinSongCatalog.Entry entry(String title, SongMetadata meta) throws Exception {
		return new BuiltinSongCatalog.Entry(prefix + title, null, "자작 (테스트)", true, midi(), 0, meta);
	}

	@Test
	void 메타데이터_저장이_실패하면_그_곡만_FAILED이고_곡과_채보는_남고_다음_곡은_계속한다() throws Exception {
		doThrow(new DataAccessResourceFailureException("메타 저장 실패(테스트)")).when(metadata).upsert(anyLong(), eq(BROKEN));
		var broken = entry("실패 곡", BROKEN);
		var next = entry("다음 곡", OK);

		var result = seeder.seed(List.of(broken, next));

		assertThat(result).containsEntry(broken.title(), Outcome.FAILED).containsEntry(next.title(), Outcome.REGISTERED);
		long id = db.queryForObject("SELECT id FROM songs WHERE title=? AND deleted_at IS NULL", Long.class, broken.title());
		assertThat(db.queryForObject("SELECT count(*) FROM charts WHERE song_id=?", Integer.class, id)).isEqualTo(3);

		// 다음 시작에서 곡은 이미 3난이도라 건너뛰는 경로로 가지만, 메타 실패는 여전히 FAILED로 드러난다.
		assertThat(seeder.seed(List.of(broken))).containsEntry(broken.title(), Outcome.FAILED);
	}
}

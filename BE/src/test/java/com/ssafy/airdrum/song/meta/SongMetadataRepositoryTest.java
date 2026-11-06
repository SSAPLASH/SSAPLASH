package com.ssafy.airdrum.song.meta;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.ssafy.airdrum.song.SongLevelService;

/** 255번 설계 3-2·3-3·3-6절: song_metadata 저장·조회와 AI 배치 뷰 recommend_song_meta_v. */
@SpringBootTest(properties = { "spring.datasource.hikari.schema=public" })
class SongMetadataRepositoryTest {

	@Autowired JdbcTemplate db;
	@Autowired SongMetadataRepository repository;
	@Autowired SongLevelService levels;
	@Autowired PlatformTransactionManager manager;
	long published, hidden;

	@BeforeEach
	void setup() {
		published = song("meta-test-published", true);
		hidden = song("meta-test-hidden", false);
		for (long id : new long[] { published, hidden }) new TransactionTemplate(manager).executeWithoutResult(s -> levels.process(id, true));
	}

	/** 뷰는 공개·READY·난이도 산정 완료 곡만 내므로 HARD 채보를 넣고 난이도를 산정한다. */
	private long song(String title, boolean isPublished) {
		long id = db.queryForObject("INSERT INTO songs(title,source,status,duration_ms,license,bpm,time_signature,published) VALUES(?,'BUILTIN','READY',8000,'CC0',120,'4/4',?) RETURNING id",
				Long.class, title, isPublished);
		long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'HARD') RETURNING id", Long.class, id);
		db.update("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,?::jsonb,?::jsonb,'READY',2,'MANUAL')", chart,
				"[{\"noteId\":\"n0\",\"timeMs\":0,\"pad\":\"KICK\"},{\"noteId\":\"n1\",\"timeMs\":500,\"pad\":\"SNARE\"}]",
				"{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\"}");
		return id;
	}

	@AfterEach
	void clean() {
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE title LIKE 'meta-test-%'");
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title LIKE 'meta-test-%')");
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'meta-test-%')");
		db.update("DELETE FROM songs WHERE title LIKE 'meta-test-%'"); // song_metadata는 CASCADE
	}

	@Test
	void upsert는_넣고_다시_부르면_모든_값을_덮어쓴다() {
		repository.upsert(published, SongMetadataTest.valid());
		assertThat(repository.findBySongIds(List.of(published))).containsEntry(published, SongMetadataTest.valid());

		var changed = new SongMetadata("ROCK", null, List.of("UPLIFTING"), null, null, null, null, "HUMAN", null);
		repository.upsert(published, changed);
		assertThat(repository.findBySongIds(List.of(published, hidden))).isEqualTo(Map.of(published, changed));
	}

	@Test
	void delete는_행을_지우고_없는_곡이어도_오류가_없다() {
		repository.upsert(published, SongMetadataTest.valid());
		repository.delete(published);
		repository.delete(published);
		assertThat(repository.findBySongIds(List.of(published))).isEmpty();
		assertThat(repository.findBySongIds(List.of())).isEmpty();
	}

	@Test
	void 뷰는_AI_로더와_같은_열을_내고_여러_값은_세미콜론으로_잇는다() {
		repository.upsert(published, SongMetadataTest.valid());
		repository.upsert(hidden, SongMetadataTest.valid());
		var columns = db.queryForList("SELECT column_name FROM information_schema.columns WHERE table_name='recommend_song_meta_v' ORDER BY ordinal_position", String.class);
		assertThat(columns).containsExactly("song_id", "genre", "sub_genres", "mood", "energy", "language", "drum_style", "release_year");

		var rows = db.queryForList("SELECT * FROM recommend_song_meta_v WHERE song_id IN (?,?)", published, hidden);
		assertThat(rows).hasSize(1); // 비공개 곡은 빠진다
		var row = rows.getFirst();
		assertThat(((Number) row.get("song_id")).longValue()).isEqualTo(published);
		assertThat(row.get("genre")).isEqualTo("METAL");
		assertThat(row.get("sub_genres")).isEqualTo("ROCK");
		assertThat(row.get("mood")).isEqualTo("DARK;ENERGETIC");
		assertThat(((Number) row.get("energy")).intValue()).isEqualTo(4);
		assertThat(row.get("language")).isEqualTo("EN");
		assertThat(row.get("drum_style")).isEqualTo("DOUBLE_KICK");
		assertThat(((Number) row.get("release_year")).intValue()).isEqualTo(2013);
	}

	@Test
	void 빈_목록과_없는_값은_빈_문자열과_NULL이다() {
		repository.upsert(published, new SongMetadata("PRACTICE", null, null, null, null, null, null, "HUMAN", null));
		var row = db.queryForMap("SELECT * FROM recommend_song_meta_v WHERE song_id=?", published);
		assertThat(row.get("sub_genres")).isEqualTo("");
		assertThat(row.get("mood")).isEqualTo("");
		assertThat(row.get("drum_style")).isEqualTo("");
		assertThat(row.get("energy")).isNull();
		assertThat(row.get("language")).isNull();
		assertThat(row.get("release_year")).isNull();
	}

	@Test
	void 지운_곡은_뷰에서_빠진다() {
		repository.upsert(published, SongMetadataTest.valid());
		db.update("UPDATE songs SET deleted_at=now() WHERE id=?", published);
		assertThat(db.queryForObject("SELECT count(*) FROM recommend_song_meta_v WHERE song_id=?", Integer.class, published)).isZero();
	}

	@Test
	void 내보내기_역할은_뷰만_읽고_원본_테이블은_못_읽는다() {
		assertThat(db.queryForObject("SELECT has_table_privilege('recommend_export_reader','recommend_song_meta_v','SELECT')", Boolean.class)).isTrue();
		assertThat(db.queryForObject("SELECT has_table_privilege('recommend_export_reader','song_metadata','SELECT')", Boolean.class)).isFalse();

		// AI 배치처럼 그 역할로 실제로 읽는다(중첩 뷰 recommend_songs_v 권한까지 확인). SET LOCAL이라 트랜잭션이 끝나면 돌아온다.
		repository.upsert(published, SongMetadataTest.valid());
		var tx = new TransactionTemplate(manager);
		Integer rows = tx.execute(s -> {
			db.execute("SET LOCAL ROLE recommend_export_reader");
			return db.queryForObject("SELECT count(*) FROM recommend_song_meta_v WHERE song_id=?", Integer.class, published);
		});
		assertThat(rows).isEqualTo(1);
		assertThatThrownBy(() -> tx.executeWithoutResult(s -> {
			db.execute("SET LOCAL ROLE recommend_export_reader");
			db.queryForObject("SELECT count(*) FROM song_metadata", Integer.class);
		})).isInstanceOfSatisfying(org.springframework.dao.DataAccessException.class,
				e -> assertThat(e.getMostSpecificCause().getMessage()).contains("song_metadata"));
	}

	@Test
	void DB_제약이_값_목록과_개수를_막는다() {
		assertThatThrownBy(() -> db.update("INSERT INTO song_metadata(song_id,genre,source,updated_at) VALUES(?, 'ROCKS','HUMAN',now())", published))
				.isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> db.update("INSERT INTO song_metadata(song_id,genre,mood,source,updated_at) VALUES(?, 'ROCK','{CALM,DARK,UPLIFTING}','HUMAN',now())", published))
				.isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> db.update("INSERT INTO song_metadata(song_id,genre,drum_style,source,updated_at) VALUES(?, 'ROCK','{BLAST_BEAT}','HUMAN',now())", published))
				.isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> db.update("INSERT INTO song_metadata(song_id,genre,source,updated_at) VALUES(?, 'ROCK','EXTERNAL_DB',now())", published))
				.isInstanceOf(DataIntegrityViolationException.class);
	}
}

package com.ssafy.airdrum.recording;

import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 256번 설계 3-1절: V27 recordings 타격 시퀀스 컬럼과 제약. */
// 마이그레이션 테스트가 풀 연결의 search_path를 바꿔 둘 수 있어 SheetMusicSchemaTest와 같은 격리 컨텍스트를 쓴다.
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "auth.refresh-token.store=memory", "chart.worker.cleanup-interval-ms=86400000"})
class RecordingSchemaTest {

	private static final String HASH = "a".repeat(64);
	private static final String HITS = "[{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":90},{\"tMs\":250.5,\"pad\":\"KICK\",\"velocity\":100}]";

	@Autowired JdbcTemplate db;
	long user, other;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('녹음 스키마 회원') RETURNING id", Long.class);
		other = db.queryForObject("INSERT INTO users(nickname) VALUES('녹음 스키마 다른 회원') RETURNING id", Long.class);
	}

	@AfterEach
	void clean() {
		db.update("DELETE FROM recordings WHERE user_id IN (?,?)", user, other);
		db.update("DELETE FROM play_sessions WHERE user_id IN (?,?)", user, other);
		db.update("DELETE FROM users WHERE id IN (?,?)", user, other);
	}

	@Test
	void 타격_시퀀스와_메타데이터를_저장한다() {
		long id = insert(user, UUID.randomUUID(), "FREE", "STICK", 2, HITS, 300, HASH);
		var row = db.queryForMap("SELECT mode,input_source,schema_version,hit_count,jsonb_array_length(hits) AS len,duration_ms,payload_hash,"
				+ "updated_at IS NOT NULL AS has_updated,deleted_at IS NULL AS live,midi_key IS NULL AS no_midi FROM recordings WHERE id=?", id);
		assertThat(row).containsEntry("mode", "FREE").containsEntry("input_source", "STICK").containsEntry("schema_version", 1)
				.containsEntry("hit_count", 2).containsEntry("len", 2).containsEntry("duration_ms", 300).containsEntry("payload_hash", HASH)
				.containsEntry("has_updated", true).containsEntry("live", true).containsEntry("no_midi", true);
	}

	@Test
	void 네_모드와_두_입력원을_받는다() {
		for (String mode : new String[] {"RHYTHM", "FREE", "TEMPO", "SHEET"})
			insert(user, UUID.randomUUID(), mode, "KEYBOARD", 2, HITS, 300, HASH);
		assertThat(db.queryForObject("SELECT count(*) FROM recordings WHERE user_id=?", Integer.class, user)).isEqualTo(4);
	}

	@Test
	void 잘못된_값은_CHECK로_막는다() {
		String one = "[{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":1}]";
		assertThatThrownBy(() -> insert(user, UUID.randomUUID(), "LIVE", "STICK", 2, HITS, 300, HASH)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insert(user, UUID.randomUUID(), "FREE", "MOUSE", 2, HITS, 300, HASH)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insert(user, UUID.randomUUID(), "FREE", "STICK", 0, "[]", 300, HASH)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insert(user, UUID.randomUUID(), "FREE", "STICK", 3, HITS, 300, HASH)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insert(user, UUID.randomUUID(), "FREE", "STICK", 1, "{\"tMs\":0}", 300, HASH)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insert(user, UUID.randomUUID(), "FREE", "STICK", 1, one, 300, "A".repeat(64))).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insert(user, UUID.randomUUID(), "FREE", "STICK", 1, one, -1, HASH)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> db.update("INSERT INTO recordings(user_id,title,client_key,mode,input_source,schema_version,started_at,duration_ms,hit_count,hits,payload_hash) "
				+ "VALUES(?,'녹음',?,'FREE','STICK',0,now(),1,1,?::jsonb,?)", user, UUID.randomUUID(), one, HASH)).isInstanceOf(DataIntegrityViolationException.class);
		// 새 컬럼은 모두 필수다. 예전처럼 user_id·title만으로는 저장되지 않는다.
		assertThatThrownBy(() -> db.update("INSERT INTO recordings(user_id,title) VALUES(?,'예전 형식')", user)).isInstanceOf(DataIntegrityViolationException.class);
	}

	@Test
	void 타격은_50000개까지만_허용한다() {
		assertThatThrownBy(() -> db.update("INSERT INTO recordings(user_id,title,client_key,mode,input_source,schema_version,started_at,duration_ms,hit_count,hits,payload_hash) "
				+ "SELECT ?,'큰 녹음',?,'FREE','STICK',1,now(),1,50001,jsonb_agg(jsonb_build_object('tMs',0,'pad','SNARE','velocity',1)),? FROM generate_series(1,50001)",
				user, UUID.randomUUID(), HASH)).isInstanceOf(DataIntegrityViolationException.class);
		db.update("INSERT INTO recordings(user_id,title,client_key,mode,input_source,schema_version,started_at,duration_ms,hit_count,hits,payload_hash) "
				+ "SELECT ?,'최대 녹음',?,'FREE','STICK',1,now(),1,50000,jsonb_agg(jsonb_build_object('tMs',0,'pad','SNARE','velocity',1)),? FROM generate_series(1,50000)",
				user, UUID.randomUUID(), HASH);
	}

	@Test
	void 같은_회원의_살아있는_녹음끼리만_키가_유일하다() {
		UUID key = UUID.randomUUID();
		long first = insert(user, key, "FREE", "STICK", 2, HITS, 300, HASH);
		assertThatThrownBy(() -> insert(user, key, "FREE", "STICK", 2, HITS, 300, HASH)).isInstanceOf(DuplicateKeyException.class);
		// 다른 회원은 같은 키를 쓸 수 있다.
		insert(other, key, "FREE", "STICK", 2, HITS, 300, HASH);
		// 지운 녹음의 키로는 새 녹음을 만들 수 있다.
		db.update("UPDATE recordings SET deleted_at=now() WHERE id=?", first);
		insert(user, key, "FREE", "STICK", 2, HITS, 300, HASH);
		assertThat(db.queryForObject("SELECT count(*) FROM recordings WHERE user_id=? AND client_key=?", Integer.class, user, key)).isEqualTo(2);
	}

	@Test
	void 플레이_연결은_하나뿐이고_플레이가_지워지면_연결만_끊긴다() {
		UUID play = UUID.randomUUID();
		db.update("INSERT INTO play_sessions(id,user_id,mode,input_source,payload_schema_version,payload_hash,started_at,ended_at) VALUES(?,?,'FREE','STICK',1,?,now(),now())",
				play, user, HASH);
		long id = insert(user, UUID.randomUUID(), "FREE", "STICK", 2, HITS, 300, HASH);
		db.update("UPDATE recordings SET play_session_id=? WHERE id=?", play, id);
		long second = insert(user, UUID.randomUUID(), "FREE", "STICK", 2, HITS, 300, HASH);
		assertThatThrownBy(() -> db.update("UPDATE recordings SET play_session_id=? WHERE id=?", play, second)).isInstanceOf(DuplicateKeyException.class);

		db.update("DELETE FROM play_sessions WHERE id=?", play);
		assertThat(db.queryForObject("SELECT play_session_id IS NULL AND hit_count=2 FROM recordings WHERE id=?", Boolean.class, id)).isTrue();
	}

	private long insert(long owner, UUID key, String mode, String input, int count, String hits, int duration, String hash) {
		return db.queryForObject("INSERT INTO recordings(user_id,title,client_key,mode,input_source,schema_version,started_at,duration_ms,hit_count,hits,payload_hash) "
				+ "VALUES(?,'녹음',?,?,?,1,now(),?,?,?::jsonb,?) RETURNING id", Long.class, owner, key, mode, input, duration, count, hits, hash);
	}
}

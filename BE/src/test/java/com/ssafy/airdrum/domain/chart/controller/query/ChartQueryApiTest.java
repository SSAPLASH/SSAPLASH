package com.ssafy.airdrum.domain.chart.controller.query;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.domain.chart.exception.ChartErrorCode;
import com.ssafy.airdrum.domain.chart.storage.ChartAssetStore;
import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.UserRole;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;

/**
 * 실제 PostgreSQL과 MVC를 함께 검증한다. 스토리지만 대역이다.
 * 신원은 88번 인증 모듈의 실제 access 토큰으로 보낸다({@link #get}이 소유자 토큰을 붙인다).
 */
@SpringBootTest(properties = "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.ssafy.airdrum.domain.chart.controller.query.QuerySqlCapture")
@AutoConfigureMockMvc
@Transactional
public class ChartQueryApiTest {
	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired JsonMapper json;
	@Autowired AccessTokenService tokens;
	@Autowired com.ssafy.airdrum.domain.song.service.level.SongLevelService levels;
	@MockitoBean ChartAssetStore store;
	long owner, other, builtin, ownSong, hiddenSong, chart, version;
	String ownerToken;
	public static final String TIMING = """
		{"bpm":120,"offsetMs":250,"timeSignature":"4/4","ppq":480,
		 "tempoMap":[{"tick":0,"bpm":120},{"tick":480,"bpm":60}],
		 "timeSignatureMap":[{"tick":0,"numerator":4,"denominator":4}],
		 "internalKey":"never-expose"}
		""";
	public static final String NOTES = """
		[{"noteId":"n0001","timeMs":250,"pad":"SNARE","velocityHint":80,
		"notation":{"tick":0,"durationTicks":480,"voice":1},"internalKey":"never-expose"}]
		""";
	@BeforeEach void seed() {
		clearBuiltinSeed();
		owner = user("조회 소유자"); other = user("다른 회원");
		builtin = song(null, "기본", "BUILTIN", "READY");
		ownSong = song(owner, "내 곡", "AUDIO", "READY");
		hiddenSong = song(other, "타인 곡", "AUDIO", "READY");
		chart = chart(ownSong, "NORMAL");
		version = version(chart, 1, NOTES, TIMING, "PENDING");
		ownerToken = tokens.issue(new AuthUser(owner, UserRole.USER), Instant.now()).token();
		QuerySqlCapture.clear();
	}
	/** V10의 실제 내장 곡은 별도 통합 검사에서 검증하고, 이 클래스의 단일 fixture 가정을 유지한다. */
	private void clearBuiltinSeed() {
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id = c.song_id WHERE s.source = 'BUILTIN' AND s.owner_id IS NULL)");
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE source = 'BUILTIN' AND owner_id IS NULL)");
		db.update("DELETE FROM songs WHERE source = 'BUILTIN' AND owner_id IS NULL");
	}
	@Test void scopesSearchAndCountsNeverExposeOtherSongs() throws Exception {
		var built = ok("/api/v1/songs");
		assertThat(built.path("totalElements").longValue()).isEqualTo(1);
		assertThat(built.path("items").get(0).path("id").longValue()).isEqualTo(builtin);
		assertThat(built.path("items").get(0).has("notes")).isFalse();
		var mine = ok("/api/v1/songs?source=MINE");
		assertThat(mine.path("totalElements").longValue()).isEqualTo(1);
		assertThat(mine.path("items").get(0).path("difficulties").get(0).asString()).isEqualTo("NORMAL");
		assertThat(ok("/api/v1/songs?source=MINE&q=타인").path("totalElements").longValue()).isZero();
		assertThat(ok("/api/v1/songs?source=MINE&page=9").path("items").size()).isZero();
		assertThat(ok("/api/v1/songs?source=MINE&page=9").path("totalElements").longValue()).isEqualTo(1);
	}
	@Test void levelsFilterBeforePaginationAndKeepNonReadyMine() throws Exception {
		long hard = chart(ownSong, "HARD");
		long hardVersion = version(hard,1,NOTES,TIMING,"PENDING");
		levels.process(ownSong,true);
		long pending = song(owner,"대기", "AUDIO", "PROCESSING");
		assertThat(ok("/api/v1/songs?source=MINE").path("totalElements").asLong()).isEqualTo(2);
		var rated = ok("/api/v1/songs?source=MINE&songLevel=BEGINNER&playableOnly=true&size=1");
		assertThat(rated.path("totalElements").asLong()).isEqualTo(1);
		assertThat(rated.path("items").get(0).path("id").asLong()).isEqualTo(ownSong);
		assertThat(rated.path("items").get(0).path("songLevel").asString()).isEqualTo("BEGINNER");
		assertThat(ok("/api/v1/songs?source=MINE&playableOnly=true&page=9").path("totalElements").asLong()).isEqualTo(1);
		assertThat(ok("/api/v1/songs/"+pending).path("songLevel").isNull()).isTrue();
		assertThat(db.queryForObject("SELECT level_chart_version_id FROM songs WHERE id=?",Long.class,ownSong)).isEqualTo(hardVersion);
		for (String query : List.of("?songLevel=", "?songLevel=beginner", "?songLevel=UNKNOWN", "?playableOnly=no"))
			problem("/api/v1/songs"+query,400,"INVALID_INPUT");
	}
	@Test void accompanimentFilterMatchesLatestStatusBeforePaginationAndHonorsVisibility() throws Exception {
		long ready = song(owner, "반주 보유", "MIDI", "READY");
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", "accompaniment/"+ready+".flac", ready);
		var readyOriginal = midiOriginal(ready, owner);
		midiJob(ready, owner, readyOriginal, "FAILED");
		long queued = song(owner, "반주 대기", "MIDI", "READY");
		midiJob(queued, owner, midiOriginal(queued, owner), "QUEUED");
		long running = song(owner, "반주 생성", "MIDI", "READY");
		midiJob(running, owner, midiOriginal(running, owner), "RUNNING");
		long processing = song(owner, "반주 처리", "MIDI", "PROCESSING");
		midiJob(processing, owner, midiOriginal(processing, owner), "QUEUED");
		long latestFailed = song(owner, "반주 실패", "MIDI", "READY");
		var failedOriginal = midiOriginal(latestFailed, owner);
		midiJob(latestFailed, owner, failedOriginal, "QUEUED");
		midiJob(latestFailed, owner, failedOriginal, "FAILED");
		song(owner, "반주 없음", "MIDI", "READY");
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", "accompaniment/"+hiddenSong+".flac", hiddenSong);
		long deleted = song(owner, "삭제 곡", "AUDIO", "READY");
		db.update("UPDATE songs SET accompaniment_key=?,deleted_at=now() WHERE id=?", "accompaniment/"+deleted+".flac", deleted);

		String filtered = "/api/v1/songs?source=MINE&withAccompaniment=true&size=1";
		long[] expected = {processing, running, queued, ready};
		String[] statuses = {"GENERATING", "GENERATING", "GENERATING", "READY"};
		for (int i=0; i<expected.length; i++) {
			var page = ok(filtered+"&page="+i);
			assertThat(page.path("totalElements").asLong()).isEqualTo(4);
			assertThat(page.path("totalPages").asInt()).isEqualTo(4);
			assertThat(page.path("hasNext").asBoolean()).isEqualTo(i<3);
			assertThat(page.path("items").get(0).path("id").asLong()).isEqualTo(expected[i]);
			assertThat(page.path("items").get(0).path("accompanimentStatus").asString()).isEqualTo(statuses[i]);
		}
		var empty = ok(filtered+"&page=9");
		assertThat(empty.path("items").size()).isZero();
		assertThat(empty.path("totalElements").asLong()).isEqualTo(4);
		assertThat(empty.path("hasNext").asBoolean()).isFalse();
		assertThat(ok("/api/v1/songs?source=MINE&withAccompaniment=false").path("totalElements").asLong())
				.isEqualTo(ok("/api/v1/songs?source=MINE").path("totalElements").asLong());
		assertThat(ok("/api/v1/songs?source=MINE&withAccompaniment=true&q=실패").path("totalElements").asLong()).isZero();
		assertThat(ok("/api/v1/songs?source=MINE&withAccompaniment=true&q=대기").path("items").get(0).path("id").asLong()).isEqualTo(queued);
		for (String invalid : List.of("", "TRUE", "yes", "1"))
			problem("/api/v1/songs?withAccompaniment="+invalid, 400, "INVALID_INPUT");
	}
	@Test void accompanimentFilterIntersectsBuiltinSearchLevelAndPlayableFilters() throws Exception {
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", "accompaniment/"+builtin+".wav", builtin);
		long unpublished = song(null, "비공개", "BUILTIN", "READY");
		db.update("UPDATE songs SET accompaniment_key=?,published=false WHERE id=?", "accompaniment/"+unpublished+".wav", unpublished);
		var built = ok("/api/v1/songs?source=BUILTIN&withAccompaniment=true");
		assertThat(built.path("totalElements").asLong()).isEqualTo(1);
		assertThat(built.path("items").get(0).path("id").asLong()).isEqualTo(builtin);
		long rated = ratedSong(owner, "레벨 반주", "READY", "BEGINNER");
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", "accompaniment/"+rated+".wav", rated);
		ratedSong(owner, "레벨 무반주", "READY", "BEGINNER");
		var intersection = ok("/api/v1/songs?source=MINE&withAccompaniment=true&songLevel=BEGINNER&playableOnly=true&q=레벨");
		assertThat(intersection.path("totalElements").asLong()).isEqualTo(1);
		assertThat(intersection.path("items").get(0).path("id").asLong()).isEqualTo(rated);
		assertThat(ok("/api/v1/songs?source=MINE&withAccompaniment=true&songLevel=ADVANCED&playableOnly=true").path("totalElements").asLong()).isZero();
	}
	private java.util.UUID midiOriginal(long song, long user) {
		var id = java.util.UUID.randomUUID();
		db.update("INSERT INTO midi_original_uploads(id,user_id,reserved_song_id,song_id,object_key,size_bytes,sha256,status,expires_at) VALUES(?,?,?,?,?,1,?,'ACCEPTED',now()+interval '1 hour')",
				id,user,song,song,"midi-original/"+id,"a".repeat(64));
		return id;
	}
	private void midiJob(long song, long user, java.util.UUID original, String state) {
		db.update("""
			INSERT INTO midi_accompaniment_jobs(song_id,user_id,original_id,timing,duration_ms,status,attempt_id,lease_expires_at,attempt_deadline_at,finished_at)
			VALUES(?,?,?,'{}'::jsonb,3000,?,?,CASE WHEN ?='RUNNING' THEN now()+interval '1 minute' END,
			CASE WHEN ?='RUNNING' THEN now()+interval '5 minutes' END,CASE WHEN ?='FAILED' THEN now() END)
			""",song,user,original,state,"RUNNING".equals(state)?java.util.UUID.randomUUID():null,state,state,state);
	}
	@Test void failureIsOwnerOnlySafeAndLatestJobWins() throws Exception {
		db.update("UPDATE songs SET status='FAILED' WHERE id=?",ownSong);
		db.update("INSERT INTO chart_jobs(song_id,user_id,status,error_code,error_message,finished_at,idempotency_key,request_hash) VALUES(?,?,'FAILED',NULL,'https://secret',now(),'old',?)",ownSong,owner,"a".repeat(64));
		var first = ok("/api/v1/songs/"+ownSong);
		assertThat(first.path("chartFailure").path("code").asString()).isEqualTo("JOB_FAILED");
		assertThat(first.path("chartFailure").path("reason").isNull()).isTrue();
		assertThat(first.toString()).doesNotContain("https://secret");
		db.update("INSERT INTO chart_jobs(song_id,user_id,status,error_code,finished_at,idempotency_key,request_hash) VALUES(?,?,'FAILED','INPUT_INVALID',now(),'foreign',?)",ownSong,other,"c".repeat(64));
		assertThat(ok("/api/v1/songs/"+ownSong).path("chartFailure").path("code").asString()).isEqualTo("JOB_FAILED");
		db.update("INSERT INTO chart_jobs(song_id,user_id,status,idempotency_key,request_hash) VALUES(?,?,'QUEUED','new',?)",ownSong,owner,"b".repeat(64));
		assertThat(ok("/api/v1/songs/"+ownSong).path("chartFailure").isNull()).isTrue();
		problem("/api/v1/songs/"+hiddenSong,404,"SONG_NOT_FOUND");
	}
	@Test void eachFailureCodeIsSafelyMappedInListAndDetail() throws Exception {
		db.update("UPDATE songs SET status='FAILED' WHERE id=?",ownSong);
		long job=db.queryForObject("INSERT INTO chart_jobs(song_id,user_id,status,error_code,error_message,finished_at,idempotency_key,request_hash) VALUES(?,?,'FAILED','INPUT_INVALID','secret/path',now(),'failure-mapping',?) RETURNING id",Long.class,ownSong,owner,"d".repeat(64));
		var expected=java.util.Map.of("INPUT_INVALID","입력 파일을 처리할 수 없습니다.", "OUTPUT_INVALID","채보 결과를 처리할 수 없습니다.",
				"MODEL_FAILED","채보 생성에 실패했습니다.", "JOB_CANCELLED","작업이 취소되었습니다.", "UNKNOWN_INTERNAL","작업을 완료할 수 없습니다.");
		for (var entry:expected.entrySet()) {
			db.update("UPDATE chart_jobs SET error_code=? WHERE id=?",entry.getKey(),job);
			String code=entry.getKey().equals("UNKNOWN_INTERNAL") ? "JOB_FAILED" : entry.getKey();
			var detail=ok("/api/v1/songs/"+ownSong).path("chartFailure");
			var list=ok("/api/v1/songs?source=MINE").path("items").get(0).path("chartFailure");
			for (var result:List.of(detail,list)) {
				assertThat(result.path("code").asString()).isEqualTo(code);
				assertThat(result.path("message").asString()).isEqualTo(entry.getValue());
				assertThat(result.toString()).doesNotContain("secret/path", "UNKNOWN_INTERNAL");
			}
		}
	}
	@Test void filtersUseMatchingRowsBeforePageAndCountAcrossOwnersAndStatuses() throws Exception {
		long beginnerA=ratedSong(owner,"입문 A","READY","BEGINNER");
		long beginnerB=ratedSong(owner,"입문 B","READY","BEGINNER");
		long advanced=ratedSong(owner,"고급","READY","ADVANCED");
		ratedSong(owner,"입문 실패","FAILED","BEGINNER");
		ratedSong(other,"타인 입문","READY","BEGINNER");
		assertThat(ok("/api/v1/songs?source=MINE&songLevel=BEGINNER").path("totalElements").asLong()).isEqualTo(3);
		var first=ok("/api/v1/songs?source=MINE&songLevel=BEGINNER&playableOnly=true&size=1&page=0");
		var second=ok("/api/v1/songs?source=MINE&songLevel=BEGINNER&playableOnly=true&size=1&page=1");
		assertThat(first.path("totalElements").asLong()).isEqualTo(2);
		assertThat(second.path("totalElements").asLong()).isEqualTo(2);
		assertThat(first.path("items").get(0).path("id").asLong()).isEqualTo(beginnerB);
		assertThat(second.path("items").get(0).path("id").asLong()).isEqualTo(beginnerA);
		var high=ok("/api/v1/songs?source=MINE&songLevel=ADVANCED&playableOnly=true");
		assertThat(high.path("totalElements").asLong()).isEqualTo(1);
		assertThat(high.path("items").get(0).path("id").asLong()).isEqualTo(advanced);
	}
	private long ratedSong(long user,String title,String status,String level) {
		long id=song(user,title,"AUDIO",status);
		long v=version(chart(id,"HARD"),1,NOTES,TIMING,"PENDING");
		db.update("UPDATE songs SET song_level=?,level_chart_version_id=?,level_rule_version='song-level-1',level_duration_ms=3000 WHERE id=?",level,v,id);
		return id;
	}
	@Test void invalidNewestInputClearsEveryStoredLevelField() {
		long hard=chart(ownSong,"HARD"); long v=version(hard,1,NOTES,TIMING,"PENDING");
		for (String kind:List.of("empty","malformed","missing-duration","zero-duration","outside-duration")) {
			db.update("UPDATE songs SET duration_ms=3000 WHERE id=?",ownSong);
			db.update("UPDATE chart_versions SET notes=CAST(? AS jsonb),note_count=1 WHERE id=?",NOTES,v);
			assertThat(levels.process(ownSong,true).level()).as(kind).isNotNull();
			switch (kind) {
				case "empty" -> db.update("UPDATE chart_versions SET notes='[]'::jsonb,note_count=0 WHERE id=?",v);
				case "malformed" -> db.update("UPDATE chart_versions SET notes='[{\"noteId\":\"n\",\"timeMs\":250}]'::jsonb WHERE id=?",v);
				case "missing-duration" -> db.update("UPDATE songs SET duration_ms=NULL WHERE id=?",ownSong);
				case "zero-duration" -> db.update("UPDATE songs SET duration_ms=0 WHERE id=?",ownSong);
				case "outside-duration" -> db.update("UPDATE chart_versions SET notes=CAST(? AS jsonb) WHERE id=?",NOTES.replace("\"timeMs\":250","\"timeMs\":3001"),v);
				default -> throw new AssertionError(kind);
			}
			assertThat(levels.process(ownSong,true).reason()).as(kind).isEqualTo("INVALID");
			var fields=db.queryForMap("SELECT song_level,level_chart_version_id,level_rule_version,level_duration_ms FROM songs WHERE id=?",ownSong);
			assertThat(fields.values()).as(kind).containsOnlyNulls();
		}
	}
	@Test void onlyLegacyUsesHighestStageAndLatestVersionUntilHardAppears() {
		long easy=chart(ownSong,"EASY"); version(easy,1,NOTES,TIMING,"PENDING");
		long normalV2=version(chart,2,NOTES,TIMING,"PENDING");
		assertThat(levels.process(ownSong,true).reason()).isEqualTo("NO_CHART");
		assertThat(db.queryForObject("SELECT song_level FROM songs WHERE id=?",String.class,ownSong)).isNull();
		db.update("UPDATE songs SET level_legacy_fallback=true WHERE id=?",ownSong);
		assertThat(levels.process(ownSong,true).versionId()).isEqualTo(normalV2);
		long hard=chart(ownSong,"HARD");
		assertThat(levels.process(ownSong,true).reason()).isEqualTo("NO_CHART");
		assertThat(db.queryForObject("SELECT level_legacy_fallback FROM songs WHERE id=?",Boolean.class,ownSong)).isFalse();
		long hardV1=version(hard,1,NOTES,TIMING,"PENDING");
		assertThat(levels.process(ownSong,true).versionId()).isEqualTo(hardV1);
	}
	@Test void malformedTimingAndSheetMetadataDoNotAffectRatingButDetailStillFails() throws Exception {
		long hard=chart(ownSong,"HARD"); long v=version(hard,1,NOTES,TIMING,"PENDING");
		db.update("UPDATE chart_versions SET timing='{}'::jsonb,sheet_pages='[{\"unexpected\":true}]'::jsonb WHERE id=?",v);
		assertThat(levels.process(ownSong,true).versionId()).isEqualTo(v);
		assertThat(db.queryForObject("SELECT song_level FROM songs WHERE id=?",String.class,ownSong)).isEqualTo("BEGINNER");
		problem("/api/v1/charts/"+hard,500,"INTERNAL_ERROR");
	}
	@Test void legacySelectionDryRunAndDurationChangesAreConsistent() {
		db.update("UPDATE songs SET level_legacy_fallback=true WHERE id=?",ownSong);
		assertThat(levels.process(ownSong,false).versionId()).isEqualTo(version);
		assertThat(db.queryForObject("SELECT song_level FROM songs WHERE id=?",String.class,ownSong)).isNull();
		levels.process(ownSong,true);
		assertThat(db.queryForObject("SELECT level_duration_ms FROM songs WHERE id=?",Integer.class,ownSong)).isEqualTo(3000);
		db.update("UPDATE songs SET duration_ms=5000 WHERE id=?",ownSong);
		levels.process(ownSong,true);
		assertThat(db.queryForObject("SELECT level_duration_ms FROM songs WHERE id=?",Integer.class,ownSong)).isEqualTo(5000);
		long hard = chart(ownSong,"HARD");
		assertThat(levels.process(ownSong,true).reason()).isEqualTo("NO_CHART");
		assertThat(db.queryForObject("SELECT song_level FROM songs WHERE id=?",String.class,ownSong)).isNull();
		long latest = version(hard,1,NOTES,TIMING,"PENDING");
		levels.process(ownSong,true);
		assertThat(db.queryForObject("SELECT level_chart_version_id FROM songs WHERE id=?",Long.class,ownSong)).isEqualTo(latest);
		long invalid = version(hard,2,NOTES,TIMING,"PENDING");
		db.update("UPDATE chart_versions SET schema_version=2 WHERE id=?",invalid);
		assertThat(levels.process(ownSong,true).reason()).isEqualTo("INVALID");
		assertThat(db.queryForObject("SELECT level_chart_version_id FROM songs WHERE id=?",Long.class,ownSong)).isNull();
	}
	@Test void storedLevelRestrictsVersionDeletionUntilAllFieldsAreCleared() {
		long hard = chart(ownSong,"HARD");
		long hardVersion = version(hard,1,NOTES,TIMING,"PENDING");
		levels.process(ownSong,true);
		db.execute("SAVEPOINT before_restricted_delete");
		assertThatThrownBy(() -> db.update("DELETE FROM chart_versions WHERE id=?",hardVersion)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		db.execute("ROLLBACK TO SAVEPOINT before_restricted_delete");
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE id=?",ownSong);
		assertThat(db.update("DELETE FROM chart_versions WHERE id=?",hardVersion)).isEqualTo(1);
		assertThat(db.update("DELETE FROM charts WHERE id=?",hard)).isEqualTo(1);
	}
	@Test void searchTreatsWildcardAndEscapeAsLiteralAndTrimsBeforeValidation() throws Exception {
		song(owner, "100%_! Beat", "MIDI", "READY");
		var r = mvc.perform(get("/api/v1/songs").param("source", "MINE").param("q", "%_!")).andReturn();
		assertThat(r.getResponse().getStatus()).isEqualTo(200);
		assertThat(body(r).path("totalElements").longValue()).isEqualTo(1);
		var spaces = mvc.perform(get("/api/v1/songs").param("q", " ".repeat(110) + "기본" + " ".repeat(110))).andReturn();
		assertThat(spaces.getResponse().getStatus()).isEqualTo(200);
		assertThat(body(spaces).path("totalElements").longValue()).isEqualTo(1);
	}
	@Test void privateDeletedAndMissingResourcesAreIndistinguishableIncludingAdmin() throws Exception {
		long foreignChart = chart(hiddenSong, "EASY");
		long foreignVersion = version(foreignChart, 1, NOTES, TIMING, "READY");
		db.update("UPDATE users SET role='ADMIN' WHERE id=?", owner);
		for (var path : List.of("/api/v1/songs/" + hiddenSong, "/api/v1/songs/9223372036854775807"))
			problem(path, 404, "SONG_NOT_FOUND");
		problem("/api/v1/charts/" + foreignChart, 404, "CHART_NOT_FOUND");
		problem("/api/v1/chart-versions/" + foreignVersion, 404, "CHART_VERSION_NOT_FOUND");
		problem("/api/v1/chart-versions/" + foreignVersion + "/assets", 404, "CHART_VERSION_NOT_FOUND");
		db.update("UPDATE songs SET deleted_at=now() WHERE id=?", ownSong);
		problem("/api/v1/songs/" + ownSong, 404, "SONG_NOT_FOUND");
		problem("/api/v1/charts/" + chart, 404, "CHART_NOT_FOUND");
		problem("/api/v1/chart-versions/" + version, 404, "CHART_VERSION_NOT_FOUND");
		problem("/api/v1/chart-versions/" + version + "/assets", 404, "CHART_VERSION_NOT_FOUND");
		verifyNoInteractions(store);
	}
	@Test void authenticationPrecedesValidationAndInactiveUserCannotReadBuiltin() throws Exception {
		unauthenticated(MockMvcRequestBuilders.get("/api/v1/songs/not-a-number?size=-1"));
		db.update("UPDATE users SET status='WITHDRAWN', withdrawn_at=now() WHERE id=?", owner);
		unauthenticated(get("/api/v1/songs"));
		unauthenticated(get("/api/v1/chart-versions/" + version + "/assets"));
	}
	@Test void inputConstraintsUseCommonProblemFormat() throws Exception {
		for (var query : List.of("?page=-1", "?page=100001", "?size=0", "?size=101"))
			problem("/api/v1/songs" + query, 400, "VALIDATION_FAILED");
		problem("/api/v1/songs?source=AUDIO", 400, "INVALID_INPUT");
		problem("/api/v1/songs/0", 400, "VALIDATION_FAILED");
		problem("/api/v1/charts/-1", 400, "VALIDATION_FAILED");
		problem("/api/v1/chart-versions/9223372036854775808", 400, "INVALID_INPUT");
		var r = mvc.perform(get("/api/v1/songs").param("q", "x".repeat(101))).andReturn();
		assertThat(r.getResponse().getStatus()).isEqualTo(400);
	}
	@Test void nonReadyPrivateSongsKeepMetadataButNotPlayableCharts() throws Exception {
		for (String state : List.of("PROCESSING", "FAILED")) {
			db.update("UPDATE songs SET status=? WHERE id=?", state, ownSong);
			var song = ok("/api/v1/songs/" + ownSong);
			assertThat(song.path("status").asString()).isEqualTo(state);
			assertThat(song.path("charts").isEmpty()).isTrue();
			assertThat(song.path("difficulties").isEmpty()).isTrue();
			problem("/api/v1/charts/" + chart, 409, "SONG_NOT_READY");
			problem("/api/v1/chart-versions/" + version + "/assets", 409, "SONG_NOT_READY");
		}
		db.update("UPDATE songs SET status='FAILED' WHERE id=?", builtin);
		assertThat(ok("/api/v1/songs").path("items").size()).isZero();
		problem("/api/v1/songs/" + builtin, 404, "SONG_NOT_FOUND");
	}
	@Test void latestUsesVersionNumberAndOldTimingSurvivesSongChanges() throws Exception {
		long v3 = version(chart, 3, NOTES.replace("250", "750"), TIMING.replace("250", "750"), "UNAVAILABLE");
		version(chart, 2, NOTES.replace("250", "500"), TIMING.replace("250", "500"), "READY");
		db.update("UPDATE songs SET bpm=90, offset_ms=999, time_signature='3/4' WHERE id=?", ownSong);
		var latest = ok("/api/v1/charts/" + chart);
		assertThat(latest.path("chartVersionId").longValue()).isEqualTo(v3);
		var fixed = ok("/api/v1/chart-versions/" + version);
		assertThat(fixed.path("bpm").doubleValue()).isEqualTo(120);
		assertThat(fixed.path("offsetMs").intValue()).isEqualTo(250);
		assertThat(fixed.path("notes").get(0).path("timeMs").doubleValue()).isEqualTo(250);
		assertThat(fixed.path("notes").get(0).path("noteId").asString()).isEqualTo("n0001");
		assertThat(fixed.path("beatsPerBar").intValue()).isEqualTo(4);
		assertThat(fixed.toString()).doesNotContain("internalKey", "never-expose", "imageKey", "ownerId", "accompanimentKey");
		assertThat(fixed.path("hasSheetImages").booleanValue()).isFalse();
		assertThat(fixed.path("title").asString()).isEqualTo("내 곡");
		var summary = ok("/api/v1/songs/" + ownSong).path("charts").get(0);
		assertThat(summary.path("chartVersionId").longValue()).isEqualTo(v3);
	}
	@Test void hihatOpenIsSerializedInChartVersionResponse() throws Exception {
		db.update("UPDATE chart_versions SET notes=CAST(? AS jsonb) WHERE id=?", """
			[{"noteId":"open","timeMs":250,"pad":"HIHAT","hihatOpen":true}]
			""", version);
		var note = ok("/api/v1/chart-versions/" + version).path("notes").get(0);
		assertThat(note.path("pad").asString()).isEqualTo("HIHAT");
		assertThat(note.path("hihatOpen").isBoolean()).isTrue();
		assertThat(note.path("hihatOpen").booleanValue()).isTrue();
	}
	@Test void emptyChartAndUnknownVersionAre404AndUnsupportedSchema409() throws Exception {
		long empty = chart(ownSong, "HARD");
		problem("/api/v1/charts/" + empty, 404, "CHART_NOT_FOUND");
		problem("/api/v1/chart-versions/9223372036854775807", 404, "CHART_VERSION_NOT_FOUND");
		db.update("UPDATE chart_versions SET schema_version=2 WHERE id=?", version);
		problem("/api/v1/chart-versions/" + version, 409, "CHART_SCHEMA_UNSUPPORTED");
		problem("/api/v1/chart-versions/" + version + "/assets", 409, "CHART_SCHEMA_UNSUPPORTED");
	}
	@Test void corruptStoredJsonIsSafe500WithoutFallingBackToSongDefaults() throws Exception {
		db.update("UPDATE chart_versions SET timing='{}'::jsonb WHERE id=?", version);
		var r = problem("/api/v1/chart-versions/" + version, 500, "INTERNAL_ERROR");
		assertThat(r.toString()).doesNotContain("SELECT", "jsonb", "internalKey", "저장된");
	}
	@Test void listIsBoundedQueriesAndDoesNotSelectLargeJson() throws Exception {
		QuerySqlCapture.clear();
		ok("/api/v1/songs?source=MINE&size=1");
		int first = QuerySqlCapture.statements().size();
		for (int i = 0; i < 5; i++) {
			long s = song(owner, "추가" + i, "MIDI", "READY");
			version(chart(s, "EASY"), 1, NOTES, TIMING, "READY");
		}
		QuerySqlCapture.clear();
		var page = ok("/api/v1/songs?source=MINE&size=100");
		var sql = QuerySqlCapture.statements();
		assertThat(page.path("items").size()).isEqualTo(6);
		assertThat(sql).hasSize(first);
		// 인증 필터의 회원 확인(users PK 조회) 1건을 포함한 요청 전체 상한이다(88번 이후 +1).
		assertThat(first).isLessThanOrEqualTo(6);
		assertThat(String.join("\n", sql).toLowerCase()).doesNotContain("v.notes", "v.timing", "sheet_pages", "select *");
	}
	@Test void stableOrderAndDifficultyOrderHaveNoDuplicates() throws Exception {
		long s2 = song(owner, "둘", "MIDI", "READY");
		db.update("UPDATE songs SET created_at='2026-01-01T00:00:00Z' WHERE owner_id=?", owner);
		// 260번: 노트 수가 같으면 숨기므로 세 난이도의 노트 수를 다르게 둔다.
		noteCount(version, 2);
		noteCount(version(chart(ownSong, "HARD"), 1, NOTES, TIMING, "READY"), 3);
		version(chart(ownSong, "EASY"), 1, NOTES, TIMING, "READY");
		var items = ok("/api/v1/songs?source=MINE").path("items");
		assertThat(items.get(0).path("id").longValue()).isEqualTo(s2);
		var charts = ok("/api/v1/songs/" + ownSong).path("charts");
		assertThat(charts.get(0).path("difficulty").asString()).isEqualTo("EASY");
		assertThat(charts.get(1).path("difficulty").asString()).isEqualTo("NORMAL");
		assertThat(charts.get(2).path("difficulty").asString()).isEqualTo("HARD");
	}
	/** 260번 설계 3-4절: 최신 버전 노트 수가 NORMAL과 같은 HARD·EASY는 목록·상세에서 빠지고, 채보 직접 조회는 그대로다. */
	@Test void difficultiesWithSameNotesAsNormalAreHiddenButStayReachable() throws Exception {
		long hard = chart(ownSong, "HARD"), easy = chart(ownSong, "EASY");
		long hardVersion = version(hard, 1, NOTES, TIMING, "PENDING"), easyVersion = version(easy, 1, NOTES, TIMING, "PENDING");
		// 셋 모두 같음(1·1·1) → NORMAL만
		assertDifficulties(ownSong, "NORMAL");
		assertThat(ok("/api/v1/charts/" + hard).path("difficulty").asString()).isEqualTo("HARD");
		assertThat(ok("/api/v1/chart-versions/" + hardVersion).path("difficulty").asString()).isEqualTo("HARD");
		// NORMAL = HARD(2·2), EASY 1 → EASY·NORMAL
		noteCount(version, 2); noteCount(hardVersion, 2);
		assertDifficulties(ownSong, "EASY", "NORMAL");
		// EASY = NORMAL(2·2), HARD 3 → NORMAL·HARD
		noteCount(hardVersion, 3); noteCount(easyVersion, 2);
		assertDifficulties(ownSong, "NORMAL", "HARD");
		// 셋 다름 → 3개
		noteCount(easyVersion, 1);
		assertDifficulties(ownSong, "EASY", "NORMAL", "HARD");
		// 판정은 최신 버전 기준: HARD 새 버전이 NORMAL과 같아지면 숨긴다.
		noteCount(version(hard, 2, NOTES, TIMING, "PENDING"), 2);
		assertDifficulties(ownSong, "EASY", "NORMAL");
		// NORMAL이 없는 곡은 숨기지 않는다.
		long legacy = song(owner, "NORMAL 없는 곡", "MIDI", "READY");
		version(chart(legacy, "HARD"), 1, NOTES, TIMING, "PENDING");
		version(chart(legacy, "EASY"), 1, NOTES, TIMING, "PENDING");
		assertDifficulties(legacy, "EASY", "HARD");
	}
	private void assertDifficulties(long song, String... expected) throws Exception {
		var detail = ok("/api/v1/songs/" + song);
		assertThat(detail.path("difficulties").valueStream().map(JsonNode::asString).toList()).containsExactly(expected);
		assertThat(detail.path("charts").valueStream().map(c -> c.path("difficulty").asString()).toList()).containsExactly(expected);
		JsonNode item = null;
		for (var i : ok("/api/v1/songs?source=MINE&size=100").path("items")) if (i.path("id").longValue() == song) item = i;
		assertThat(item).as("목록에 곡이 있어야 한다").isNotNull();
		assertThat(item.path("difficulties").valueStream().map(JsonNode::asString).toList()).containsExactly(expected);
	}
	/** note_count는 노트 배열 길이와 같아야 하므로(체크 제약) 노트도 그 수만큼 만든다. */
	private void noteCount(long chartVersion, int count) {
		var notes = new StringBuilder("[");
		for (int i = 0; i < count; i++) notes.append(i == 0 ? "" : ",").append("""
				{"noteId":"n%04d","timeMs":%d,"pad":"SNARE","velocityHint":80,"notation":{"tick":%d,"durationTicks":480,"voice":1}}"""
				.formatted(i + 1, 250 + i * 500, i * 480));
		db.update("UPDATE chart_versions SET notes=CAST(? AS jsonb),note_count=? WHERE id=?", notes.append("]").toString(), count, chartVersion);
	}
	@Test void songAccompanimentSignsPublicAndOwnWithoutRequiringChartAndRenews() throws Exception {
		String publicKey = "accompaniment/" + builtin + ".wav", ownKey = "accompaniment/" + ownSong + ".wav";
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", publicKey, builtin);
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", ownKey, ownSong);
		Instant expires = Instant.now().plusSeconds(600);
		when(store.sign(eq(ChartAssetStore.Kind.ACCOMPANIMENT), anyString()))
				.thenReturn(new ChartAssetStore.SignedAsset("https://asset.test/audio", expires));
		var publicResult = ok("/api/v1/songs/" + builtin + "/accompaniment");
		assertThat(publicResult.path("accompanimentUrl").asString()).isEqualTo("https://asset.test/audio");
		assertThat(publicResult.path("expiresAt").asString()).isEqualTo(expires.toString());
		assertThat(publicResult.toString()).doesNotContain(publicKey, "ownerId");
		ok("/api/v1/songs/" + ownSong + "/accompaniment");
		ok("/api/v1/songs/" + ownSong + "/accompaniment");
		verify(store).sign(ChartAssetStore.Kind.ACCOMPANIMENT, publicKey);
		verify(store, times(2)).sign(ChartAssetStore.Kind.ACCOMPANIMENT, ownKey);
	}
	@Test void songAccompanimentNullAccessAndReadyRules() throws Exception {
		var path = "/api/v1/songs/" + ownSong + "/accompaniment";
		var absent = ok(path);
		assertThat(absent.has("accompanimentUrl") && absent.path("accompanimentUrl").isNull()).isTrue();
		assertThat(absent.has("expiresAt") && absent.path("expiresAt").isNull()).isTrue();
		verifyNoInteractions(store);
		problem("/api/v1/songs/" + hiddenSong + "/accompaniment", 404, "SONG_NOT_FOUND");
		problem("/api/v1/songs/9223372036854775807/accompaniment", 404, "SONG_NOT_FOUND");
		unauthenticated(MockMvcRequestBuilders.get(path));
		problem("/api/v1/songs/0/accompaniment", 400, "VALIDATION_FAILED");
		db.update("UPDATE songs SET status='PROCESSING' WHERE id=?", ownSong);
		problem(path, 409, "SONG_NOT_READY");
		db.update("UPDATE songs SET published=false WHERE id=?", builtin);
		problem("/api/v1/songs/" + builtin + "/accompaniment", 404, "SONG_NOT_FOUND");
		db.update("UPDATE songs SET deleted_at=now() WHERE id=?", ownSong);
		problem(path, 404, "SONG_NOT_FOUND");
		verifyNoInteractions(store);
	}
	@Test void songAccompanimentRejectsBadKeysAndPropagatesStorageFailures() throws Exception {
		String path = "/api/v1/songs/" + ownSong + "/accompaniment";
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", "accompaniment/999999.wav", ownSong);
		problem(path, 500, "INTERNAL_ERROR");
		verifyNoInteractions(store);
		String key = "accompaniment/" + ownSong + ".wav";
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", key, ownSong);
		when(store.sign(ChartAssetStore.Kind.ACCOMPANIMENT, key)).thenThrow(new BusinessException(ChartErrorCode.CHART_ASSET_NOT_FOUND));
		problem(path, 404, "CHART_ASSET_NOT_FOUND");
		doThrow(new BusinessException(ChartErrorCode.CHART_ASSET_UNAVAILABLE)).when(store).sign(ChartAssetStore.Kind.ACCOMPANIMENT, key);
		problem(path, 503, "CHART_ASSET_UNAVAILABLE");
	}
	@ParameterizedTest @ValueSource(strings={"withdrawal", "deleted", "unpublished", "statusChanged", "keyChanged"})
	void songAccompanimentRechecksAccessAndKeyAfterSigning(String change) throws Exception {
		long songId = change.equals("unpublished") ? builtin : ownSong;
		String key = "accompaniment/" + songId + ".wav";
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", key, songId);
		when(store.sign(ChartAssetStore.Kind.ACCOMPANIMENT, key)).thenAnswer(call -> {
			switch (change) {
				case "withdrawal" -> db.update("UPDATE users SET status='WITHDRAWN', withdrawn_at=now() WHERE id=?", owner);
				case "deleted" -> db.update("UPDATE songs SET deleted_at=now() WHERE id=?", songId);
				case "unpublished" -> db.update("UPDATE songs SET published=false WHERE id=?", songId);
				case "statusChanged" -> db.update("UPDATE songs SET status='FAILED' WHERE id=?", songId);
				case "keyChanged" -> db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", "accompaniment/" + songId + ".mp3", songId);
			}
			return new ChartAssetStore.SignedAsset("https://asset.test/secret", Instant.now().plusSeconds(600));
		});
		int status = change.equals("withdrawal") ? 401 : change.equals("statusChanged") ? 409 : change.equals("keyChanged") ? 503 : 404;
		String code = change.equals("withdrawal") ? "UNAUTHORIZED" : change.equals("statusChanged") ? "SONG_NOT_READY" : change.equals("keyChanged") ? "CHART_ASSET_UNAVAILABLE" : "SONG_NOT_FOUND";
		assertThat(problem("/api/v1/songs/" + songId + "/accompaniment", status, code).toString()).doesNotContain("https://asset.test");
	}
	@Test void absentAssetsAreExplicitNullAndDoNotCallStorage() throws Exception {
		db.update("UPDATE chart_versions SET notation_status='READY' WHERE id=?", version);
		var assets = ok("/api/v1/chart-versions/" + version + "/assets");
		assertThat(assets.path("sheetPages").isEmpty()).isTrue();
		assertThat(assets.has("assetsExpireAt")).isTrue();
		assertThat(assets.path("assetsExpireAt").isNull()).isTrue();
		assertThat(assets.path("accompanimentUrl").isNull()).isTrue();
		verifyNoInteractions(store);
	}
	@Test void builtinAccompanimentUsesTheSignedPathWithoutExpandingPrivateSongAccess() throws Exception {
		long builtinChart = chart(builtin, "EASY");
		long builtinVersion = version(builtinChart, 1, NOTES, TIMING, "READY");
		String builtinKey = "accompaniment/" + builtin + ".wav";
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", builtinKey, builtin);
		Instant expiresAt = Instant.now().plusSeconds(600);
		when(store.sign(ChartAssetStore.Kind.ACCOMPANIMENT, builtinKey))
				.thenReturn(new ChartAssetStore.SignedAsset("https://asset.test/builtin.wav", expiresAt));

		var assets = ok("/api/v1/chart-versions/" + builtinVersion + "/assets");
		assertThat(assets.path("accompanimentUrl").asString()).isEqualTo("https://asset.test/builtin.wav");
		assertThat(assets.path("assetsExpireAt").asString()).isEqualTo(expiresAt.toString());
		verify(store).sign(ChartAssetStore.Kind.ACCOMPANIMENT, builtinKey);

		long privateChart = chart(hiddenSong, "EASY");
		long privateVersion = version(privateChart, 1, NOTES, TIMING, "READY");
		String privateKey = "accompaniment/" + hiddenSong + ".wav";
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", privateKey, hiddenSong);
		problem("/api/v1/chart-versions/" + privateVersion + "/assets", 404, "CHART_VERSION_NOT_FOUND");
		verify(store, never()).sign(any(), eq(privateKey));
	}
	@Test void assetsConvertTempoMapKeepVersionAndUseEarliestExpiry() throws Exception {
		image();
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", "accompaniment/" + ownSong + ".wav", ownSong);
		Instant imageExpiry = Instant.now().plusSeconds(600), audioExpiry = imageExpiry.minusSeconds(60);
		when(store.sign(eq(ChartAssetStore.Kind.SHEET), anyString())).thenReturn(new ChartAssetStore.SignedAsset("https://asset.test/page", imageExpiry));
		when(store.sign(eq(ChartAssetStore.Kind.ACCOMPANIMENT), anyString())).thenReturn(new ChartAssetStore.SignedAsset("https://asset.test/audio", audioExpiry));
		var assets = ok("/api/v1/chart-versions/" + version + "/assets");
		assertThat(assets.path("chartVersionId").longValue()).isEqualTo(version);
		assertThat(assets.path("assetsExpireAt").asString()).isEqualTo(audioExpiry.toString());
		assertThat(assets.path("sheetPages").get(0).path("fromMs").doubleValue()).isEqualTo(250);
		assertThat(assets.path("sheetPages").get(0).path("toMs").doubleValue()).isEqualTo(1750);
		assertThat(assets.toString()).doesNotContain("imageKey", "notes", "sheet/" + version);
		QuerySqlCapture.clear();
		ok("/api/v1/chart-versions/" + version + "/assets");
		assertThat(String.join("\n", QuerySqlCapture.statements())).doesNotContain("v.notes");
	}
	@Test void missingSheetTimingIs409ButNotesRemainReadable() throws Exception {
		image();
		db.update("UPDATE chart_versions SET timing=timing-'ppq' WHERE id=?", version);
		problem("/api/v1/chart-versions/" + version + "/assets", 409, "CHART_SHEET_TIMING_UNAVAILABLE");
		ok("/api/v1/chart-versions/" + version);
		verifyNoInteractions(store);
	}
	@Test void foreignOrTemporaryFileKeysAreNeverSigned() throws Exception {
		for (String key : List.of("sheet/999999/1.png", "tmp/job/1/drums.wav", "sheet/" + version + "/../1.png")) {
			setImageKey(key);
			problem("/api/v1/chart-versions/" + version + "/assets", 500, "INTERNAL_ERROR");
		}
		verifyNoInteractions(store);
	}
	@Test void storageFailuresDoNotBecomeEmptyAssetsOrExposeDetails() throws Exception {
		image();
		when(store.sign(any(), anyString())).thenThrow(new BusinessException(ChartErrorCode.CHART_ASSET_NOT_FOUND));
		problem("/api/v1/chart-versions/" + version + "/assets", 404, "CHART_ASSET_NOT_FOUND");
		doThrow(new BusinessException(ChartErrorCode.CHART_ASSET_UNAVAILABLE)).when(store).sign(any(), anyString());
		problem("/api/v1/chart-versions/" + version + "/assets", 503, "CHART_ASSET_UNAVAILABLE");
		ok("/api/v1/chart-versions/" + version);
	}
	@Test void withdrawalDuringSigningPreventsResponse() throws Exception {
		image();
		when(store.sign(any(), anyString())).thenAnswer(call -> {
			db.update("UPDATE users SET status='WITHDRAWN', withdrawn_at=now() WHERE id=?", owner);
			return new ChartAssetStore.SignedAsset("https://asset.test/secret", Instant.now().plusSeconds(600));
		});
		var r = problem("/api/v1/chart-versions/" + version + "/assets", 401, "UNAUTHORIZED");
		assertThat(r.toString()).doesNotContain("https://asset.test");
	}
	@Test void deletionDuringSigningPreventsResponse() throws Exception {
		image();
		when(store.sign(any(), anyString())).thenAnswer(call -> {
			db.update("UPDATE songs SET deleted_at=now() WHERE id=?", ownSong);
			return new ChartAssetStore.SignedAsset("https://asset.test/secret", Instant.now().plusSeconds(600));
		});
		problem("/api/v1/chart-versions/" + version + "/assets", 404, "CHART_VERSION_NOT_FOUND");
	}
	@Test void openApiDocumentsQueryPathsSecurityAndNoIdentityParameter() throws Exception {
		var api = body(mvc.perform(get("/v3/api-docs")).andReturn());
		for (String path : List.of("/api/v1/songs", "/api/v1/songs/{songId}", "/api/v1/songs/{songId}/accompaniment", "/api/v1/charts/{chartId}",
				"/api/v1/chart-versions/{chartVersionId}", "/api/v1/chart-versions/{chartVersionId}/assets")) {
			var operation = api.path("paths").path(path).path("get");
			assertThat(operation.path("security").get(0).has("bearerAuth")).isTrue();
			assertThat(operation.path("responses").has("401")).isTrue();
			assertThat(operation.path("parameters").toString()).doesNotContain("userId");
		}
	}
	private long user(String name) {
		long id = db.queryForObject("INSERT INTO users(nickname) VALUES (?) RETURNING id", Long.class, name);
		SignupConsentFixtures.complete(db, id);
		return id;
	}
	private long song(Long user, String title, String source, String status) {
		return db.queryForObject("INSERT INTO songs(owner_id,title,source,status,bpm,time_signature,duration_ms,license) VALUES (?,?,?,?,120,'4/4',3000,?) RETURNING id",
				Long.class, user, title, source, status, user == null ? "CC0" : null);
	}
	private long chart(long song, String difficulty) {
		return db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES (?,?) RETURNING id", Long.class, song, difficulty);
	}
	private long version(long chart, int number, String notes, String timing, String notation) {
		return db.queryForObject("INSERT INTO chart_versions(chart_id,version,notes,timing,note_count,generator,notation_status) VALUES (?,?,CAST(? AS jsonb),CAST(? AS jsonb),1,'MANUAL',?) RETURNING id",
				Long.class, chart, number, notes, timing, notation);
	}
	private void image() { setImageKey("sheet/" + version + "/1.png"); }
	private void setImageKey(String key) {
		db.update("UPDATE chart_versions SET sheet_pages=CAST(? AS jsonb) WHERE id=?",
				"[{\"page\":1,\"imageKey\":\"" + key + "\",\"fromTick\":0,\"toTick\":960}]", version);
	}
	private JsonNode ok(String path) throws Exception {
		var r = mvc.perform(get(path)).andReturn();
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
		assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
		return body(r);
	}
	private JsonNode problem(String path, int status, String code) throws Exception {
		var r = mvc.perform(get(path)).andReturn();
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(status);
		assertThat(r.getResponse().getContentType()).startsWith("application/problem+json");
		assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
		var body = body(r);
		assertThat(body.path("code").asString()).isEqualTo(code);
		assertThat(body.path("instance").asString()).doesNotContain("?");
		return body;
	}
	private JsonNode body(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsString()); }
	/** 소유자 access 토큰을 붙인 GET. */
	private MockHttpServletRequestBuilder get(String path) {
		return MockMvcRequestBuilders.get(path).header(AUTHORIZATION, "Bearer " + ownerToken);
	}
	/** 인증 필터 단계의 401. 캐시 헤더는 Security 기본값(no-cache, no-store, …)이다. */
	private void unauthenticated(MockHttpServletRequestBuilder request) throws Exception {
		var r = mvc.perform(request).andReturn();
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(401);
		assertThat(r.getResponse().getContentType()).startsWith("application/problem+json");
		assertThat(r.getResponse().getHeader("Cache-Control")).contains("no-store");
		assertThat(body(r).path("code").asString()).isEqualTo("UNAUTHORIZED");
	}
}

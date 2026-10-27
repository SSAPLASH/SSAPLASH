package com.ssafy.airdrum.play;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.play.raw.PlayRawStore;
import com.ssafy.airdrum.play.raw.PlayRawUploadRepository;
import com.ssafy.airdrum.play.raw.PlayRawValidator;
import com.ssafy.airdrum.storage.cleanup.RawLogCleanupWorker;
import com.ssafy.airdrum.report.ReportAggregator;
import com.ssafy.airdrum.report.ReportRepository;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 자동 commit되는 격리 fixture로 실제 JWT·PG·MVC·동시성을 검사한다. 스토리지만 대역이다. */
@SpringBootTest(properties="auth.jwt.secret=test-only-jwt-secret-0123456789ab")
@AutoConfigureMockMvc
class PlayUploadApiTest {
	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired PlayJson json;
	@Autowired PlayUploadService service;
	@Autowired PlayUploadTransaction transaction;
	@Autowired PlayRawUploadRepository receipts;
	@Autowired RawLogCleanupWorker worker;
	@MockitoBean PlayRawStore store;
	@MockitoSpyBean PlayRawValidator rawValidator;
	@MockitoSpyBean ReportRepository reports;
	@MockitoSpyBean ReportAggregator reportAggregator;
	@MockitoSpyBean PlaySessionRepository sessions;
	long user,other,song,chart,version;
	String token,otherToken;
	UUID play;
	Set<String> objects;
	@BeforeEach void seed() {
		user=db.queryForObject("INSERT INTO users(nickname) VALUES('플레이 테스트') RETURNING id",Long.class);
		other=db.queryForObject("INSERT INTO users(nickname) VALUES('플레이 타인') RETURNING id",Long.class);
		token=jwt(user,Instant.now().plusSeconds(1800));
		otherToken=jwt(other,Instant.now().plusSeconds(1800));
		play=UUID.randomUUID(); objects=ConcurrentHashMap.newKeySet();
		doAnswer(i->{objects.add(i.getArgument(0));return null;}).when(store).put(anyString(),anyLong(),any());
		when(store.exists(anyString())).thenAnswer(i->objects.contains(i.getArgument(0)));
		doAnswer(i->{objects.remove(i.getArgument(0));return null;}).when(store).delete(anyString());
	}
	@AfterEach void cleanup() {
		db.update("DELETE FROM file_cleanup_tasks WHERE object_key LIKE ?","play-raw/"+play+"/%");
		db.update("DELETE FROM play_raw_uploads WHERE original_play_id=?",play);
		db.update("DELETE FROM play_sessions WHERE user_id IN (?,?)",user,other);
		if(version!=0) db.update("DELETE FROM chart_versions WHERE id=?",version);
		if(chart!=0) db.update("DELETE FROM charts WHERE id=?",chart);
		if(song!=0) db.update("DELETE FROM songs WHERE id=?",song);
		db.update("DELETE FROM kit_presets WHERE user_id IN (?,?)",user,other);
		db.update("DELETE FROM users WHERE id IN (?,?)",user,other);
	}
	@Test void newReplayConflictAndOtherOwnerUseActualAuthentication() throws Exception {
		String body=PlayFixtures.free(play);
		mvc.perform(post("/api/v1/plays").contentType("application/json").content(body)).andExpect(status().isUnauthorized());
		postSummary(body,token,201); postSummary(body,token,200);
		postSummary(body.replace("\"consent\":false","\"consent\":true"),token,409);
		postSummary(body,otherToken,404);
		assertThat(db.queryForObject("SELECT count(*) FROM hits WHERE play_session_id=?",Integer.class,play)).isEqualTo(1);
		assertThat(db.queryForObject("SELECT t_ms FROM hits WHERE play_session_id=?",Double.class,play)).isEqualTo(-10.125);
		db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?",user);
		postSummary(body,token,401);
	}
	@Test void aliasIsStoredCanonicallyAndOldHashReplaysWithoutChangingIt() throws Exception {
		String body=PlayFixtures.free(play).replace("\"pad\":\"SNARE\"", "\"pad\":\"HI_TOM\",\"baselinePad\":\"HI_TOM\",\"predictedPad\":\"HI_TOM\"")
				.replace("\"hits\":[", "\"calibration\":{\"audioOffsetMs\":0,\"pads\":{\"HI_TOM\":{\"pitch\":0,\"yaw\":0}}},"
						+ "\"kitPresetSnapshot\":{\"name\":\"kit\",\"pads\":{\"HI_TOM\":{\"pitch\":0,\"yaw\":0}},\"keyBindings\":{\"HI_TOM\":\"HI_TOM\"}},\"hits\":[");
		String canonical=body.replace("\"HI_TOM\":\"HI_TOM\"", "\"HI_TOM\":\"SMALL_TOM\"")
				.replace("\"pad\":\"HI_TOM\"", "\"pad\":\"SMALL_TOM\"").replace("\"baselinePad\":\"HI_TOM\"", "\"baselinePad\":\"SMALL_TOM\"")
				.replace("\"predictedPad\":\"HI_TOM\"", "\"predictedPad\":\"SMALL_TOM\"").replace("\"pads\":{\"HI_TOM\"", "\"pads\":{\"SMALL_TOM\"");
		postSummary(body,token,201); postSummary(canonical,token,200);
		var row=db.queryForMap("SELECT pad,baseline_pad,predicted_pad FROM hits WHERE play_session_id=?",play);
		assertThat(row.values()).containsOnly("SMALL_TOM");
		String snapshot=db.queryForObject("SELECT kit_preset_snapshot::text FROM play_sessions WHERE id=?",String.class,play);
		assertThat(snapshot).contains("SMALL_TOM", "HI_TOM");
		String oldHash=json.legacyHash(user,read(body));
		db.update("UPDATE play_sessions SET payload_hash=? WHERE id=?",oldHash,play);
		postSummary(canonical,token,200); postSummary(body,token,200);
		postSummary(canonical.replace("\"consent\":false","\"consent\":true"),token,409);
		assertThat(summaryHash()).isEqualTo(oldHash);
	}
	@Test void chartMatchingAndDeletedResourcesDoNotBreakReplay() throws Exception {
		chart(); String body=PlayFixtures.scored(play,song,version);
		postSummary(body.replace("\"matchedNoteId\":\"n2\"","\"matchedNoteId\":\"absent\""),token,400);
		postSummary(body,token,201);
		db.update("UPDATE songs SET deleted_at=now() WHERE id=?",song);
		postSummary(body,token,200);
		assertThat(db.queryForObject("SELECT count(*) FROM hits WHERE play_session_id=? AND judgement='MISS' AND velocity IS NULL",Integer.class,play)).isEqualTo(1);
	}
	@Test void expiredAndInvalidSignatureAreRejectedBeforeReadingPayload() throws Exception {
		postSummary("not-json",jwt(user,Instant.now().minusSeconds(120)),401);
		String invalid=token.substring(0,token.lastIndexOf('.')+1)+"A".repeat(43);
		postSummary("not-json",invalid,401);
	}
	@Test void changedChartVersionIsRejectedBeforeWriting() {
		chart(); var p=read(PlayFixtures.scored(play,song,version));
		var checked=new PlaySessionRepository(db,json).chart(user,song,version);
		db.update("UPDATE chart_versions SET generator_version='changed' WHERE id=?",version);
		assertThatThrownBy(()->transaction.save(user,p,json.hash(user,p),checked,reportAggregator.aggregate(p))).isInstanceOfSatisfying(BusinessException.class,
				ex->assertThat(ex.getErrorCode()).isEqualTo(PlayErrorCode.PLAY_STATE_CHANGED));
		assertThat(count()).isZero();
	}
	@Test void laterBatchFailureRollsBackSessionAndEarlierBatch() {
		var root=(tools.jackson.databind.node.ObjectNode)json.mapper().readTree(PlayFixtures.free(play));
		var hits=root.putArray("hits");
		for(int i=0;i<501;i++) hits.addObject().put("seq",i==500?0:i).put("tMs",i).put("pad","SNARE").put("velocity",80);
		var p=read(root.toString());
		assertThatThrownBy(()->transaction.save(user,p,json.hash(user,p),null,null)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		assertThat(count()).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM hits WHERE play_session_id=?",Integer.class,play)).isZero();
	}
	@Test void concurrentIdenticalSummaryCreatesExactlyOneSession() throws Exception {
		var p=read(PlayFixtures.free(play)); var gate=new CountDownLatch(1);
		try(var pool=Executors.newFixedThreadPool(4)) {
			var tasks=new ArrayList<java.util.concurrent.Future<PlayUploadResponse>>();
			for(int i=0;i<4;i++) tasks.add(pool.submit(()->{gate.await();return service.upload(user,p);}));
			gate.countDown(); int created=0;
			for(var task:tasks) if(task.get(15,TimeUnit.SECONDS).created()) created++;
			assertThat(created).isEqualTo(1); assertThat(count()).isEqualTo(1);
		}
	}
	@Test void rawReplayRecompressionAndConflictDoNotOverwrite() throws Exception {
		postSummary(PlayFixtures.free(play),token,201);
		byte[] zipped=PlayFixtures.gzip(PlayFixtures.raw(play));
		raw(zipped,token,204); zipped[4]=7; raw(zipped,token,204);
		raw(PlayFixtures.gzip(PlayFixtures.raw(play)+" "),token,409); raw(zipped,otherToken,404);
		verify(store,times(1)).put(anyString(),anyLong(),any());
		postSummary(PlayFixtures.free(play),token,200);
		assertThat(db.queryForObject("SELECT raw_log_status FROM play_sessions WHERE id=?",String.class,play)).isEqualTo("UPLOADED");
	}
	@Test void latePutAfterDeleteIsRetiredAndDeletedAgain() throws Exception {
		postSummary(PlayFixtures.free(play),token,201);
		var entered=new CountDownLatch(1); var release=new CountDownLatch(1);
		doAnswer(i->{entered.countDown(); if(!release.await(10,TimeUnit.SECONDS)) throw new IllegalStateException("테스트 대기 초과"); objects.add(i.getArgument(0)); return null;})
				.when(store).put(anyString(),anyLong(),any());
		try(var pool=Executors.newSingleThreadExecutor()) {
			var upload=pool.submit(()->{raw(PlayFixtures.gzip(PlayFixtures.raw(play)),token,409);return null;});
			try {
				assertThat(entered.await(5,TimeUnit.SECONDS)).isTrue();
				db.update("UPDATE play_raw_uploads SET expires_at=now()-interval '1 second',created_at=now()-interval '1 minute' WHERE original_play_id=?",play);
				worker.runOnce();
				assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key LIKE ?",String.class,"play-raw/"+play+"/%")).isEqualTo("DELETED");
			} finally { release.countDown(); }
			upload.get(10,TimeUnit.SECONDS);
		}
		assertThat(objects).hasSize(1); worker.runOnce(); assertThat(objects).isEmpty();
		assertThat(db.queryForObject("SELECT raw_log_status FROM play_sessions WHERE id=?",String.class,play)).isEqualTo("PENDING");
	}
	@Test void deletedSessionAndReusedUuidCannotAcceptOldAttempt() {
		service.upload(user,read(PlayFixtures.free(play)));
		var a=receipts.begin(user,play,summaryHash(),new PlayRawValidator.Validated("a".repeat(64),100));
		db.update("DELETE FROM play_sessions WHERE id=?",play);
		service.upload(user,read(PlayFixtures.free(play)));
		assertThat(receipts.accept(user,play,a.id())).isEqualTo(PlayErrorCode.PLAY_STATE_CHANGED);
		assertThat(db.queryForObject("SELECT raw_log_status FROM play_sessions WHERE id=?",String.class,play)).isEqualTo("PENDING");
	}
	@Test void changedSummaryAfterRawValidationRejectsBeforeReceiptAndStorage() throws Exception {
		postSummary(PlayFixtures.free(play),token,201);
		String checkedHash=summaryHash();
		var validated=new CountDownLatch(1); var resume=new CountDownLatch(1);
		doAnswer(i->{
			Object result=i.callRealMethod();
			validated.countDown();
			if(!resume.await(10,TimeUnit.SECONDS)) throw new IllegalStateException("테스트 대기 초과");
			return result;
		}).when(rawValidator).validate(any(),eq(play),anyMap());
		try(var pool=Executors.newSingleThreadExecutor()) {
			var upload=pool.submit(()->{raw(PlayFixtures.gzip(PlayFixtures.raw(play)),token,409);return null;});
			try {
				assertThat(validated.await(5,TimeUnit.SECONDS)).isTrue();
				db.update("DELETE FROM play_sessions WHERE id=?",play);
				postSummary(PlayFixtures.free(play).replace("\"tMs\":-10.125","\"tMs\":-9.125"),token,201);
				assertThat(summaryHash()).isNotEqualTo(checkedHash);
			} finally { resume.countDown(); }
			upload.get(10,TimeUnit.SECONDS);
		}
		verifyNoInteractions(store);
		assertThat(db.queryForObject("SELECT count(*) FROM play_raw_uploads WHERE original_play_id=?",Integer.class,play)).isZero();
		assertThat(db.queryForObject("SELECT raw_log_status FROM play_sessions WHERE id=?",String.class,play)).isEqualTo("PENDING");
	}
	@Test void oldCleanupCompletionCannotOverwriteRearmAndPeriodicScanRemovesLateObject() {
		service.upload(user,read(PlayFixtures.free(play)));
		var a=receipts.begin(user,play,summaryHash(),new PlayRawValidator.Validated("b".repeat(64),100)); receipts.settle(a.id());
		var claim=worker.claim(); assertThat(claim).isNotNull();
		receipts.settle(a.id()); worker.finish(claim,true);
		assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,a.key())).isEqualTo("PENDING");
		worker.runOnce(); objects.add(a.key());
		db.update("UPDATE file_cleanup_tasks SET next_attempt_at=now() WHERE object_key=?",a.key());
		worker.runOnce(); assertThat(objects).isEmpty();
	}
	@Test void acceptedObjectSurvivesSettlementButDeletedSessionEventuallyCleansIt() throws Exception {
		postSummary(PlayFixtures.free(play),token,201); raw(PlayFixtures.gzip(PlayFixtures.raw(play)),token,204);
		UUID attempt=db.queryForObject("SELECT id FROM play_raw_uploads WHERE original_play_id=?",UUID.class,play);
		receipts.settle(attempt); worker.runOnce(); assertThat(objects).hasSize(1);
		db.update("DELETE FROM play_sessions WHERE id=?",play); worker.runOnce(); assertThat(objects).isEmpty();
	}
	@Test void schemaAllowsOnlyOneAcceptedReceiptAndNullsLiveReferenceOnDelete() {
		service.upload(user,read(PlayFixtures.free(play)));
		var a=receipts.begin(user,play,summaryHash(),new PlayRawValidator.Validated("a".repeat(64),100));
		var b=receipts.begin(user,play,summaryHash(),new PlayRawValidator.Validated("a".repeat(64),100));
		assertThat(receipts.accept(user,play,a.id())).isNull();
		assertThatThrownBy(()->db.update("UPDATE play_raw_uploads SET status='ACCEPTED' WHERE id=?",b.id()))
				.isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
		db.update("DELETE FROM play_sessions WHERE id=?",play);
		assertThat(db.queryForObject("SELECT count(*) FROM play_raw_uploads WHERE original_play_id=? AND play_session_id IS NULL",Integer.class,play)).isEqualTo(2);
	}
	@Test void withdrawalDuringPutRefusesAcceptanceAndCleansObject() throws Exception {
		postSummary(PlayFixtures.free(play),token,201);
		doAnswer(i->{objects.add(i.getArgument(0));db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?",user);return null;})
				.when(store).put(anyString(),anyLong(),any());
		raw(PlayFixtures.gzip(PlayFixtures.raw(play)),token,401); worker.runOnce(); assertThat(objects).isEmpty();
	}
	@Test void openApiDocumentsBothRoutesAndRequestSchema() throws Exception {
		mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
				.andExpect(jsonPath("$.paths['/api/v1/plays'].post.requestBody.content['application/json'].schema['$ref']").value("#/components/schemas/PlayUploadRequest"))
				.andExpect(jsonPath("$.paths['/api/v1/plays/{playId}/raw'].post.responses['204']").exists());
	}
	@Test void storageTimeoutAfterPutLeavesDurableCleanupAndDeletionFailureRetries() throws Exception {
		postSummary(PlayFixtures.free(play),token,201);
		doAnswer(i->{objects.add(i.getArgument(0));throw new BusinessException(PlayErrorCode.PLAY_RAW_STORAGE_UNAVAILABLE);})
				.when(store).put(anyString(),anyLong(),any());
		raw(PlayFixtures.gzip(PlayFixtures.raw(play)),token,503);
		doThrow(new BusinessException(PlayErrorCode.PLAY_RAW_STORAGE_UNAVAILABLE)).when(store).delete(anyString());
		worker.runOnce();
		assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key LIKE ?",String.class,"play-raw/"+play+"/%")).isEqualTo("FAILED");
		doAnswer(i->{objects.remove(i.getArgument(0));return null;}).when(store).delete(anyString());
		db.update("UPDATE file_cleanup_tasks SET next_attempt_at=now() WHERE object_key LIKE ?","play-raw/"+play+"/%");
		worker.runOnce(); assertThat(objects).isEmpty();
	}
	@Test void scoredUploadPersistsReportBeforeRawAndReplayPreservesAiResult() throws Exception {
		chart(); String body=PlayFixtures.scored(play,song,version).replace("RHYTHM","SHEET");
		postSummary(body,token,201);
		var report=db.queryForMap("SELECT timing_histogram::text,pad_stats::text,weak_segments,generator_version FROM reports WHERE play_session_id=?",play);
		assertThat(report.get("generator_version")).isEqualTo("BE_REPORT_V1");
		assertThat(report.get("weak_segments")).isNull();
		var pads=json.mapper().readTree((String) report.get("pad_stats"));
		assertThat(pads.get(1).get("accuracy").doubleValue()).isEqualTo(1d);
		assertThat(pads.get(1).get("meanDeltaMs").doubleValue()).isEqualTo(0.13);
		assertThat(pads.get(7).get("accuracy").doubleValue()).isZero();
		assertThat(pads.get(7).get("meanVelocity").isNull()).isTrue();
		assertThat(db.queryForObject("SELECT raw_log_status FROM play_sessions WHERE id=?",String.class,play)).isEqualTo("PENDING");
		db.update("UPDATE reports SET weak_segments='[]',generator_version='BE_REPORT_V1+AI_V1' WHERE play_session_id=?",play);
		postSummary(body,token,200);
		postSummary(body.replace("\"consent\":false","\"consent\":true"),token,409);
		assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isEqualTo(1);
		assertThat(db.queryForObject("SELECT generator_version FROM reports WHERE play_session_id=?",String.class,play)).isEqualTo("BE_REPORT_V1+AI_V1");
		assertThat(db.queryForObject("SELECT weak_segments::text FROM reports WHERE play_session_id=?",String.class,play)).isEqualTo("[]");
		verifyNoInteractions(store);
	}
	@Test void reportWriteFailureRollsBackSessionHitsAndInsertedReport() {
		chart(); var p=read(PlayFixtures.scored(play,song,version));
		ReportRepository target=org.springframework.test.util.AopTestUtils.getUltimateTargetObject(reports);
		doAnswer(i->{ i.callRealMethod(); throw new IllegalStateException("리포트 저장 실패 검사"); }).when(target).insert(eq(play),any());
		assertThatThrownBy(()->service.upload(user,p))
				.isInstanceOf(org.springframework.dao.InvalidDataAccessApiUsageException.class)
				.hasRootCauseInstanceOf(IllegalStateException.class);
		assertThat(count()).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM hits WHERE play_session_id=?",Integer.class,play)).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isZero();
	}
	@Test void concurrentScoredUploadsCreateOnlyOneReport() throws Exception {
		chart(); var p=read(PlayFixtures.scored(play,song,version)); var gate=new CountDownLatch(1);
		try(var pool=Executors.newFixedThreadPool(4)) {
			var tasks=new ArrayList<java.util.concurrent.Future<PlayUploadResponse>>();
			for(int i=0;i<4;i++) tasks.add(pool.submit(()->{gate.await();return service.upload(user,p);}));
			gate.countDown(); int created=0;
			for(var task:tasks) if(task.get(15,TimeUnit.SECONDS).created()) created++;
			assertThat(created).isEqualTo(1);
			assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isEqualTo(1);
		}
	}
	@Test void freeTempoAndHistoricalReplayDoNotCreateReports() {
		service.upload(user,read(PlayFixtures.free(play)));
		assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isZero();
		db.update("DELETE FROM play_sessions WHERE id=?",play);
		service.upload(user,read(PlayFixtures.free(play).replace("FREE","TEMPO")));
		assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isZero();
		db.update("DELETE FROM play_sessions WHERE id=?",play);
		chart(); var p=read(PlayFixtures.scored(play,song,version)); service.upload(user,p);
		db.update("DELETE FROM reports WHERE play_session_id=?",play);
		assertThat(service.upload(user,p).created()).isFalse();
		assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isZero();
	}
	@Test void chartChangeAfterAggregationRevalidatesAndAggregatesOutsideTransaction() {
		chart(); var p=read(PlayFixtures.scored(play,song,version));
		var first=new java.util.concurrent.atomic.AtomicBoolean(true);
		doAnswer(i->{
			assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
			Object result=i.callRealMethod();
			if(first.getAndSet(false)) db.update("UPDATE chart_versions SET generator_version='changed-after-aggregate' WHERE id=?",version);
			return result;
		}).when(reportAggregator).aggregate(any());
		assertThat(service.upload(user,p).created()).isTrue();
		verify(reportAggregator,times(2)).aggregate(any());
		assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isEqualTo(1);
	}
	@Test void deletionAfterReplayLookupRetriesWithFreshReport() {
		chart(); var p=read(PlayFixtures.scored(play,song,version)); service.upload(user,p);
		var first=new java.util.concurrent.atomic.AtomicBoolean(true);
		doAnswer(i->{
			Object result=i.callRealMethod();
			if(first.getAndSet(false)) db.update("DELETE FROM play_sessions WHERE id=?",play);
			return result;
		}).when(sessions).find(eq(play),eq(false));
		assertThat(service.upload(user,p).created()).isTrue();
		assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isEqualTo(1);
		assertThat(db.queryForObject("SELECT count(*) FROM hits WHERE play_session_id=?",Integer.class,play)).isEqualTo(2);
	}
	private void raw(byte[] data,String auth,int expected) throws Exception {
		mvc.perform(multipart("/api/v1/plays/"+play+"/raw").file(new MockMultipartFile("file","play.json.gz","application/gzip",data))
				.header("Authorization","Bearer "+auth)).andExpect(status().is(expected));
	}
	private void postSummary(String body,String auth,int expected) throws Exception {
		mvc.perform(post("/api/v1/plays").header("Authorization","Bearer "+auth).contentType("application/json").content(body)).andExpect(status().is(expected));
	}
	private PlayUploadRequest read(String s) { return json.read(new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8))); }
	private int count() { return db.queryForObject("SELECT count(*) FROM play_sessions WHERE id=?",Integer.class,play); }
	private String summaryHash() { return db.queryForObject("SELECT payload_hash FROM play_sessions WHERE id=?",String.class,play); }
	/** 외부 클라이언트와 같은 HS256 토큰을 만든다. 실제 인증 필터·서명 검사·DB ACTIVE 조회는 대체하지 않는다. */
	private static String jwt(long user,Instant expires) {
		try {
			var encoder=java.util.Base64.getUrlEncoder().withoutPadding();
			String header=encoder.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
			String claims=encoder.encodeToString(("{\"iss\":\"airdrum-api\",\"sub\":\""+user+"\",\"iat\":"+Instant.now().getEpochSecond()+",\"exp\":"+expires.getEpochSecond()+"}").getBytes(StandardCharsets.UTF_8));
			var mac=javax.crypto.Mac.getInstance("HmacSHA256");
			mac.init(new javax.crypto.spec.SecretKeySpec("test-only-jwt-secret-0123456789ab".getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
			return header+"."+claims+"."+encoder.encodeToString(mac.doFinal((header+"."+claims).getBytes(StandardCharsets.UTF_8)));
		} catch(java.security.GeneralSecurityException ex) { throw new IllegalStateException(ex); }
	}
	private void chart() {
		song=db.queryForObject("INSERT INTO songs(owner_id,title,source) VALUES(?,'플레이 채보','MIDI') RETURNING id",Long.class,user);
		chart=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'NORMAL') RETURNING id",Long.class,song);
		version=db.queryForObject("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,?::jsonb,'{}','PENDING',2,'MANUAL') RETURNING id",Long.class,chart,PlayPayloadTest.chart().notes());
	}
}

package com.ssafy.airdrum.domain.recording.service;

import java.sql.SQLException;
import java.util.Set;

import org.springframework.dao.DataAccessException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.domain.recording.dto.RecordingRequest;
import com.ssafy.airdrum.domain.recording.exception.RecordingError;
import com.ssafy.airdrum.domain.recording.model.RecordingJson;
import com.ssafy.airdrum.domain.recording.repository.RecordingRepository;
import com.ssafy.airdrum.domain.recording.validation.RecordingValidator;
import com.ssafy.airdrum.domain.chart.model.ChartDocumentReader;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.global.response.PageResponse;
import com.ssafy.airdrum.domain.recording.dto.RecordingResponses.RecordingDetail;
import com.ssafy.airdrum.domain.recording.dto.RecordingResponses.RecordingSummary;
import com.ssafy.airdrum.domain.recording.dto.RecordingResponses.RecordingTiming;

/**
 * 연주 녹음 저장(256번 설계 4-1절). 검사·정렬·해시는 트랜잭션 밖에서 하고, 트랜잭션 안에서는 회원 행을 잠근 뒤
 * 같은 키 재전송 판정 → 플레이 연결 확인 → 상한 확인 → INSERT 순서로 처리한다.
 */
@Service
public class RecordingService {
	static final long MAX_RECORDINGS = 200;

	public record Saved(RecordingSummary summary, boolean created) {
	}

	private final RecordingRepository recordings;
	private final RecordingValidator validator;
	private final RecordingJson json;
	private final ChartDocumentReader charts;
	private final TransactionTemplate tx;

	/** 탈퇴 트랜잭션에서 지운 녹음을 포함한 회원의 모든 녹음을 삭제한다. */
	@Transactional(propagation = Propagation.MANDATORY)
	public int deleteForWithdrawal(long userId) { return recordings.deleteAllByUserId(userId); }

	RecordingService(RecordingRepository recordings, RecordingValidator validator, RecordingJson json, ChartDocumentReader charts,
			PlatformTransactionManager manager) {
		this.recordings = recordings;
		this.validator = validator;
		this.json = json;
		this.charts = charts;
		this.tx = new TransactionTemplate(manager);
		this.tx.setTimeout(15);
	}

	public Saved save(long user, RecordingRequest request) {
		var r = validator.normalize(request);
		String hash = json.hash(user, r);
		String hits = json.hitsJson(r);
		try {
			return tx.execute(s -> {
				recordings.limitWaits();
				if (!recordings.lockActiveUser(user)) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
				var existing = recordings.findLive(user, r.clientKey());
				if (existing.isPresent()) {
					if (!existing.get().hash().equals(hash)) throw new BusinessException(RecordingError.RECORDING_CONFLICT);
					return new Saved(existing.get().summary(), false);
				}
				Long chartVersion = null;
				if (r.playId() != null) {
					// 플레이의 채보 버전을 녹음에 기록해 플레이가 지워져도 곡·timing이 남게 한다(257 v0.7).
					chartVersion = recordings.linkablePlay(user, r.playId())
							.orElseThrow(() -> new BusinessException(RecordingError.RECORDING_PLAY_NOT_FOUND)).chartVersionId();
				}
				if (recordings.liveCount(user) >= MAX_RECORDINGS) throw new BusinessException(RecordingError.RECORDING_QUOTA_EXCEEDED);
				long id = recordings.insert(user, r, chartVersion, hits, hash);
				return new Saved(recordings.find(user, id).orElseThrow().summary(), true);
			});
		} catch (DataAccessException ex) {
			if (waitExceeded(ex)) throw new BusinessException(RecordingError.RECORDING_BUSY);
			throw ex;
		}
	}

	/** 257 보관함 목록. 본인의 살아 있는 녹음만, 녹음 시작 시각 기준 정렬(v0.7), 모드 필터 선택. */
	public PageResponse<RecordingSummary> list(long user, String q, String mode, String sort, int page, int size) {
		String pattern = RecordingValidator.searchPattern(q);
		String filter = RecordingValidator.modeFilter(mode);
		boolean newest = RecordingValidator.newest(sort);
		return PageResponse.of(recordings.page(user, pattern, filter, newest, size, (long) page * size), page, size,
				recordings.count(user, pattern, filter));
	}

	/** 257 보관함 상세. 남의 것·지운 것·없는 것은 404. timing은 녹음이 기억한 채보 버전 값이다(U13 c, v0.7). */
	public RecordingDetail detail(long user, long id) {
		var row = recordings.findDetail(user, id).orElseThrow(() -> new BusinessException(RecordingError.RECORDING_NOT_FOUND));
		RecordingTiming timing = null;
		if (row.chartVersionId() != null) {
			var t = charts.timing(row.timingJson());
			timing = new RecordingTiming(row.songId(), row.chartVersionId(), t.bpm(), t.offsetMs(), t.timeSignature(), t.ppq(),
					t.tempoMap(), t.timeSignatureMap());
		}
		return RecordingDetail.of(row.summary(), timing, json.readHits(row.hitsJson()));
	}

	/** 257 제목 변경. 저장 때의 payload_hash는 다시 계산하지 않는다(U14). */
	public RecordingSummary rename(long user, long id, String title) {
		return inTransaction(() -> {
			if (!recordings.lockOwn(user, id)) throw new BusinessException(RecordingError.RECORDING_NOT_FOUND);
			recordings.rename(id, title);
			return recordings.find(user, id).orElseThrow().summary();
		});
	}

	/** 257 삭제. 소프트 삭제하고 플레이 연결을 비운다(U15). */
	public void delete(long user, long id) {
		inTransaction(() -> {
			if (!recordings.lockOwn(user, id)) throw new BusinessException(RecordingError.RECORDING_NOT_FOUND);
			recordings.softDelete(id);
			return null;
		});
	}

	private <T> T inTransaction(java.util.function.Supplier<T> work) {
		try {
			return tx.execute(s -> {
				recordings.limitWaits();
				return work.get();
			});
		} catch (DataAccessException ex) {
			if (waitExceeded(ex)) throw new BusinessException(RecordingError.RECORDING_BUSY);
			throw ex;
		}
	}

	/** 잠금·문장 제한 3초·10초 초과. PostgreSQL 55P03은 Spring에서 UncategorizedSQLException으로 오므로 SQLState로도 판별한다(검증 D1). */
	private static final Set<String> WAIT_STATES = Set.of("55P03", "57014");

	static boolean waitExceeded(DataAccessException ex) {
		if (ex instanceof QueryTimeoutException || ex instanceof PessimisticLockingFailureException) return true;
		for (Throwable t = ex; t != null; t = t.getCause())
			if (t instanceof SQLException sql && WAIT_STATES.contains(sql.getSQLState())) return true;
		return false;
	}
}

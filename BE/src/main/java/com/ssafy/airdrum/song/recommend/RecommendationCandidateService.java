package com.ssafy.airdrum.song.recommend;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.common.error.BusinessException;

/**
 * AI 배치가 만든 후보의 적재와 조회(설계 문서 부록 C.4). 요청 경로에서 AI를 부르지 않고 저장된 곡 id 목록만 쓴다.
 * 동의는 뷰, 적재, 서빙 세 곳에서 확인한다. 사용자 키와 사용자 id는 로그·응답·오류에 쓰지 않는다.
 */
@Service
public class RecommendationCandidateService {
	static final int MAX_SONGS = 50, MAX_USERS = 20_000, MAX_NAME = 64;
	private static final Pattern USER_KEY = Pattern.compile("[0-9a-f]{32}");

	public record UserCandidates(String userKey, List<Long> songIds) {}
	public record Upload(String batchId, String modelVersion, String generatedAt, List<UserCandidates> users) {}
	public record UploadResult(int accepted, int droppedUnknown, int droppedNoConsent) {}
	public record Status(String modelVersion, Instant generatedAt, long usersWithCandidates) {}

	private final JdbcTemplate db;
	private final RecommendationR3Settings settings;

	public RecommendationCandidateService(JdbcTemplate db, RecommendationR3Settings settings) {
		this.db = db; this.settings = settings;
	}

	/**
	 * 사용자별 후보를 새 값으로 바꾼다. 같은 본문을 다시 보내도 결과가 같다. 알 수 없는 사용자와 동의가 없는 사용자는 오류가 아니라
	 * 버리고 개수만 돌려준다. 이미 더 새로운 배치가 들어 있는 사용자는 건드리지 않는다(늦게 도착한 재전송이 덮어쓰지 않게).
	 */
	@Transactional
	public UploadResult upload(Upload body) {
		if (!settings.hasKeySecret()) throw new BusinessException(RecommendationErrorCode.CANDIDATES_NOT_CONFIGURED);
		Instant generatedAt = validate(body);
		if (!settings.accepts(body.modelVersion())) throw new BusinessException(RecommendationErrorCode.MODEL_VERSION_NOT_ACCEPTED);

		// 동의 행을 잠가 적재 중에 철회가 끼어들어 지운 뒤에 후보가 남는 일을 막는다
		var agreed = new HashSet<>(db.queryForList("SELECT user_id FROM user_recommendation_consent WHERE agreed FOR SHARE", Long.class));
		var idByKey = new HashMap<String, Long>();
		for (long id : db.queryForList("SELECT id FROM users WHERE status = 'ACTIVE'", Long.class)) idByKey.put(settings.userKey(id), id);
		var servable = new HashSet<>(db.queryForList("SELECT song_id FROM recommend_songs_v", Long.class));

		int accepted = 0, unknown = 0, noConsent = 0;
		var rows = new ArrayList<Object[]>();
		for (var user : body.users()) {
			Long id = idByKey.get(user.userKey());
			if (id == null) { unknown++; continue; }
			if (!agreed.contains(id)) { noConsent++; continue; }
			accepted++;
			if (hasNewerBatch(id, generatedAt)) continue;
			db.update("DELETE FROM recommendation_candidates WHERE user_id = ?", id);
			int rank = 0;
			for (long song : user.songIds()) {
				if (!servable.contains(song)) continue; // 배치 뒤에 내려간 곡
				rows.add(new Object[] { id, ++rank, song, body.modelVersion(), body.batchId(), Timestamp.from(generatedAt) });
			}
		}
		db.batchUpdate("INSERT INTO recommendation_candidates(user_id, rank, song_id, model_version, batch_id, generated_at) VALUES (?, ?, ?, ?, ?, ?)", rows);
		return new UploadResult(accepted, unknown, noConsent);
	}

	private boolean hasNewerBatch(long userId, Instant generatedAt) {
		return Boolean.TRUE.equals(db.queryForObject(
				"SELECT EXISTS(SELECT 1 FROM recommendation_candidates WHERE user_id = ? AND generated_at > ?)",
				Boolean.class, userId, Timestamp.from(generatedAt)));
	}

	private Instant validate(Upload body) {
		if (body == null || !name(body.batchId()) || !name(body.modelVersion()) || body.generatedAt() == null || body.users() == null
				|| body.users().size() > MAX_USERS) throw invalid();
		var keys = new HashSet<String>();
		for (var user : body.users()) {
			if (user == null || user.userKey() == null || !USER_KEY.matcher(user.userKey()).matches() || !keys.add(user.userKey())) throw invalid();
			var songs = user.songIds();
			if (songs == null || songs.size() > MAX_SONGS || songs.stream().anyMatch(s -> s == null || s <= 0) || new HashSet<>(songs).size() != songs.size()) throw invalid();
		}
		try { return Instant.parse(body.generatedAt()); }
		catch (DateTimeParseException ex) { throw invalid(); }
	}

	private static boolean name(String value) { return value != null && !value.isBlank() && value.length() <= MAX_NAME; }
	private static BusinessException invalid() { return new BusinessException(RecommendationErrorCode.CANDIDATES_INVALID); }

	/** 가장 최근 배치의 모델과 시각, 후보가 있는 사용자 수(집계만). */
	@Transactional(readOnly = true)
	public Status status() {
		long users = db.queryForObject("SELECT count(DISTINCT user_id) FROM recommendation_candidates", Long.class);
		var latest = db.query("SELECT model_version, generated_at FROM recommendation_candidates ORDER BY generated_at DESC LIMIT 1",
				(r, n) -> new Status(r.getString(1), r.getTimestamp(2).toInstant(), users));
		return latest.isEmpty() ? new Status(null, null, 0) : latest.getFirst();
	}

	/**
	 * 지금 이 사용자에게 쓸 후보(순위 순). 켜져 있고, 롤아웃 대상이고, 동의했고, 허용된 모델의 낡지 않은 후보일 때만 돌려주고
	 * 하나라도 어긋나면 빈 목록이다(R1로 응답한다). 꺼져 있으면 DB도 읽지 않는다.
	 */
	public List<Long> usableSongs(long userId, Instant now) {
		if (!settings.enabled() || !settings.inRollout(userId)) return List.of();
		record Row(long songId, String model, Instant generatedAt) {}
		var rows = db.query("""
				SELECT rc.song_id, rc.model_version, rc.generated_at FROM recommendation_candidates rc
				JOIN user_recommendation_consent c ON c.user_id = rc.user_id AND c.agreed
				WHERE rc.user_id = ? ORDER BY rc.rank
				""", (r, n) -> new Row(r.getLong(1), r.getString(2), r.getTimestamp(3).toInstant()), userId);
		if (rows.isEmpty()) return List.of();
		var first = rows.getFirst();
		if (!settings.accepts(first.model()) || first.generatedAt().isBefore(now.minus(Duration.ofDays(settings.maxAgeDays())))) return List.of();
		return rows.stream().map(Row::songId).toList();
	}
}

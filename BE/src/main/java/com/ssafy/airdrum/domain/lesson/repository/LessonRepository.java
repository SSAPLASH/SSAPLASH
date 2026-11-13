package com.ssafy.airdrum.domain.lesson.repository;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.domain.lesson.model.LessonCourse;
import com.ssafy.airdrum.domain.lesson.model.LessonKind;
import com.ssafy.airdrum.domain.lesson.model.LessonSpec;

/** 레슨(331번 설계 3-2절). 레슨 정보는 카탈로그가 유일한 출처라 통째로 바꾼다. */
@Repository
public class LessonRepository {

	/**
	 * 레슨 곡이 아닌 공용 곡만 고르는 SQL 조건. 곡 별칭이 {@code s}인 쿼리의 WHERE에 붙인다.
	 * 곡 목록·추천·비슷한 곡 후보가 쓴다. 곡 상세·채보 조회·연주 저장은 레슨 곡도 받아야 하므로 쓰지 않는다.
	 */
	public static final String NOT_LESSON = " NOT EXISTS (SELECT 1 FROM lessons l WHERE l.song_id = s.id) ";

	/** 공개 공용 곡인 레슨 곡. */
	private static final String VISIBLE_LESSON = """
			FROM lessons l JOIN songs s ON s.id = l.song_id AND s.deleted_at IS NULL AND s.source = 'BUILTIN' AND s.owner_id IS NULL
			  AND s.status = 'READY' AND s.published
			""";

	/** 코스 순서(LessonCourse 선언 순서) → 코스 안 순서. 잠금은 이 한 줄에서 계산한다(학습 코스 설계 3-3절). */
	private static final String COURSE_ORDER = "array_position(ARRAY[" + java.util.Arrays.stream(LessonCourse.values())
			.map(c -> "'" + c.name() + "'").collect(java.util.stream.Collectors.joining(",")) + "]::varchar[], l.course::varchar)";

	public record Row(LessonCourse course, int position, LessonKind kind, String summary, List<String> pads, boolean guide, long songId, String title,
			BigDecimal bpm, Integer durationMs, long chartId, int noteCount) {
	}

	private final JdbcTemplate db;
	private final JsonMapper json;

	LessonRepository(JdbcTemplate db, JsonMapper json) {
		this.db = db;
		this.json = json;
	}

	/** 카탈로그 레슨으로 통째로 바꾼다. {@code lessons}는 곡 id → 레슨 정보다. 빈 맵이면 레슨을 모두 지운다. */
	public void replaceAll(Map<Long, LessonSpec> lessons) {
		db.update("DELETE FROM lessons");
		for (var entry : lessons.entrySet()) {
			var spec = entry.getValue();
			db.update("INSERT INTO lessons(song_id,course,position,kind,summary,pads,guide,updated_at) VALUES(?,?,?,?,?,?::jsonb,?,now())",
					entry.getKey(), spec.course().name(), spec.order(), spec.kind().name(), spec.summary(), json.writeValueAsString(spec.pads()), spec.guide());
		}
	}

	/** 공개 공용 곡인 레슨을 코스 순서 → 코스 안 순서대로. 채보는 NORMAL 최신 버전이고 NORMAL이 없는 곡은 빠진다. */
	public List<Row> visible() {
		return db.query("SELECT l.course, l.position, l.kind, l.summary, l.pads::text, l.guide, s.id, s.title, s.bpm, s.duration_ms, c.id, v.note_count "
				+ VISIBLE_LESSON + """
				JOIN charts c ON c.song_id = s.id AND c.difficulty = 'NORMAL'
				JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)
				ORDER BY""" + " " + COURSE_ORDER + ", l.position", (r, n) -> new Row(LessonCourse.valueOf(r.getString(1)), r.getInt(2),
				LessonKind.valueOf(r.getString(3)), r.getString(4), pads(r.getString(5)), r.getBoolean(6), r.getLong(7), r.getString(8),
				r.getBigDecimal(9), r.getObject(10, Integer.class), r.getLong(11), r.getInt(12)));
	}

	/** 공개 공용 곡인 레슨의 종류. 레슨이 아니거나 볼 수 없는 곡이면 비어 있다. */
	public Optional<LessonKind> kind(long songId) {
		return db.query("SELECT l.kind " + VISIBLE_LESSON + " WHERE l.song_id = ?", (r, n) -> LessonKind.valueOf(r.getString(1)), songId)
				.stream().findFirst();
	}

	public Set<Long> completed(long userId) {
		return new HashSet<>(db.queryForList("SELECT song_id FROM lesson_completions WHERE user_id = ?", Long.class, userId));
	}

	/** 처음 완료한 시각을 지킨다. */
	public void complete(long userId, long songId) {
		db.update("INSERT INTO lesson_completions(user_id,song_id) VALUES(?,?) ON CONFLICT (user_id, song_id) DO NOTHING", userId, songId);
	}

	public int deleteCompletions(long userId) {
		return db.update("DELETE FROM lesson_completions WHERE user_id = ?", userId);
	}

	private List<String> pads(String raw) {
		var list = new ArrayList<String>();
		json.readTree(raw).forEach(n -> list.add(n.asString()));
		return List.copyOf(list);
	}
}

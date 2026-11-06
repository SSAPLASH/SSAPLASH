package com.ssafy.airdrum.song.recommend;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.song.recommend.DrillPlanner.Weakness;

/**
 * 연습 추천의 사용자별 입력을 읽는다. 리포트의 약점과 방금 친 곡·채보 밀도다.
 * 분석이 끝나지 않았거나 실패한 리포트는 {@code weak_segments}가 null이라 약점이 없는 것과 같게 빈 목록이다.
 */
@Component
class DrillInputs {
	/** 심각도를 읽지 못한 약점에 쓰는 값. R1의 약점 가중치와 같다. */
	static final double DEFAULT_SEVERITY = 0.5;

	/** {@code playedDensity}는 그 채보의 특징이 없으면 null이다. */
	record Inputs(List<Weakness> weaknesses, Long playedSongId, Double playedDensity) {}

	private final JdbcTemplate db;
	private final JsonMapper json;

	DrillInputs(JdbcTemplate db, JsonMapper json) { this.db = db; this.json = json; }

	/** 소유 확인은 호출 쪽이 한다. */
	Inputs read(UUID playId) {
		var rows = db.query("""
				SELECT CAST(r.weak_segments AS text), p.song_id, f.avg_notes_per_sec
				FROM play_sessions p
				LEFT JOIN reports r ON r.play_session_id = p.id
				LEFT JOIN chart_features f ON f.chart_version_id = p.chart_version_id
				WHERE p.id = ?
				""", (r, n) -> {
					var density = r.getBigDecimal(3); // numeric. getObject(Double.class)로는 읽지 못한다
					return new Inputs(weaknesses(r.getString(1)), r.getObject(2, Long.class), density == null ? null : density.doubleValue());
				}, playId);
		return rows.isEmpty() ? new Inputs(List.of(), null, null) : rows.getFirst();
	}

	/** 형식이 어긋난 항목은 건너뛴다. 약점 하나가 망가졌다고 연습 추천 전체를 실패시키지 않는다. */
	List<Weakness> weaknesses(String raw) {
		if (raw == null) return List.of();
		JsonNode array;
		try { array = json.readTree(raw); } catch (RuntimeException ex) { return List.of(); }
		if (array == null || !array.isArray()) return List.of();
		var out = new ArrayList<Weakness>();
		for (var segment : array) {
			String pattern = segment.path("pattern").asString("");
			if (pattern.isBlank()) continue;
			var pads = new ArrayList<String>();
			for (var pad : segment.path("pads")) if (pad.isString() && !pad.asString().isBlank()) pads.add(pad.asString());
			var severity = segment.path("metrics").path("severity");
			out.add(new Weakness(pattern, List.copyOf(pads), severity.isNumber() ? Math.max(0, Math.min(1, severity.doubleValue())) : DEFAULT_SEVERITY));
		}
		return List.copyOf(out);
	}
}

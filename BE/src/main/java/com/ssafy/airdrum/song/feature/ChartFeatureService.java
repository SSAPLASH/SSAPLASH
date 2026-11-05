package com.ssafy.airdrum.song.feature;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.chart.ChartDocumentReader;
import com.ssafy.airdrum.common.error.BusinessException;

/**
 * 곡의 각 채보 최신 버전에 대해 특징을 계산해 저장한다. 이미 현재 규칙 버전으로 저장된 버전은 건너뛰므로 여러 번 불러도 된다.
 * 입력 오류는 그 채보만 건너뛴다(채보 생성·난이도 산정은 이 계산과 무관하게 성공한다).
 */
@Service
public class ChartFeatureService {
	public static final String VERSION = "chart-features-1";
	private static final Logger log = LoggerFactory.getLogger(ChartFeatureService.class);
	private record Row(long versionId, int schema, int noteCount, String notes, Integer durationMs) {}
	private final JdbcTemplate db;
	private final ChartDocumentReader reader;
	private final JsonMapper json;

	public ChartFeatureService(JdbcTemplate db, ChartDocumentReader reader, JsonMapper json) {
		this.db = db; this.reader = reader; this.json = json;
	}

	/** 새로 저장하거나 갱신한 개수를 돌려준다. */
	@Transactional(propagation = Propagation.REQUIRES_NEW)
	public int computeForSong(long songId) {
		var rows = db.query("""
				SELECT v.id, v.schema_version, v.note_count, CAST(v.notes AS text), s.duration_ms
				FROM songs s JOIN charts c ON c.song_id = s.id
				JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)
				WHERE s.id = ? AND s.deleted_at IS NULL
				  AND NOT EXISTS (SELECT 1 FROM chart_features f WHERE f.chart_version_id = v.id AND f.feature_version = ?)
				""", (r, n) -> new Row(r.getLong(1), r.getInt(2), r.getInt(3), r.getString(4), r.getObject(5, Integer.class)), songId, VERSION);
		int stored = 0;
		for (var row : rows) {
			ChartFeatures features;
			String pads, transitions;
			try {
				if (row.durationMs() == null || row.durationMs() <= 0) continue;
				ChartDocumentReader.requireSchema(row.schema());
				features = ChartFeatures.compute(reader.notes(row.notes(), row.noteCount()), row.durationMs());
				pads = json.writeValueAsString(features.padRatio());
				transitions = json.writeValueAsString(features.transitionRatio());
			} catch (IllegalStateException | IllegalArgumentException | BusinessException ex) {
				log.warn("채보 특징 계산 입력 오류 songId={} versionId={}", songId, row.versionId());
				continue;
			}
			db.update("""
					INSERT INTO chart_features(chart_version_id, feature_version, avg_notes_per_sec, peak_notes_2s, pad_ratio, transition_ratio)
					VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb)
					ON CONFLICT (chart_version_id) DO UPDATE SET feature_version = EXCLUDED.feature_version,
					  avg_notes_per_sec = EXCLUDED.avg_notes_per_sec, peak_notes_2s = EXCLUDED.peak_notes_2s,
					  pad_ratio = EXCLUDED.pad_ratio, transition_ratio = EXCLUDED.transition_ratio, created_at = now()
					""", row.versionId(), VERSION, features.avgNotesPerSec(), features.peakNotes2s(), pads, transitions);
			stored++;
		}
		return stored;
	}

	/** 특징이 없거나 규칙 버전이 낡은 채보가 있는 곡 id. 백필 한 번에 {@code limit}곡까지. */
	public List<Long> songsMissingFeatures(int limit) {
		return db.queryForList("""
				SELECT DISTINCT s.id FROM songs s JOIN charts c ON c.song_id = s.id
				JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)
				WHERE s.deleted_at IS NULL AND s.status = 'READY' AND s.duration_ms > 0
				  AND NOT EXISTS (SELECT 1 FROM chart_features f WHERE f.chart_version_id = v.id AND f.feature_version = ?)
				ORDER BY s.id LIMIT ?
				""", Long.class, VERSION, limit);
	}
}

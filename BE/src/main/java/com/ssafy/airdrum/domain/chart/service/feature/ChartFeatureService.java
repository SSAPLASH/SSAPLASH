package com.ssafy.airdrum.domain.chart.service.feature;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.domain.chart.model.ChartFeatures;
import com.ssafy.airdrum.domain.chart.model.RhythmGrid;
import com.ssafy.airdrum.domain.chart.model.ChartDocumentReader;
import com.ssafy.airdrum.global.error.BusinessException;

/**
 * 곡의 각 채보 최신 버전에 대해 특징과 리듬 격자(R2)를 계산해 저장한다. 현재 규칙 버전으로 저장되고 리듬 격자도 채워진
 * (제외 표시 포함) 버전은 건너뛰므로 여러 번 불러도 같다.
 * 입력 오류는 그 채보만 건너뛴다(채보 생성·난이도 산정은 이 계산과 무관하게 성공한다).
 */
@Service
public class ChartFeatureService {
	public static final String VERSION = "chart-features-1";
	private static final Logger log = LoggerFactory.getLogger(ChartFeatureService.class);
	private record Row(long versionId, int schema, int noteCount, String notes, Integer durationMs, String timing) {}
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
				SELECT v.id, v.schema_version, v.note_count, CAST(v.notes AS text), s.duration_ms, CAST(v.timing AS text)
				FROM songs s JOIN charts c ON c.song_id = s.id
				JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)
				WHERE s.id = ? AND s.deleted_at IS NULL
				  AND NOT EXISTS (SELECT 1 FROM chart_features f WHERE f.chart_version_id = v.id AND f.feature_version = ? AND f.rhythm_grid IS NOT NULL)
				""", (r, n) -> new Row(r.getLong(1), r.getInt(2), r.getInt(3), r.getString(4), r.getObject(5, Integer.class), r.getString(6)), songId, VERSION);
		int stored = 0;
		for (var row : rows) {
			ChartFeatures features;
			RhythmGrid.Result grid;
			String pads, transitions, gridJson;
			try {
				if (row.durationMs() == null || row.durationMs() <= 0) continue;
				ChartDocumentReader.requireSchema(row.schema());
				var notes = reader.notes(row.notes(), row.noteCount());
				features = ChartFeatures.compute(notes, row.durationMs());
				grid = rhythmGrid(notes, row.timing());
				pads = json.writeValueAsString(features.padRatio());
				transitions = json.writeValueAsString(features.transitionRatio());
				gridJson = json.writeValueAsString(grid.document());
			} catch (IllegalStateException | IllegalArgumentException | BusinessException ex) {
				log.warn("채보 특징 계산 입력 오류 songId={} versionId={}", songId, row.versionId());
				continue;
			}
			db.update("""
					INSERT INTO chart_features(chart_version_id, feature_version, avg_notes_per_sec, peak_notes_2s, pad_ratio, transition_ratio, rhythm_grid)
					VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
					ON CONFLICT (chart_version_id) DO UPDATE SET feature_version = EXCLUDED.feature_version,
					  avg_notes_per_sec = EXCLUDED.avg_notes_per_sec, peak_notes_2s = EXCLUDED.peak_notes_2s,
					  pad_ratio = EXCLUDED.pad_ratio, transition_ratio = EXCLUDED.transition_ratio,
					  rhythm_grid = EXCLUDED.rhythm_grid, created_at = now()
					""", row.versionId(), VERSION, features.avgNotesPerSec(), features.peakNotes2s(), pads, transitions, gridJson);
			stored++;
		}
		return stored;
	}

	/** 박자 정보가 망가진 채보도 기본 특징은 저장해야 하므로, 격자만 INVALID_TIMING으로 표시한다. */
	private RhythmGrid.Result rhythmGrid(List<com.ssafy.airdrum.domain.chart.dto.ChartResponses.Note> notes, String timingJson) {
		try { return RhythmGrid.compute(notes, reader.timing(timingJson)); }
		catch (IllegalStateException | BusinessException ex) { return RhythmGrid.excluded(RhythmGrid.INVALID_TIMING); }
	}

	/** 특징이 없거나 규칙 버전이 낡은 채보가 있는 곡 id. 백필 한 번에 {@code limit}곡까지. */
	public List<Long> songsMissingFeatures(int limit) {
		return db.queryForList("""
				SELECT DISTINCT s.id FROM songs s JOIN charts c ON c.song_id = s.id
				JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)
				WHERE s.deleted_at IS NULL AND s.status = 'READY' AND s.duration_ms > 0
				  AND NOT EXISTS (SELECT 1 FROM chart_features f WHERE f.chart_version_id = v.id AND f.feature_version = ? AND f.rhythm_grid IS NOT NULL)
				ORDER BY s.id LIMIT ?
				""", Long.class, VERSION, limit);
	}
}

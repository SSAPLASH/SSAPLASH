package com.ssafy.airdrum.domain.chart.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import com.ssafy.airdrum.domain.chart.entity.ChartVersion;
import com.ssafy.airdrum.domain.song.repository.SongRepository;

public interface ChartVersionRepository extends Repository<ChartVersion, Long> {
	String JOIN = " FROM chart_versions v JOIN charts c ON c.id = v.chart_id JOIN songs s ON s.id = c.song_id ";
	String META = """
		SELECT c.id AS "chartId", c.song_id AS "songId", c.difficulty, v.id AS "chartVersionId",
		 v.version, v.schema_version AS "schemaVersion", v.note_count AS "noteCount",
		 v.notation_status AS "notationStatus", s.title, s.source, s.status,
		 s.duration_ms AS "durationMs", CAST(v.timing AS text) AS timing,
		 CAST(v.sheet_pages AS text) AS "sheetPages"
		""";
	String LATEST = " v.version = (SELECT max(v2.version) FROM chart_versions v2 WHERE v2.chart_id = c.id) ";
	@Query(value = META + ", CAST(v.notes AS text) AS notes " + JOIN +
			" WHERE c.id = :id AND " + LATEST + " AND " + SongRepository.VISIBLE, nativeQuery = true)
	Optional<Detail> latest(@Param("id") long id, @Param("userId") long userId);
	@Query(value = META + ", CAST(v.notes AS text) AS notes " + JOIN +
			" WHERE v.id = :id AND " + SongRepository.VISIBLE, nativeQuery = true)
	Optional<Detail> version(@Param("id") long id, @Param("userId") long userId);
	@Query(value = META + ", s.accompaniment_key AS \"accompanimentKey\" " + JOIN +
			" WHERE v.id = :id AND " + SongRepository.VISIBLE, nativeQuery = true)
	Optional<Assets> assets(@Param("id") long id, @Param("userId") long userId);
	@Query(value = """
		SELECT c.song_id AS "songId", c.id AS "chartId", c.difficulty,
		 v.id AS "chartVersionId", v.version, v.note_count AS "noteCount", v.notation_status AS "notationStatus"
		""" + JOIN + " WHERE c.song_id IN (:ids) AND s.status = 'READY' AND " + LATEST +
			" AND " + SongRepository.VISIBLE +
			" ORDER BY c.song_id, CASE c.difficulty WHEN 'EASY' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END", nativeQuery = true)
	List<Summary> summaries(@Param("ids") Collection<Long> ids, @Param("userId") long userId);

	interface Summary {
		Long getSongId(); Long getChartId(); String getDifficulty(); Long getChartVersionId();
		int getVersion(); int getNoteCount(); String getNotationStatus();
	}
	interface Metadata extends Summary {
		int getSchemaVersion(); String getTitle(); String getSource(); String getStatus();
		Integer getDurationMs(); String getTiming(); String getSheetPages();
	}
	interface Detail extends Metadata { String getNotes(); }
	interface Assets extends Metadata { String getAccompanimentKey(); }
}

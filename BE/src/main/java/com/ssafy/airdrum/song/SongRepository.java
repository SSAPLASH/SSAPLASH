package com.ssafy.airdrum.song;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface SongRepository extends Repository<Song, Long> {
	String COLUMNS = """
		SELECT s.id, s.title, s.artist, s.source, s.status, s.bpm,
		 s.time_signature AS "timeSignature", s.duration_ms AS "durationMs",
		 (s.accompaniment_key IS NOT NULL) AS "hasAccompaniment",
		 CASE WHEN s.accompaniment_key IS NOT NULL THEN 'READY'
		      WHEN s.source = 'MIDI' THEN COALESCE((SELECT CASE
		        WHEN m.status IN ('QUEUED','RUNNING') THEN 'GENERATING'
		        WHEN m.status = 'FAILED' THEN 'FAILED' ELSE 'NONE' END
		        FROM midi_accompaniment_jobs m WHERE m.song_id=s.id ORDER BY m.id DESC LIMIT 1), 'NONE')
		      ELSE 'NONE' END AS "accompanimentStatus",
		 s.created_at AS "createdAt", s.license, s.updated_at AS "updatedAt", s.cover_key AS "coverKey", s.owner_id AS "ownerId",
		 s.song_level AS "songLevel",
		 (SELECT j.status FROM chart_jobs j WHERE j.song_id=s.id AND j.user_id=:userId AND s.owner_id=:userId ORDER BY j.created_at DESC,j.id DESC LIMIT 1) AS "jobStatus",
		 (SELECT j.error_code FROM chart_jobs j WHERE j.song_id=s.id AND j.user_id=:userId AND s.owner_id=:userId ORDER BY j.created_at DESC,j.id DESC LIMIT 1) AS "jobErrorCode"
		FROM songs s
		""";
	String VISIBLE = """
		s.deleted_at IS NULL AND
		((s.source = 'BUILTIN' AND s.owner_id IS NULL AND s.status = 'READY' AND s.published) OR s.owner_id = :userId)
		""";
	String FILTER = """
		s.deleted_at IS NULL AND
		((:scope = 'BUILTIN' AND s.owner_id IS NULL AND s.source = 'BUILTIN' AND s.status = 'READY' AND s.published)
		 OR (:scope = 'MINE' AND s.owner_id = :userId))
		AND (LOWER(s.title) LIKE LOWER(:pattern) ESCAPE '!'
		 OR LOWER(COALESCE(s.artist, '')) LIKE LOWER(:pattern) ESCAPE '!')
		AND (CAST(:level AS text) IS NULL OR s.song_level = :level)
		AND (:playableOnly = false OR (s.status = 'READY' AND s.song_level IS NOT NULL))
		""";

	@Query(value = COLUMNS + " WHERE " + FILTER + " ORDER BY s.created_at DESC, s.id DESC LIMIT :size OFFSET :offset", nativeQuery = true)
	List<View> page(@Param("userId") long userId, @Param("scope") String scope,
			@Param("pattern") String pattern, @Param("level") String level, @Param("playableOnly") boolean playableOnly, @Param("size") int size, @Param("offset") long offset);
	@Query(value = "SELECT count(*) FROM songs s WHERE " + FILTER, nativeQuery = true)
	long count(@Param("userId") long userId, @Param("scope") String scope, @Param("pattern") String pattern, @Param("level") String level, @Param("playableOnly") boolean playableOnly);
	@Query(value = COLUMNS + " WHERE s.id = :id AND " + VISIBLE, nativeQuery = true)
	Optional<View> visible(@Param("id") long id, @Param("userId") long userId);
	@Query(value = "SELECT s.source, s.status, s.accompaniment_key AS \"accompanimentKey\" FROM songs s WHERE s.id = :id AND " + VISIBLE, nativeQuery = true)
	Optional<AccompanimentView> visibleAccompaniment(@Param("id") long id, @Param("userId") long userId);
	@Query(value = "SELECT EXISTS(SELECT 1 FROM users WHERE id = :id AND status = 'ACTIVE')", nativeQuery = true)
	boolean isActive(@Param("id") long id);
	interface AccompanimentView { String getSource(); String getStatus(); String getAccompanimentKey(); }

	interface View {
		Long getId(); String getTitle(); String getArtist(); String getSource(); String getStatus();
		BigDecimal getBpm(); String getTimeSignature(); Integer getDurationMs();
		boolean getHasAccompaniment(); String getAccompanimentStatus(); Instant getCreatedAt(); String getLicense(); Instant getUpdatedAt(); String getCoverKey(); Long getOwnerId();
		String getSongLevel(); String getJobStatus(); String getJobErrorCode();
	}
}

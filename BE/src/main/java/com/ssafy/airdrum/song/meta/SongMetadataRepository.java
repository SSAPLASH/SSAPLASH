package com.ssafy.airdrum.song.meta;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** {@code song_metadata}(V38) 저장·조회(255번 설계 3-6절). 트랜잭션은 부르는 쪽이 정한다. */
@Repository
public class SongMetadataRepository {

	private static final String COLUMNS = "song_id,genre,sub_genres,mood,energy,release_year,language,drum_style,source,source_note";

	private final JdbcTemplate db;

	public SongMetadataRepository(JdbcTemplate db) {
		this.db = db;
	}

	/** 곡의 메타데이터를 넣거나 모든 열을 덮어쓴다. */
	public void upsert(long songId, SongMetadata meta) {
		db.update("""
				INSERT INTO song_metadata(song_id,genre,sub_genres,mood,energy,release_year,language,drum_style,source,source_note,updated_at)
				VALUES (?,?,CAST(? AS text[]),CAST(? AS text[]),?,?,?,CAST(? AS text[]),?,?,clock_timestamp())
				ON CONFLICT (song_id) DO UPDATE SET genre=EXCLUDED.genre,sub_genres=EXCLUDED.sub_genres,mood=EXCLUDED.mood,
				  energy=EXCLUDED.energy,release_year=EXCLUDED.release_year,language=EXCLUDED.language,drum_style=EXCLUDED.drum_style,
				  source=EXCLUDED.source,source_note=EXCLUDED.source_note,updated_at=EXCLUDED.updated_at
				""", songId, meta.genre(), array(meta.subGenres()), array(meta.mood()), meta.energy(), meta.releaseYear(), meta.language(),
				array(meta.drumStyle()), meta.source(), meta.sourceNote());
	}

	/** 곡의 메타데이터를 지운다. 없으면 아무것도 하지 않는다. */
	public void delete(long songId) {
		db.update("DELETE FROM song_metadata WHERE song_id=?", songId);
	}

	/** 곡 id → 메타데이터. 메타데이터가 없는 곡은 맵에 없다. */
	public Map<Long, SongMetadata> findBySongIds(Collection<Long> songIds) {
		var result = new HashMap<Long, SongMetadata>();
		if (songIds.isEmpty()) return result;
		db.query("SELECT " + COLUMNS + " FROM song_metadata WHERE song_id = ANY(CAST(? AS bigint[]))",
				rs -> { result.put(rs.getLong(1), read(rs)); },
				"{" + String.join(",", songIds.stream().map(String::valueOf).toList()) + "}");
		return result;
	}

	private static SongMetadata read(ResultSet rs) throws SQLException {
		return new SongMetadata(rs.getString(2), strings(rs.getArray(3)), strings(rs.getArray(4)), rs.getObject(5, Integer.class),
				rs.getObject(6, Integer.class), rs.getString(7), strings(rs.getArray(8)), rs.getString(9), rs.getString(10));
	}

	private static List<String> strings(Array array) throws SQLException {
		return array == null ? List.of() : List.of((String[]) array.getArray());
	}

	/** PostgreSQL 배열 리터럴. 값은 SongMetadata가 검증한 대문자·밑줄 상수라 따옴표 처리가 필요 없다. */
	private static String array(List<String> values) {
		return "{" + String.join(",", values) + "}";
	}
}

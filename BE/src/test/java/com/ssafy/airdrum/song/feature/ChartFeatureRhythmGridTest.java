package com.ssafy.airdrum.song.feature;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;

/** R2 리듬 격자의 DB 연결: 열이 비어 있는 행만 채우고, 제외 표시된 채보를 다시 계산하지 않으며, 기본 특징과 버전은 그대로 둔다. */
@SpringBootTest(properties = "spring.datasource.hikari.schema=public")
class ChartFeatureRhythmGridTest {
	@Autowired JdbcTemplate db;
	@Autowired ChartFeatureService features;
	long user;

	@BeforeEach void setup() { user = db.queryForObject("INSERT INTO users(nickname) VALUES('grid-test') RETURNING id", Long.class); }

	@AfterEach void cleanup() {
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.owner_id=?)", user);
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE owner_id=?)", user);
		db.update("DELETE FROM songs WHERE owner_id=?", user);
		db.update("DELETE FROM users WHERE id=?", user);
	}

	private long song(String timing) {
		long song = db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'grid','MIDI','READY',10000) RETURNING id", Long.class, user);
		long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'NORMAL') RETURNING id", Long.class, song);
		var notes = new StringBuilder("[");
		for (int i = 0; i < 8; i++) {
			if (i > 0) notes.append(',');
			notes.append("{\"noteId\":\"n").append(i).append("\",\"timeMs\":").append(i * 500).append(",\"pad\":\"").append(i % 2 == 0 ? "KICK" : "SNARE").append("\"}");
		}
		notes.append(']');
		db.update("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,?::jsonb,?::jsonb,'READY',8,'MANUAL')", chart, notes.toString(), timing);
		return song;
	}
	private String grid(long song) {
		return db.queryForObject("SELECT CAST(f.rhythm_grid AS text) FROM chart_features f JOIN chart_versions v ON v.id=f.chart_version_id JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?", String.class, song);
	}

	@Test void 박자_정보가_있으면_격자를_저장하고_다시_부르면_계산하지_않는다() {
		long song = song("{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\"}");
		assertThat(features.computeForSong(song)).isEqualTo(1);
		assertThat(grid(song)).contains("\"groups\"").contains("\"divisions\"").doesNotContain("excluded");
		assertThat(features.computeForSong(song)).isZero();
		assertThat(db.queryForObject("SELECT f.feature_version FROM chart_features f JOIN chart_versions v ON v.id=f.chart_version_id JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?", String.class, song))
				.isEqualTo(ChartFeatureService.VERSION);
	}

	@Test void 가변_템포는_제외_표시를_저장하고_다시_계산하지_않는다() {
		long song = song("{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\",\"ppq\":480,\"tempoMap\":[{\"tick\":0,\"bpm\":120},{\"tick\":960,\"bpm\":140}]}");
		assertThat(features.computeForSong(song)).isEqualTo(1);
		assertThat(grid(song)).contains("VARIABLE_TEMPO");
		assertThat(features.computeForSong(song)).isZero();
	}

	@Test void 박자_정보가_망가져도_기본_특징은_저장하고_격자만_제외로_표시한다() {
		long song = song("{}");
		assertThat(features.computeForSong(song)).isEqualTo(1);
		assertThat(grid(song)).contains("INVALID_TIMING");
		assertThat(db.queryForObject("SELECT count(*) FROM chart_features f JOIN chart_versions v ON v.id=f.chart_version_id JOIN charts c ON c.id=v.chart_id WHERE c.song_id=? AND f.avg_notes_per_sec>0", Integer.class, song)).isEqualTo(1);
	}

	@Test void R1이_저장한_격자_없는_행은_기본_특징을_유지한_채_격자만_채운다() {
		long song = song("{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\"}");
		features.computeForSong(song);
		db.update("UPDATE chart_features SET rhythm_grid=NULL WHERE chart_version_id IN (SELECT v.id FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?)", song);
		assertThat(features.songsMissingFeatures(1000)).contains(song);
		assertThat(features.computeForSong(song)).isEqualTo(1);
		assertThat(grid(song)).contains("\"groups\"");
		assertThat(features.songsMissingFeatures(1000)).doesNotContain(song);
	}
}

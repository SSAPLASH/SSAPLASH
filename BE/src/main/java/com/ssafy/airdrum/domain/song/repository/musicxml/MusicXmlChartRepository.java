package com.ssafy.airdrum.domain.song.repository.musicxml;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.ssafy.airdrum.domain.chart.service.generation.TranscriptionCharts;
import com.ssafy.airdrum.domain.chart.service.generation.TranscriptionCharts.ChartData;
import com.ssafy.airdrum.domain.user.service.profile.UserQueryService;

/** MusicXML 곡·채보 INSERT(293번 설계 3-2절). 트랜잭션 경계는 서비스가 정한다(곡 1 + 채보 3 + 버전 3이 한 트랜잭션). */
@Repository
public class MusicXmlChartRepository {

	private final JdbcTemplate db;
	private final UserQueryService users;

	MusicXmlChartRepository(JdbcTemplate db, UserQueryService users) {
		this.db = db;
		this.users = users;
	}

	/** 탈퇴 트랜잭션과 직렬화하려고 회원 행을 공유 잠금으로 읽는다(MIDI·음원 업로드와 같은 방식). */
	public void requireActive(long userId) {
		db.execute("SET LOCAL lock_timeout='3s'");
		db.execute("SET LOCAL statement_timeout='10s'");
		users.requireActiveForShare(userId);
	}

	/** 곡은 바로 READY다. bpm·offset·박자표는 AI timing, 길이는 AI sheet.duration_ms. */
	public long insertSong(long ownerId, String title, String artist, ChartData data, int durationMs) {
		return db.queryForObject("""
				INSERT INTO songs(owner_id,title,artist,source,status,bpm,offset_ms,time_signature,duration_ms)
				VALUES (?,?,?,'MUSICXML','READY',?,?,?,?) RETURNING id
				""", Long.class, ownerId, title, artist, data.bpm(), data.offset(), data.timeSignature(), durationMs);
	}

	public long insertChart(long songId, String difficulty) {
		return db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES (?,?) RETURNING id", Long.class, songId, difficulty);
	}

	/** HARD는 AI 원본·원문 버전, NORMAL·EASY는 솎은 노트·파생 버전. generator는 MUSICXML_RULE(V46). */
	public long insertVersion(long chartId, String difficulty, ChartData data) {
		String notes = switch (difficulty) {
			case "HARD" -> data.notes();
			case "NORMAL" -> data.normalNotes();
			default -> data.easyNotes();
		};
		int count = switch (difficulty) {
			case "HARD" -> data.noteCount();
			case "NORMAL" -> data.normalCount();
			default -> data.easyCount();
		};
		String version = difficulty.equals("HARD") ? data.generatorVersion() : TranscriptionCharts.derivedVersion(data.generatorVersion());
		return db.queryForObject("""
				INSERT INTO chart_versions(chart_id,version,schema_version,notes,timing,notation_status,note_count,generator,generator_version)
				VALUES (?,1,1,?::jsonb,?::jsonb,?,?,'MUSICXML_RULE',?) RETURNING id
				""", Long.class, chartId, notes, data.timing(), data.notationStatus(), count, version);
	}

}

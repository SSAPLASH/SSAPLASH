package com.ssafy.airdrum.song.midi;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;
import com.ssafy.airdrum.song.midi.MidiChartDocuments.Built;
import com.ssafy.airdrum.song.midi.MidiChartDocuments.Song;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserStatus;

/** MIDI 곡·채보 INSERT. 트랜잭션 경계는 서비스가 정한다(곡 1 + 채보 3 + 버전 3이 한 트랜잭션). */
@Repository
public class MidiChartRepository {

	private final JdbcTemplate db;
	private final UserRepository users;

	MidiChartRepository(JdbcTemplate db, UserRepository users) {
		this.db = db;
		this.users = users;
	}

	/** 탈퇴 트랜잭션과 직렬화하려고 회원 행을 공유 잠금으로 읽는다(음원 업로드와 같은 방식). */
	void requireActive(long userId) {
		db.execute("SET LOCAL lock_timeout='3s'");
		db.execute("SET LOCAL statement_timeout='10s'");
		var user = users.findByIdForShare(userId);
		if (user.isEmpty() || user.get().getStatus() != UserStatus.ACTIVE) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
	}

	long insertSong(long ownerId, String title, String artist, Song song) {
		return db.queryForObject("""
				INSERT INTO songs(owner_id,title,artist,source,status,bpm,offset_ms,time_signature,duration_ms)
				VALUES (?,?,?,'MIDI','READY',?,0,?,?) RETURNING id
				""", Long.class, ownerId, title, artist, song.bpm(), song.timeSignature(), song.durationMs());
	}

	public long insertChart(long songId, Difficulty difficulty) {
		return db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES (?,?) RETURNING id", Long.class, songId,
				difficulty.name());
	}

	/** 공용 곡 채보 재생성(156번)은 다음 버전 번호를 넘긴다. notation_status는 151번과 같이 PENDING. */
	public long insertVersion(long chartId, int version, Built built) {
		return db.queryForObject("""
				INSERT INTO chart_versions(chart_id,version,schema_version,notes,timing,notation_status,note_count,generator,generator_version)
				VALUES (?,?,1,?::jsonb,?::jsonb,'PENDING',?,'MIDI_RULE',?) RETURNING id
				""", Long.class, chartId, version, built.notes(), built.timing(), built.noteCount(), DifficultyThinner.RULE_VERSION);
	}

}

package com.ssafy.airdrum.domain.play.repository.hit;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.ssafy.airdrum.domain.play.dto.PlayUploadRequest;

@Repository
public class PlayHitRepository {
	private final JdbcTemplate db;
	public PlayHitRepository(JdbcTemplate db) { this.db = db; }
	public void insert(PlayUploadRequest p) {
		db.batchUpdate("""
			INSERT INTO hits(play_session_id,seq,t_ms,stick_id,pad,baseline_pad,predicted_pad,velocity,
			peak_accel,pitch,yaw,judgement,matched_note_id,delta_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
			""", p.hits(), 500, (s,h) -> {
			s.setObject(1,p.playId()); s.setInt(2,h.seq()); s.setDouble(3,h.tMs()); s.setObject(4,h.stickId());
			s.setString(5,h.pad().name()); s.setString(6,name(h.baselinePad())); s.setString(7,name(h.predictedPad()));
			s.setObject(8,h.velocity()); s.setObject(9,h.peakAccel()); s.setObject(10,h.pitch()); s.setObject(11,h.yaw());
			s.setString(12,name(h.judgement())); s.setString(13,h.matchedNoteId()); s.setObject(14,h.deltaMs());
		});
	}
	private static String name(Enum<?> value) { return value == null ? null : value.name(); }
}

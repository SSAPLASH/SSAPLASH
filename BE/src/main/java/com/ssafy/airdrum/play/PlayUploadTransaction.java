package com.ssafy.airdrum.play;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserStatus;
import com.ssafy.airdrum.report.ReportAggregate;
import com.ssafy.airdrum.report.ReportRepository;

@Service
public class PlayUploadTransaction {
	private final UserRepository users;
	private final PlaySessionRepository sessions;
	private final PlayHitRepository hits;
	private final JdbcTemplate db;
	private final ReportRepository reports;
	public PlayUploadTransaction(UserRepository users, PlaySessionRepository sessions, PlayHitRepository hits, JdbcTemplate db, ReportRepository reports) {
		this.users = users; this.sessions = sessions; this.hits = hits; this.db = db;
		this.reports = reports;
	}
	@Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
	public PlayUploadResponse save(long user, PlayUploadRequest p, String hash, PlaySessionRepository.ChartData chart, ReportAggregate report) {
		db.execute("SET LOCAL lock_timeout = '3s'"); db.execute("SET LOCAL statement_timeout = '10s'");
		active(user);
		var existing = sessions.find(p.playId(), true);
		if (existing.isPresent()) return replay(user, hash, existing.get());
		if (p.scored() && (chart == null || report == null)) throw new BusinessException(PlayErrorCode.PLAY_STATE_CHANGED);
		sessions.checkReferences(user, p, chart);
		if (!sessions.insert(user, p, hash)) {
			var winner = sessions.find(p.playId(), true).orElseThrow(() -> new BusinessException(PlayErrorCode.PLAY_STATE_CHANGED));
			return replay(user, hash, winner);
		}
		hits.insert(p);
		if (p.scored()) reports.insert(p.playId(), report);
		return new PlayUploadResponse(p.playId(), "PENDING", true);
	}
	public void active(long user) {
		var u = users.findByIdForShare(user);
		if (u.isEmpty() || u.get().getStatus() != UserStatus.ACTIVE) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
	}
	private PlayUploadResponse replay(long user, String hash, PlaySessionRepository.Session s) {
		if (s.userId() != user) throw new BusinessException(PlayErrorCode.PLAY_NOT_FOUND);
		if (!s.hash().equals(hash)) throw new BusinessException(PlayErrorCode.PLAY_PAYLOAD_CONFLICT);
		return new PlayUploadResponse(s.id(), s.rawStatus(), false);
	}
}

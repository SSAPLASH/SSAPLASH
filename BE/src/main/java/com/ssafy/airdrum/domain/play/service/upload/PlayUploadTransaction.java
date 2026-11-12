package com.ssafy.airdrum.domain.play.service.upload;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.domain.play.dto.PlayUploadRequest;
import com.ssafy.airdrum.domain.play.dto.PlayUploadResponse;
import com.ssafy.airdrum.domain.play.exception.PlayErrorCode;
import com.ssafy.airdrum.domain.play.model.PlayJson;
import com.ssafy.airdrum.domain.play.repository.hit.PlayHitRepository;
import com.ssafy.airdrum.domain.play.repository.session.PlaySessionRepository;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.user.service.profile.UserQueryService;
import com.ssafy.airdrum.domain.report.model.ReportAggregate;
import com.ssafy.airdrum.domain.report.service.summary.ReportSummaryService;

@Service
public class PlayUploadTransaction {
	private final UserQueryService users;
	private final PlaySessionRepository sessions;
	private final PlayHitRepository hits;
	private final JdbcTemplate db;
	private final ReportSummaryService reports;
	private final PlayJson json;
	public PlayUploadTransaction(UserQueryService users, PlaySessionRepository sessions, PlayHitRepository hits, JdbcTemplate db, ReportSummaryService reports, PlayJson json) {
		this.users = users; this.sessions = sessions; this.hits = hits; this.db = db;
		this.reports = reports; this.json = json;
	}
	@Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
	public PlayUploadResponse save(long user, PlayUploadRequest p, String hash, PlaySessionRepository.ChartData chart, ReportAggregate report) {
		db.execute("SET LOCAL lock_timeout = '3s'"); db.execute("SET LOCAL statement_timeout = '10s'");
		users.requireActiveForShare(user);
		var existing = sessions.find(p.playId(), true);
		if (existing.isPresent()) return replay(user, p, hash, existing.get());
		if (p.scored() && (chart == null || report == null)) throw new BusinessException(PlayErrorCode.PLAY_STATE_CHANGED);
		sessions.checkReferences(user, p, chart);
		if (!sessions.insert(user, p, hash)) {
			var winner = sessions.find(p.playId(), true).orElseThrow(() -> new BusinessException(PlayErrorCode.PLAY_STATE_CHANGED));
			return replay(user, p, hash, winner);
		}
		hits.insert(p);
		if (p.scored()) {
			reports.save(p.playId(), report);
		}
		return new PlayUploadResponse(p.playId(), "PENDING", true);
	}
	private PlayUploadResponse replay(long user, PlayUploadRequest p, String hash, PlaySessionRepository.Session s) {
		if (s.userId() != user) throw new BusinessException(PlayErrorCode.PLAY_NOT_FOUND);
		if (!s.hash().equals(hash) && !s.hash().equals(json.legacyHash(user, p))) throw new BusinessException(PlayErrorCode.PLAY_PAYLOAD_CONFLICT);
		return new PlayUploadResponse(s.id(), s.rawStatus(), false);
	}
}

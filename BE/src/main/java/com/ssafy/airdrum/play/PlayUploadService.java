package com.ssafy.airdrum.play;

import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.stereotype.Service;
import com.ssafy.airdrum.common.error.BusinessException;

@Service
public class PlayUploadService {
	private final PlayUploadValidator validator;
	private final PlayJson json;
	private final PlaySessionRepository sessions;
	private final PlayUploadTransaction transaction;
	public PlayUploadService(PlayUploadValidator validator, PlayJson json, PlaySessionRepository sessions, PlayUploadTransaction transaction) {
		this.validator = validator; this.json = json; this.sessions = sessions; this.transaction = transaction;
	}
	public PlayUploadResponse upload(long user, PlayUploadRequest p) {
		validator.structure(p); String hash = json.hash(user, p);
		for (int attempt = 0; ; attempt++) {
			try {
				PlaySessionRepository.ChartData chart = null;
				if (sessions.find(p.playId(), false).isEmpty()) {
					if (p.scored()) chart = sessions.chart(user, p.songId(), p.chartVersionId());
					validator.notes(p, chart);
				}
				return transaction.save(user, p, hash, chart);
			} catch (BusinessException ex) {
				if (attempt == 0 && ex.getErrorCode() == PlayErrorCode.PLAY_STATE_CHANGED) continue;
				throw ex;
			} catch (QueryTimeoutException | PessimisticLockingFailureException ex) {
				throw new BusinessException(PlayErrorCode.PLAY_UPLOAD_BUSY);
			}
		}
	}
}

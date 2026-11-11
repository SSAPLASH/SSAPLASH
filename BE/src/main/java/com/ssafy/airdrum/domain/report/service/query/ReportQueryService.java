package com.ssafy.airdrum.domain.report.service.query;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.domain.report.dto.ReportNotesResponse;
import com.ssafy.airdrum.domain.report.dto.ReportResponse;
import com.ssafy.airdrum.domain.report.repository.ReportRepository;
import com.ssafy.airdrum.domain.auth.security.AuthenticationService;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class ReportQueryService {
    private final ReportRepository reports;
    private final AuthenticationService authentication;
    public ReportQueryService(ReportRepository reports, AuthenticationService authentication) {
        this.reports = reports; this.authentication = authentication;
    }
    public ReportResponse report(long userId, UUID playId) {
        requireActive(userId);
        reports.requireReport(userId, playId);
        return reports.find(userId, playId);
    }
    public ReportNotesResponse notes(long userId, UUID playId, Integer afterSeq, int limit) {
        return notes(userId, playId, afterSeq, limit, null, null);
    }
    public ReportNotesResponse notes(long userId, UUID playId, Integer afterSeq, int limit, Double fromMs, Double toMs) {
        requireActive(userId);
        if ((fromMs != null && !Double.isFinite(fromMs)) || (toMs != null && !Double.isFinite(toMs))
                || (fromMs != null && toMs != null && fromMs > toMs))
            throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
        if ((afterSeq != null && afterSeq < 0) || limit < 1 || limit > 1000)
            throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
        reports.requireReport(userId, playId);
        var rows = reports.notes(userId, playId, afterSeq == null ? -1 : afterSeq, limit + 1, fromMs, toMs);
        boolean more = rows.size() > limit;
        var items = more ? rows.subList(0, limit) : rows;
        return new ReportNotesResponse(items, more ? items.getLast().seq() : null);
    }
    private void requireActive(long userId) {
        if (authentication.findActive(userId).isEmpty())
            throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
    }
}

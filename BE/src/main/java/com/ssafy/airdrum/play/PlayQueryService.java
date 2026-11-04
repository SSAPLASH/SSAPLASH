package com.ssafy.airdrum.play;

import java.util.LinkedHashSet;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.auth.AuthenticationService;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.common.response.PageResponse;

@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class PlayQueryService {
    private final PlaySessionRepository sessions;
    private final AuthenticationService authentication;
    public PlayQueryService(PlaySessionRepository sessions, AuthenticationService authentication) {
        this.sessions = sessions;
        this.authentication = authentication;
    }
    public PageResponse<PlaySummaryResponse> list(long userId, int page, int size) {
        if (authentication.findActive(userId).isEmpty()) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
        if (page < 0 || page > 100000 || size < 1 || size > 100) throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
        long count = sessions.countForUser(userId);
        return PageResponse.of(sessions.pageForUser(userId, size, (long) page * size), page, size, count);
    }
    public BestRecordsResponse bestRecords(long userId, String songIds) {
        if (authentication.findActive(userId).isEmpty()) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
        if (songIds == null) throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
        var parts = songIds.split(",", -1);
        if (parts.length < 1 || parts.length > 100) throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
        var ids = new LinkedHashSet<Long>();
        for (var part : parts) {
            if (!part.matches("[0-9]+")) throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
            try {
                long id = Long.parseLong(part);
                if (id <= 0) throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
                ids.add(id);
            } catch (NumberFormatException ex) {
                throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
            }
        }
        return new BestRecordsResponse(sessions.bestForUser(userId, java.util.List.copyOf(ids)));
    }
}

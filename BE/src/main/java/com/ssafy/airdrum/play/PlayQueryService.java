package com.ssafy.airdrum.play;

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
}

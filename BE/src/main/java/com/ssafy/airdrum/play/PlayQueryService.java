package com.ssafy.airdrum.play;

import java.util.LinkedHashSet;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
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
    public PageResponse<PlaySummaryResponse> list(long userId, int page, int size, String q, String from, String to, String mode, String sort) {
        if (authentication.findActive(userId).isEmpty()) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
        if (page < 0 || page > 100000 || size < 1 || size > 100) throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
        String search = q == null ? "" : q.strip();
        if (search.indexOf(0) >= 0 || search.length() > 100 || (mode != null && !java.util.Set.of("FREE", "RHYTHM", "SHEET", "TEMPO").contains(mode))
                || (sort != null && !java.util.Set.of("NEWEST", "OLDEST").contains(sort))) throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
        LocalDate start = date(from), end = date(to);
        if (start != null && end != null && start.isAfter(end)) throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
        var zone = ZoneId.of("Asia/Seoul");
        String pattern = search.isEmpty() ? null : "%" + search.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
        var filters = new PlayListFilters(pattern, start == null ? null : start.atStartOfDay(zone).toInstant(),
                end == null ? null : end.plusDays(1).atStartOfDay(zone).toInstant(), mode, sort == null ? "NEWEST" : sort);
        long count = sessions.countForUser(userId, filters);
        return PageResponse.of(sessions.pageForUser(userId, size, (long) page * size, filters), page, size, count);
    }
    private LocalDate date(String value) {
        if (value == null) return null;
        try {
            if (!value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw new DateTimeParseException("invalid date", value, 0);
            return LocalDate.parse(value);
        } catch (DateTimeParseException ex) {
            throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
        }
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

package com.ssafy.airdrum.domain.song.dto;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.util.UrlPathHelper;

public final class CoverRequest {
    private CoverRequest() {}
    public static boolean matches(HttpServletRequest request) {
        if(!"PUT".equals(request.getMethod())) return false;
        String path=request.getServletPath();
        if(path==null || path.isEmpty()) path=UrlPathHelper.defaultInstance.getPathWithinApplication(request);
        return path.matches("/api/v1/songs/[^/]+/cover");
    }
}

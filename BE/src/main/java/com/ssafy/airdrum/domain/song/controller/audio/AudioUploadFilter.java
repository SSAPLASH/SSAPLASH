package com.ssafy.airdrum.domain.song.controller.audio;

import com.ssafy.airdrum.domain.song.exception.AudioErrorCode;
import com.ssafy.airdrum.global.error.ErrorResponseWriter;

import jakarta.servlet.*;
import jakarta.servlet.http.*;

import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.concurrent.Semaphore;

@Component
@Order(-90)
public class AudioUploadFilter extends OncePerRequestFilter {
    private final Semaphore slots = new Semaphore(2);
    private final ErrorResponseWriter errors;

    public AudioUploadFilter(ErrorResponseWriter errors) {
        this.errors = errors;
    }

    protected void doFilterInternal(
            HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        if (!req.getMethod().equals("POST")
                || !req.getRequestURI().equals(req.getContextPath() + "/api/v1/songs/audio")) {
            chain.doFilter(req, res);
            return;
        }
        if (req.getContentLengthLong() > 51L * 1024 * 1024) {
            errors.write(res, AudioErrorCode.TOO_LARGE, null, req.getRequestURI());
            return;
        }
        var encoding = req.getHeader("Content-Encoding");
        if (encoding != null && !encoding.equalsIgnoreCase("identity")) {
            errors.write(res, AudioErrorCode.INVALID, null, req.getRequestURI());
            return;
        }
        if (!slots.tryAcquire()) {
            res.setHeader("Retry-After", "5");
            errors.write(res, AudioErrorCode.UNAVAILABLE, null, req.getRequestURI());
            return;
        }
        try {
            chain.doFilter(req, res);
        } finally {
            slots.release();
        }
    }
}

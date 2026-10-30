package com.ssafy.airdrum.song;

import java.io.IOException;
import java.util.concurrent.Semaphore;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import com.ssafy.airdrum.common.error.ErrorResponseWriter;

@Component
@Order(-90)
public class CoverUploadFilter extends OncePerRequestFilter {
    private final Semaphore slots=new Semaphore(2); private final ErrorResponseWriter errors;
    public CoverUploadFilter(ErrorResponseWriter errors) { this.errors=errors; }
    @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain) throws ServletException,IOException {
        String path=req.getRequestURI();
        if(!CoverRequest.matches(req)) { chain.doFilter(req,res); return; }
        if(req.getContentLengthLong()>CoverImage.MAX_BYTES+65536L) { errors.write(res,SongManagementError.COVER_TOO_LARGE,null,path); return; }
        if(req.getHeader("Content-Encoding")!=null && !"identity".equalsIgnoreCase(req.getHeader("Content-Encoding"))) { errors.write(res,SongManagementError.COVER_INVALID,null,path); return; }
        if(!slots.tryAcquire()) { res.setHeader("Retry-After","5"); errors.write(res,SongManagementError.COVER_UNAVAILABLE,null,path); return; }
        try { chain.doFilter(req,res); } finally { slots.release(); }
    }
}

package com.ssafy.airdrum.play.web;

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
import com.ssafy.airdrum.play.PlayErrorCode;
import com.ssafy.airdrum.play.PlayJson;
import com.ssafy.airdrum.play.raw.PlayRawProperties;

/** Security(-100) 이후, DispatcherServlet의 multipart 파싱 전에 슬롯을 잡는다. */
@Component
@Order(-90)
public class PlayUploadFilter extends OncePerRequestFilter {
	private final Semaphore slots;
	private final ErrorResponseWriter errors;
	public PlayUploadFilter(PlayRawProperties properties,ErrorResponseWriter errors) {
		if(properties.concurrentUploads()<1 || properties.concurrentUploads()>32) throw new IllegalStateException("원본 동시 업로드는 1~32개입니다.");
		slots=new Semaphore(properties.concurrentUploads()); this.errors=errors;
	}
	@Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
		String path=request.getServletPath(); if(path.isEmpty()) path=request.getRequestURI();
		boolean summary=path.equals("/api/v1/plays"), raw=path.matches("/api/v1/plays/[^/]+/raw");
		if(!request.getMethod().equals("POST") || !(summary||raw)) { chain.doFilter(request,response); return; }
		if(request.getContentLengthLong()>(summary?PlayJson.SUMMARY_BYTES:21L*1024*1024)) {
			errors.write(response,PlayErrorCode.PLAY_UPLOAD_TOO_LARGE,null,path); return;
		}
		if(request.getHeader("Content-Encoding")!=null && !request.getHeader("Content-Encoding").equalsIgnoreCase("identity")) {
			errors.write(response,PlayErrorCode.PLAY_PAYLOAD_INVALID,"HTTP 본문 압축은 지원하지 않습니다. 원본은 gzip 파일 part로 보내세요.",path); return;
		}
		if(!raw) { chain.doFilter(request,response); return; }
		if(!slots.tryAcquire()) { response.setHeader("Retry-After","5"); errors.write(response,PlayErrorCode.PLAY_UPLOAD_BUSY,null,path); return; }
		try { chain.doFilter(request,response); } finally { slots.release(); }
	}
}

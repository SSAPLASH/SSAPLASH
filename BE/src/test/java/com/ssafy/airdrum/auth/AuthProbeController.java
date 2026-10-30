package com.ssafy.airdrum.auth;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.airdrum.user.AuthUser;

/** 인증·인가 테스트용 엔드포인트. 테스트 소스에만 있다. */
@RestController
@RequestMapping("/api/test-auth")
public class AuthProbeController {

	@GetMapping("/me")
	public AuthUser me(AuthUser me) {
		return me;
	}

	@PreAuthorize("hasRole('ADMIN')")
	@GetMapping("/admin")
	public AuthUser admin(AuthUser me) {
		return me;
	}

}

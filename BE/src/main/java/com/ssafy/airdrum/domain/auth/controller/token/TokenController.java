package com.ssafy.airdrum.domain.auth.controller.token;

import java.time.Clock;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.airdrum.domain.auth.cookie.RefreshTokenCookie;
import com.ssafy.airdrum.domain.auth.dto.token.AccessTokenResponse;
import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.domain.auth.service.token.RefreshTokenService;
import com.ssafy.airdrum.domain.auth.service.token.RefreshTokenService.Rotation.Outcome;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * access 토큰 재발급과 로그아웃(설계 문서(88) 3-3·4-B·4-D). 둘 다 refresh 쿠키로 동작하고 Bearer 토큰은 보지 않는다.
 */
@Tag(name = "Auth", description = "소셜 로그인. 브라우저가 직접 이동하는 주소이며 fetch로 호출하지 않는다")
@RestController
@RequestMapping("/api/auth")
public class TokenController {

	private static final Logger log = LoggerFactory.getLogger(TokenController.class);

	static final String RELOGIN_DETAIL = "다시 로그인해 주세요.";

	private final RefreshTokenService refreshTokens;
	private final RefreshTokenCookie cookie;
	private final AccessTokenService accessTokens;
	private final Clock clock;

	public TokenController(RefreshTokenService refreshTokens, RefreshTokenCookie cookie, AccessTokenService accessTokens,
			Clock clock) {
		this.refreshTokens = refreshTokens;
		this.cookie = cookie;
		this.accessTokens = accessTokens;
		this.clock = clock;
	}

	@Operation(summary = "access 토큰 재발급", description = "refresh_token 쿠키로 access 토큰을 받고 쿠키를 새 값으로 바꾼다. "
			+ "쓴 refresh 토큰은 즉시 무효다. 동시에 여러 번 부르면 하나만 성공하므로 FE는 한 번에 하나만 호출한다.")
	@ApiResponse(responseCode = "200", description = "재발급 성공. Set-Cookie로 새 refresh_token")
	@ApiResponse(responseCode = "401", description = "쿠키 없음·무효·만료·탈퇴 회원 (UNAUTHORIZED). 다시 로그인한다",
			content = @Content(mediaType = "application/problem+json"))
	@PostMapping("/refresh")
	public AccessTokenResponse refresh(HttpServletRequest request, HttpServletResponse response) {
		var presented = cookie.read(request);
		var rotation = refreshTokens.rotate(presented.orElse(null));
		if (rotation.outcome() != Outcome.ROTATED) {
			// 설계 U4: 저장소에 없는 토큰은 쿠키를 건드리지 않는다. 동시 재발급에서 이긴 요청의 새 쿠키를 지우지 않기 위해서다.
			if (rotation.outcome() != Outcome.UNKNOWN) {
				cookie.clear(response);
			}
			log.info("토큰 재발급 거부 reason={}", presented.isEmpty() ? "no_cookie" : rotation.outcome());
			throw new BusinessException(CommonErrorCode.UNAUTHORIZED, RELOGIN_DETAIL);
		}
		cookie.issue(response, rotation.newToken());
		var issued = accessTokens.issue(rotation.user(), clock.instant());
		log.info("토큰 재발급 userId={}", rotation.user().id());
		return new AccessTokenResponse(issued.token(), AccessTokenResponse.BEARER, accessTokens.ttl().toSeconds());
	}

	@Operation(summary = "로그아웃", description = "서버의 refresh 토큰을 지우고 쿠키를 만료시킨다. 쿠키가 없어도 204이며 여러 번 "
			+ "불러도 결과가 같다. 이미 받은 access 토큰은 만료(최대 30분)까지 유효하므로 FE는 메모리에서 버린다.")
	@ApiResponse(responseCode = "204", description = "로그아웃 완료")
	@PostMapping("/logout")
	public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
		cookie.read(request).ifPresent(refreshTokens::revoke);
		cookie.clear(response);
		return ResponseEntity.noContent().build();
	}

}

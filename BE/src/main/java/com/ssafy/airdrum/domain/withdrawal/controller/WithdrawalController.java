package com.ssafy.airdrum.domain.withdrawal.controller;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.airdrum.domain.withdrawal.service.WithdrawalService;
import com.ssafy.airdrum.domain.auth.cookie.RefreshTokenCookie;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.exception.UserNotActiveException;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

/** 회원 탈퇴 API(탈퇴 설계 3-1). 경로는 회원 API({@code /api/users})와 같은 자원이라 Swagger 태그도 같게 둔다. */
@Tag(name = "Users", description = "회원 정보")
@RestController
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
public class WithdrawalController {

	static final String INACTIVE_DETAIL = "사용할 수 없는 계정입니다.";

	private final WithdrawalService withdrawals;
	private final RefreshTokenCookie refreshCookie;

	public WithdrawalController(WithdrawalService withdrawals, RefreshTokenCookie refreshCookie) {
		this.withdrawals = withdrawals;
		this.refreshCookie = refreshCookie;
	}

	@Operation(summary = "회원 탈퇴", description = "로그인한 회원 본인을 탈퇴시키고 refresh 쿠키를 지운다. 되돌릴 수 없다. "
			+ "같은 소셜 계정으로 다시 로그인하면 새 회원이 된다.")
	@ApiResponse(responseCode = "204", description = "탈퇴 완료")
	@ApiResponse(responseCode = "401", description = "토큰 없음·만료·무효·이미 탈퇴 (UNAUTHORIZED)",
			content = @Content(mediaType = "application/problem+json"))
	@DeleteMapping("/api/users/me")
	public ResponseEntity<Void> withdrawMe(AuthUser me, HttpServletResponse response) {
		try {
			withdrawals.withdraw(me.id());
		}
		catch (UserNotActiveException ex) {
			throw new BusinessException(CommonErrorCode.UNAUTHORIZED, INACTIVE_DETAIL);
		}
		// 커밋 뒤(AFTER_COMMIT) 리스너 예외는 Spring이 로그만 남기고 여기까지 올라오지 않는다(위험 3)
		refreshCookie.clear(response);
		return ResponseEntity.noContent().build();
	}

}

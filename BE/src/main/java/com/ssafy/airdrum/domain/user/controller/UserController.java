package com.ssafy.airdrum.domain.user.controller;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.airdrum.domain.user.dto.SignupConsentRequest;
import com.ssafy.airdrum.domain.user.dto.UserMeResponse;
import com.ssafy.airdrum.domain.user.exception.UserNotActiveException;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.service.consent.SignupConsentService;
import com.ssafy.airdrum.domain.user.service.profile.UserQueryService;
import com.ssafy.airdrum.global.error.ApiErrorResponse;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.global.config.OpenApiConfig;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

/** 회원 API(설계 문서(88) 3-3). */
@Tag(name = "Users", description = "회원 정보")
@RestController
@RequestMapping("/api/users")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
public class UserController {

	static final String INACTIVE_DETAIL = "사용할 수 없는 계정입니다.";

	private final UserQueryService users;
	private final SignupConsentService signupConsents;

	public UserController(UserQueryService users, SignupConsentService signupConsents) {
		this.users = users;
		this.signupConsents = signupConsents;
	}

	@Operation(summary = "내 정보", description = "로그인한 회원의 프로필·권한·가입 완료 여부·동의 상태. 이메일·상태는 내보내지 않는다. "
			+ "가입 동의 전에도 부를 수 있다.")
	@ApiResponse(responseCode = "401", description = "토큰 없음·만료·무효·탈퇴 회원 (UNAUTHORIZED)",
			content = @Content(mediaType = "application/problem+json"))
	@GetMapping("/me")
	public UserMeResponse me(AuthUser me) {
		return users.me(me.id());
	}

	@Operation(summary = "가입 동의 저장", description = "이용약관·개인정보 수집·이용·연주 기록 활용 동의를 저장하고 /me 본문을 돌려준다. "
			+ "가입 동의 전에도 부를 수 있다. 연주 기록 활용은 필수라 agreed=true만 받는다(철회는 탈퇴). "
			+ "가입을 마친 회원이 다시 보내도 200이며(약관 개정 재동의) 판이 바뀐 항목만 동의 시각이 바뀐다. 서버는 판을 비교·해석하지 않는다.")
	@ApiResponse(responseCode = "200", description = "저장 뒤의 내 정보(signupCompleted: true)")
	@ApiResponse(responseCode = "400", description = "판 누락·빈 값·공백만·51자 이상, dataConsent 누락, agreed false·null·누락 "
			+ "(VALIDATION_FAILED), 본문 없음·JSON 형식 오류 (INVALID_INPUT)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "401", description = "토큰 없음·만료·무효·탈퇴 회원 (UNAUTHORIZED)",
			content = @Content(mediaType = "application/problem+json"))
	@ApiResponse(responseCode = "422", description = "서버에 설정된 허용 판에 없는 약관·개인정보·데이터 활용 안내의 판 (SIGNUP_CONSENT_VERSION_INVALID)",
			content = @Content(mediaType = "application/problem+json"))
	@PostMapping("/me/signup-consent")
	public UserMeResponse saveSignupConsent(AuthUser me, @Valid @RequestBody SignupConsentRequest request) {
		try {
			return signupConsents.save(me.id(), request);
		}
		catch (UserNotActiveException ex) {
			// 인증 뒤 저장 사이에 탈퇴가 끼어든 경우. 탈퇴 API와 같은 문구로 401을 돌려준다
			throw new BusinessException(CommonErrorCode.UNAUTHORIZED, INACTIVE_DETAIL);
		}
	}

}

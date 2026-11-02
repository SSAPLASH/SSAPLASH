package com.ssafy.airdrum.user;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.config.OpenApiConfig;

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
	private final DataConsentService dataConsents;

	public UserController(UserQueryService users, DataConsentService dataConsents) {
		this.users = users;
		this.dataConsents = dataConsents;
	}

	@Operation(summary = "내 정보", description = "로그인한 회원의 프로필·권한·데이터 활용 동의 상태. 이메일·상태는 내보내지 않는다.")
	@ApiResponse(responseCode = "401", description = "토큰 없음·만료·무효·탈퇴 회원 (UNAUTHORIZED)",
			content = @Content(mediaType = "application/problem+json"))
	@GetMapping("/me")
	public UserMeResponse me(AuthUser me) {
		return users.me(me.id());
	}

	@Operation(summary = "데이터 활용 동의 저장", description = "로그인한 회원의 연주 기록 활용 동의(선택)를 저장한다. "
			+ "같은 값을 다시 보내도 200이며 updatedAt은 바뀌지 않는다. 플레이 업로드의 consent 값은 이 API가 바꾸지 않는다.")
	@ApiResponse(responseCode = "200", description = "저장된 동의 상태")
	@ApiResponse(responseCode = "400", description = "agreed 누락·null (VALIDATION_FAILED), 본문 없음·JSON 형식 오류 (INVALID_INPUT)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "401", description = "토큰 없음·만료·무효·탈퇴 회원 (UNAUTHORIZED)",
			content = @Content(mediaType = "application/problem+json"))
	@PutMapping("/me/data-consent")
	public DataConsentResponse saveDataConsent(AuthUser me, @Valid @RequestBody DataConsentRequest request) {
		try {
			return dataConsents.save(me.id(), request.agreed());
		}
		catch (UserNotActiveException ex) {
			// 인증 뒤 저장 사이에 탈퇴가 끼어든 경우. 탈퇴 API와 같은 문구로 401을 돌려준다
			throw new BusinessException(CommonErrorCode.UNAUTHORIZED, INACTIVE_DETAIL);
		}
	}

}

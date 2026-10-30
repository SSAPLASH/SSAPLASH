package com.ssafy.airdrum.user;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.airdrum.config.OpenApiConfig;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

/** 회원 API(설계 문서(88) 3-3). */
@Tag(name = "Users", description = "회원 정보")
@RestController
@RequestMapping("/api/users")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
public class UserController {

	private final UserQueryService users;

	public UserController(UserQueryService users) {
		this.users = users;
	}

	@Operation(summary = "내 정보", description = "로그인한 회원의 프로필과 권한. 이메일·상태는 내보내지 않는다.")
	@ApiResponse(responseCode = "401", description = "토큰 없음·만료·무효·탈퇴 회원 (UNAUTHORIZED)",
			content = @Content(mediaType = "application/problem+json"))
	@GetMapping("/me")
	public UserMeResponse me(AuthUser me) {
		return users.me(me.id());
	}

}

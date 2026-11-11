package com.ssafy.airdrum.domain.user.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.airdrum.domain.user.dto.RecommendationConsentInput;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.service.consent.RecommendationConsentService;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.user.service.consent.RecommendationConsentService.Consent;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/users/me/recommendation-consent")
@Tag(name = "Users")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
public class RecommendationConsentController {

	private final RecommendationConsentService consents;

	public RecommendationConsentController(RecommendationConsentService consents) {
		this.consents = consents;
	}

	@Operation(summary = "추천 학습 동의 조회", description = "한 번도 응답하지 않았으면 agreed=false이고 version·updatedAt은 null이다.")
	@GetMapping
	public Consent get(@Parameter(hidden = true) AuthUser me) {
		return consents.get(me.id());
	}

	@Operation(summary = "추천 학습 동의 변경", description = "설정에서 켜고 끌 때 쓴다. 끄면 그 사용자의 추천 후보를 바로 지우고 이후 학습에서 뺀다. "
			+ "동의하지 않아도 모든 기능을 쓸 수 있다.")
	@ApiResponse(responseCode = "422", description = "서버에 설정된 허용 판에 없는 판 (SIGNUP_CONSENT_VERSION_INVALID)")
	@PutMapping
	public Consent put(@Parameter(hidden = true) AuthUser me, @Valid @RequestBody RecommendationConsentInput body) {
		return consents.save(me.id(), body);
	}

}

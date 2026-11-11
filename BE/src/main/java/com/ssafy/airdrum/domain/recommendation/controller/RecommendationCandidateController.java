package com.ssafy.airdrum.domain.recommendation.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.ssafy.airdrum.domain.recommendation.service.candidate.RecommendationCandidateService;
import com.ssafy.airdrum.domain.recommendation.service.candidate.RecommendationCandidateService.Status;
import com.ssafy.airdrum.domain.recommendation.service.candidate.RecommendationCandidateService.Upload;
import com.ssafy.airdrum.domain.recommendation.service.candidate.RecommendationCandidateService.UploadResult;

/** AI 배치의 후보 적재 API. 인증은 채보 워커와 같은 토큰 필터(`/internal/**`)가 한다. 응답에는 개수만 담는다. */
@RestController
@RequestMapping("/internal/v1/recommend-candidates")
class RecommendationCandidateController {
	private final RecommendationCandidateService service;
	RecommendationCandidateController(RecommendationCandidateService service) { this.service = service; }

	@PostMapping
	UploadResult upload(@RequestBody Upload body) { return service.upload(body); }

	@GetMapping("/status")
	Status status() { return service.status(); }
}

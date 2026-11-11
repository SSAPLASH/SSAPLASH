package com.ssafy.airdrum.domain.user.service.consent;

/** 동의 철회 시 추천 후보와 가명 키를 같은 트랜잭션에서 정리한다. */
public interface RecommendationDataCleanup {
	void deleteUserData(long userId);
}

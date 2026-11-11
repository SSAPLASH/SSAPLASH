package com.ssafy.airdrum.domain.chart.service.query;

import org.springframework.stereotype.Component;
import com.ssafy.airdrum.domain.chart.exception.ChartErrorCode;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.domain.user.service.profile.UserQueryService;

/** 외부 파일 작업 뒤에도 DB에서 회원 상태를 새로 확인한다. */
@Component
public class ChartQueryAccess {
	private final UserQueryService users;
	public ChartQueryAccess(UserQueryService users) { this.users = users; }
	public void requireActive(long userId) {
		if (!users.isActive(userId)) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
	}
	public static void requireReady(String status) {
		if (!"READY".equals(status)) throw new BusinessException(ChartErrorCode.SONG_NOT_READY);
	}
}

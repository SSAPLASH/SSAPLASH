package com.ssafy.airdrum.chart;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import com.ssafy.airdrum.chart.web.ChartQueryWebConfiguration;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 인증 대역조차 없는 기본 기동 상태. 클라이언트가 보낸 ID·토큰은 인증 경로가 아니다. */
@SpringBootTest
@AutoConfigureMockMvc
class ChartQueryAuthenticationTest {
	@Autowired MockMvc mvc;
	@Test void allRoutesDenyWithoutTrustedAuthenticationAdapter() throws Exception {
		for (String path : List.of("/api/v1/songs", "/api/v1/songs/1", "/api/v1/charts/1",
				"/api/v1/chart-versions/1", "/api/v1/chart-versions/1/assets")) {
			mvc.perform(get(path).header("X-User-Id", "1").header("Authorization", "Bearer fake-test-token")
					.param("userId", "1").requestAttr(ChartQueryWebConfiguration.USER_ID, 1L))
					.andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
					.andExpect(header().string("Cache-Control", "private, no-store"));
		}
	}
}

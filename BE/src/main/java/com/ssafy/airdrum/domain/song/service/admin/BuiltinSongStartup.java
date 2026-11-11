package com.ssafy.airdrum.domain.song.service.admin;

import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 앱이 준비되면 저장소의 공용 곡 카탈로그를 등록한다(254번). 배포만 하면 로컬·dev·운영에 같은 공용 곡이 들어간다.
 * 어떤 실패도 앱 시작을 막지 않는다. {@code builtin-songs.seed.enabled=false}면 만들지 않는다(테스트 기본값).
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name = "builtin-songs.seed.enabled", havingValue = "true", matchIfMissing = true)
class BuiltinSongStartup {

	private static final Logger log = LoggerFactory.getLogger(BuiltinSongStartup.class);

	private final BuiltinSongSeeder seeder;
	private final String location;

	BuiltinSongStartup(BuiltinSongSeeder seeder, @Value("${builtin-songs.location:classpath:builtin-songs/}") String location) {
		this.seeder = seeder;
		this.location = location;
	}

	@EventListener(ApplicationReadyEvent.class)
	void seed() {
		try {
			var result = seeder.seed(BuiltinSongCatalog.load(location));
			Map<BuiltinSongSeeder.Outcome, Long> counts = result.values().stream()
					.collect(Collectors.groupingBy(Function.identity(), Collectors.counting()));
			log.info("공용 곡 카탈로그 결과 {}곡: {}", result.size(), counts);
		} catch (BuiltinSongCatalog.Invalid e) {
			log.warn("공용 곡 카탈로그를 거부해 등록하지 않음: {}", e.getMessage());
		} catch (RuntimeException e) {
			log.warn("공용 곡 카탈로그 등록 중단 errorType={}", e.getClass().getSimpleName(), e);
		}
	}
}

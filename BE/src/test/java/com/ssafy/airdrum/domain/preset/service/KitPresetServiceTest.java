package com.ssafy.airdrum.domain.preset.service;

import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.domain.preset.dto.PresetRequest;
import com.ssafy.airdrum.domain.preset.entity.KitPreset;
import com.ssafy.airdrum.domain.preset.exception.PresetErrorCode;
import com.ssafy.airdrum.domain.preset.repository.KitPresetRepository;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.domain.user.service.profile.UserQueryService;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 설계 문서(90) 4-F·위험 4, 인수 조건 14: 미리 검사를 통과한 뒤 DB 제약 위반이 나면(동시 요청 경합) 트랜잭션 안에서
 * 409 {@code PRESET_CONFLICT}로 바뀌고, 쓰기 중 회원이 ACTIVE가 아니면 401이다. 경합은 리포지토리 대역으로 재현한다.
 */
class KitPresetServiceTest {

	private static final long USER = 7L;

	private final JsonMapper json = new JsonMapper();

	private KitPresetRepository presets;
	private UserQueryService users;
	private KitPresetService service;

	@BeforeEach
	void setUp() {
		presets = mock(KitPresetRepository.class);
		users = mock(UserQueryService.class);
		service = new KitPresetService(presets, users, json);
		when(users.lockAndCheckActive(USER)).thenReturn(true);
	}

	@Test
	void createConstraintRaceBecomesConflict() {
		when(presets.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("uq"));
		assertThatThrownBy(() -> service.create(USER, request("가")))
				.isInstanceOfSatisfying(BusinessException.class,
						e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo(PresetErrorCode.PRESET_CONFLICT));
	}

	@Test
	void updateConstraintRaceBecomesConflict() {
		when(presets.findByIdAndUserId(1L, USER)).thenReturn(Optional.of(preset()));
		doThrow(new DataIntegrityViolationException("uq")).when(presets).flush();
		assertThatThrownBy(() -> service.update(USER, 1L, request("나")))
				.isInstanceOfSatisfying(BusinessException.class,
						e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo(PresetErrorCode.PRESET_CONFLICT));
	}

	@Test
	void concurrentDefaultBecomesConflict() {
		when(presets.findByIdAndUserId(1L, USER)).thenReturn(Optional.of(preset()));
		doThrow(new DataIntegrityViolationException("partial unique")).when(presets).flush();
		assertThatThrownBy(() -> service.makeDefault(USER, 1L))
				.isInstanceOfSatisfying(BusinessException.class,
						e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo(PresetErrorCode.PRESET_CONFLICT));
	}

	@Test
	void writeByInactiveOrMissingUserIsUnauthorized() {
		when(users.lockAndCheckActive(USER)).thenReturn(false);
		assertUnauthorized(() -> service.create(USER, request("가")));

		assertUnauthorized(() -> service.delete(USER, 1L));
		assertUnauthorized(() -> service.makeDefault(USER, 1L));
		assertUnauthorized(() -> service.update(USER, 1L, request("가")));
		verify(presets, never()).saveAndFlush(any());
	}

	private static void assertUnauthorized(org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
		assertThatThrownBy(call).isInstanceOfSatisfying(BusinessException.class,
				e -> {
					org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo(CommonErrorCode.UNAUTHORIZED);
					org.assertj.core.api.Assertions.assertThat(e.getDetail()).isEqualTo(KitPresetService.INACTIVE_DETAIL);
				});
	}

	private PresetRequest request(String name) {
		return new PresetRequest(name, json.readTree("{\"SNARE\":{\"x\":0.4}}"), json.readTree("{\"soundSetId\":\"synth\"}"),
				null);
	}

	private static KitPreset preset() {
		return KitPreset.create(USER, "원래", "{}", "{}", 1);
	}

}

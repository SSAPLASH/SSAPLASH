package com.ssafy.airdrum.preset;

import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.user.User;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserStatus;

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
	private UserRepository users;
	private KitPresetService service;

	@BeforeEach
	void setUp() {
		presets = mock(KitPresetRepository.class);
		users = mock(UserRepository.class);
		service = new KitPresetService(presets, users, json);
		when(users.findByIdForShare(USER)).thenReturn(Optional.of(User.create("회원", null, null)));
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
		when(users.findByIdForShare(USER)).thenReturn(Optional.empty());
		assertUnauthorized(() -> service.create(USER, request("가")));

		var withdrawn = mock(User.class);
		when(withdrawn.getStatus()).thenReturn(UserStatus.WITHDRAWN);
		when(users.findByIdForShare(USER)).thenReturn(Optional.of(withdrawn));
		assertUnauthorized(() -> service.delete(USER, 1L));
		assertUnauthorized(() -> service.makeDefault(USER, 1L));
		assertUnauthorized(() -> service.update(USER, 1L, request("가")));
		verify(presets, never()).saveAndFlush(any());
	}

	private static void assertUnauthorized(org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
		assertThatThrownBy(call).isInstanceOfSatisfying(BusinessException.class,
				e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo(CommonErrorCode.UNAUTHORIZED));
	}

	private PresetRequest request(String name) {
		return new PresetRequest(name, json.readTree("{\"SNARE\":{\"x\":0.4}}"), json.readTree("{\"soundSetId\":\"synth\"}"),
				null);
	}

	private static KitPreset preset() {
		return KitPreset.create(USER, "원래", "{}", "{}", 1);
	}

}

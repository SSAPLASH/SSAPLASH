package com.ssafy.airdrum.preset;

import java.util.List;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserStatus;

/**
 * 키트 프리셋 규칙(설계 문서(90) 4장). 모든 조회·변경은 호출한 회원의 프리셋으로 한정하고, 타인 것은 없는 것과 같다(404).
 *
 * <p>쓰기는 첫 단계에서 회원 행을 {@code FOR SHARE}로 잠가 ACTIVE를 다시 확인한다(탈퇴와의 경합, BE README "회원 상태와 겨루는 저장").
 * 이름 중복·상한·기본 1개는 미리 검사하고, 동시 요청으로 그래도 DB 제약에 걸리면 트랜잭션 안에서 flush해 409로 바꾼다.
 */
@Service
public class KitPresetService {

	/** 회원당 최대 개수(FE 로컬 상한과 같다, U4). */
	public static final int MAX_PRESETS = 10;

	static final String INACTIVE_DETAIL = "사용할 수 없는 계정입니다.";

	private final KitPresetRepository presets;
	private final UserRepository users;
	private final JsonMapper json;

	public KitPresetService(KitPresetRepository presets, UserRepository users, JsonMapper json) {
		this.presets = presets;
		this.users = users;
		this.json = json;
	}

	/** 기본 프리셋 먼저, 그다음 최근 생성 순. 로그인 직후 첫 원소의 {@code isDefault}로 자동 적용 여부를 정한다. */
	@Transactional(readOnly = true)
	public List<PresetResponse> list(long userId) {
		return presets.findAllByUserIdOrderByIsDefaultDescCreatedAtDescIdDesc(userId).stream()
				.map(this::toResponse)
				.toList();
	}

	@Transactional(readOnly = true)
	public PresetResponse get(long userId, long presetId) {
		return toResponse(find(userId, presetId));
	}

	@Transactional
	public PresetResponse create(long userId, PresetRequest request) {
		requireActive(userId);
		if (presets.countByUserId(userId) >= MAX_PRESETS) {
			throw new BusinessException(PresetErrorCode.PRESET_LIMIT_EXCEEDED);
		}
		if (presets.existsByUserIdAndName(userId, request.name())) {
			throw new BusinessException(PresetErrorCode.PRESET_NAME_DUPLICATE);
		}
		var preset = KitPreset.create(userId, request.name(), write(request.layout()), write(request.sounds()),
				request.schemaVersionOrDefault());
		try {
			return toResponse(presets.saveAndFlush(preset));
		}
		catch (DataIntegrityViolationException ex) {
			throw new BusinessException(PresetErrorCode.PRESET_CONFLICT);
		}
	}

	/** 내용 전체를 바꾼다. 기본 여부는 그대로다. */
	@Transactional
	public PresetResponse update(long userId, long presetId, PresetRequest request) {
		requireActive(userId);
		var preset = find(userId, presetId);
		if (presets.existsByUserIdAndNameAndIdNot(userId, request.name(), presetId)) {
			throw new BusinessException(PresetErrorCode.PRESET_NAME_DUPLICATE);
		}
		preset.replace(request.name(), write(request.layout()), write(request.sounds()),
				request.schemaVersionOrDefault());
		flush();
		return toResponse(preset);
	}

	/** 이 프리셋을 기본으로 한다. 이미 기본이면 바꾸지 않는다(멱등). */
	@Transactional
	public PresetResponse makeDefault(long userId, long presetId) {
		requireActive(userId);
		var preset = find(userId, presetId);
		if (preset.isDefault()) {
			return toResponse(preset);
		}
		// 일괄 갱신이 영속성 컨텍스트를 비우므로 대상을 다시 읽는다.
		presets.clearDefault(userId);
		var target = find(userId, presetId);
		target.markDefault();
		flush();
		return toResponse(target);
	}

	/** 지운 것이 기본이었으면 남은 것 중 가장 최근 생성을 기본으로 한다(U7). */
	@Transactional
	public void delete(long userId, long presetId) {
		requireActive(userId);
		var preset = find(userId, presetId);
		boolean wasDefault = preset.isDefault();
		presets.delete(preset);
		flush();
		if (wasDefault) {
			presets.findFirstByUserIdOrderByCreatedAtDescIdDesc(userId).ifPresent(next -> {
				next.markDefault();
				flush();
			});
		}
	}

	private KitPreset find(long userId, long presetId) {
		return presets.findByIdAndUserId(presetId, userId)
				.orElseThrow(() -> new BusinessException(PresetErrorCode.PRESET_NOT_FOUND));
	}

	private void requireActive(long userId) {
		var user = users.findByIdForShare(userId)
				.orElseThrow(() -> new BusinessException(CommonErrorCode.UNAUTHORIZED, INACTIVE_DETAIL));
		if (user.getStatus() != UserStatus.ACTIVE) {
			throw new BusinessException(CommonErrorCode.UNAUTHORIZED, INACTIVE_DETAIL);
		}
	}

	private void flush() {
		try {
			presets.flush();
		}
		catch (DataIntegrityViolationException ex) {
			throw new BusinessException(PresetErrorCode.PRESET_CONFLICT);
		}
	}

	private PresetResponse toResponse(KitPreset p) {
		return new PresetResponse(p.getId(), p.getName(), p.isDefault(), read(p.getLayout()), read(p.getSounds()),
				p.getSchemaVersion(), p.getCreatedAt(), p.getUpdatedAt());
	}

	private String write(JsonNode node) {
		return json.writeValueAsString(node);
	}

	/** 저장된 값은 DB CHECK가 객체임을 보장한다. 읽지 못하면 데이터 불변식 위반이라 500으로 둔다. */
	private JsonNode read(String raw) {
		try {
			return json.readTree(raw);
		}
		catch (JacksonException ex) {
			throw new IllegalStateException("저장된 프리셋 JSON을 읽지 못했습니다.");
		}
	}

}

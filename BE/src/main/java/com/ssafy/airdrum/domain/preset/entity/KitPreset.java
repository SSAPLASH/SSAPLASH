package com.ssafy.airdrum.domain.preset.entity;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 키트 프리셋 ({@code kit_presets}). 스키마는 V3·V13이 정의하고 이 매핑은 그것과 맞아야 한다(Hibernate validate).
 *
 * <p>내용은 패드 배치({@code layout})·사운드({@code sounds}) 두 가지이며 모두 FE 형식의 JSON 객체 문자열이다.
 * 이 클래스는 내용을 해석하지 않는다. 캘리브레이션은 기기·세션 값이라 저장하지 않는다(V13에서 컬럼 삭제).
 * V3의 {@code tuning}은 이 기능에서 쓰지 않아 매핑하지 않는다(항상 NULL).
 */
@Entity
@Table(name = "kit_presets")
public class KitPreset {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(nullable = false, updatable = false)
	private Long userId;

	@Column(nullable = false, length = 50)
	private String name;

	@Column(nullable = false)
	private boolean isDefault;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(nullable = false, columnDefinition = "jsonb")
	private String layout;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(nullable = false, columnDefinition = "jsonb")
	private String sounds;

	@Column(nullable = false)
	private Integer schemaVersion;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	@Column(nullable = false)
	private Instant updatedAt;

	protected KitPreset() {
		// JPA 전용
	}

	private KitPreset(Long userId, String name, String layout, String sounds, int schemaVersion) {
		if (userId == null) {
			throw new IllegalArgumentException("userId가 없습니다.");
		}
		this.userId = userId;
		assign(name, layout, sounds, schemaVersion);
	}

	/**
	 * 새 프리셋을 만든다. 기본 프리셋이 아닌 상태로 시작한다.
	 *
	 * @throws IllegalArgumentException 이름이 비었거나 배치·사운드가 없거나 형식 버전이 1 미만일 때
	 */
	public static KitPreset create(Long userId, String name, String layout, String sounds, int schemaVersion) {
		return new KitPreset(userId, name, layout, sounds, schemaVersion);
	}

	/** 내용 전체를 바꾼다. 소유자·기본 여부는 그대로다. */
	public void replace(String name, String layout, String sounds, int schemaVersion) {
		assign(name, layout, sounds, schemaVersion);
	}

	public void markDefault() {
		this.isDefault = true;
	}

	public void clearDefault() {
		this.isDefault = false;
	}

	private void assign(String name, String layout, String sounds, int schemaVersion) {
		if (name == null || name.isBlank()) {
			throw new IllegalArgumentException("프리셋 이름이 비었습니다.");
		}
		if (layout == null || sounds == null) {
			throw new IllegalArgumentException("배치·사운드는 필수입니다.");
		}
		if (schemaVersion < 1) {
			throw new IllegalArgumentException("형식 버전은 1 이상이어야 합니다.");
		}
		this.name = name;
		this.layout = layout;
		this.sounds = sounds;
		this.schemaVersion = schemaVersion;
	}

	@PrePersist
	void onCreate() {
		var now = now();
		createdAt = now;
		updatedAt = now;
	}

	@PreUpdate
	void onUpdate() {
		updatedAt = now();
	}

	/** PostgreSQL timestamptz 정밀도(마이크로초)에 맞춰 저장 전후 값이 같게 한다. */
	private static Instant now() {
		return Instant.now().truncatedTo(ChronoUnit.MICROS);
	}

	public Long getId() {
		return id;
	}

	public Long getUserId() {
		return userId;
	}

	public String getName() {
		return name;
	}

	public boolean isDefault() {
		return isDefault;
	}

	public String getLayout() {
		return layout;
	}

	public String getSounds() {
		return sounds;
	}

	public Integer getSchemaVersion() {
		return schemaVersion;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}

}

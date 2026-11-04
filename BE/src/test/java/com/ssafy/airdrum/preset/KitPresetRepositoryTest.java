package com.ssafy.airdrum.preset;

import java.util.UUID;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.user.User;
import com.ssafy.airdrum.user.UserRepository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 설계 문서(90) 3-5, 인수 조건 12·13: 엔티티가 V3+V11과 맞고(컨텍스트 기동 시 Hibernate validate),
 * DB 제약(이름 유일·기본 1개·JSON 객체)과 cascade·SET NULL이 동작하며, 리포지토리 조회가 소유자 조건을 지킨다.
 */
@DataJpaTest
class KitPresetRepositoryTest {

	private static final String LAYOUT = "{\"SNARE\":{\"x\":0.42,\"y\":0.68,\"r\":0.095}}";
	private static final String SOUNDS = "{\"soundSetId\":\"ssaplash\"}";

	@Autowired
	private KitPresetRepository presets;

	@Autowired
	private UserRepository users;

	@Autowired
	private EntityManager em;

	@Autowired
	private JdbcTemplate db;

	private final JsonMapper json = new JsonMapper();

	private long owner;
	private long other;

	@BeforeEach
	void seed() {
		owner = users.save(User.create("프리셋 주인", null, null)).getId();
		other = users.save(User.create("다른 회원", null, null)).getId();
	}

	@Test
	void savesAllFieldsWithDefaultsAndTimestamps() {
		var saved = presets.save(KitPreset.create(owner, "연습용", LAYOUT, SOUNDS, 1));
		em.flush();
		em.clear();

		var found = presets.findById(saved.getId()).orElseThrow();
		assertThat(found.getUserId()).isEqualTo(owner);
		assertThat(found.getName()).isEqualTo("연습용");
		assertThat(found.isDefault()).isFalse();
		assertThat(json.readTree(found.getLayout())).isEqualTo(json.readTree(LAYOUT));
		assertThat(json.readTree(found.getSounds())).isEqualTo(json.readTree(SOUNDS));
		assertThat(found.getSchemaVersion()).isEqualTo(1);
		assertThat(found.getCreatedAt()).isNotNull();
		assertThat(found.getUpdatedAt()).isEqualTo(found.getCreatedAt());
	}

	@Test
	void factoryRejectsBlankNameAndInvalidSchemaVersion() {
		assertThatIllegalArgumentException().isThrownBy(() -> KitPreset.create(owner, " ", LAYOUT, SOUNDS, 1));
		assertThatIllegalArgumentException().isThrownBy(() -> KitPreset.create(owner, null, LAYOUT, SOUNDS, 1));
		assertThatIllegalArgumentException().isThrownBy(() -> KitPreset.create(owner, "a", LAYOUT, SOUNDS, 0));
		assertThatIllegalArgumentException().isThrownBy(() -> KitPreset.create(owner, "a", null, SOUNDS, 1));
		assertThatIllegalArgumentException().isThrownBy(() -> KitPreset.create(owner, "a", LAYOUT, null, 1));
	}

	@Test
	void replaceChangesContentButKeepsDefaultAndOwner() {
		var preset = presets.saveAndFlush(KitPreset.create(owner, "원래", LAYOUT, SOUNDS, 1));
		preset.markDefault();
		preset.replace("바꿈", "{\"KICK\":{\"x\":0.5,\"y\":0.9,\"r\":0.06}}", "{\"soundSetId\":\"synth\"}", 2);
		presets.flush();
		em.clear();

		var found = presets.findById(preset.getId()).orElseThrow();
		assertThat(found.getName()).isEqualTo("바꿈");
		assertThat(found.isDefault()).isTrue();
		assertThat(found.getUserId()).isEqualTo(owner);
		assertThat(found.getSchemaVersion()).isEqualTo(2);
		assertThat(json.readTree(found.getSounds()).path("soundSetId").asString()).isEqualTo("synth");
	}

	@Test
	void listsDefaultFirstThenNewestAndOnlyOwn() {
		var first = presets.saveAndFlush(KitPreset.create(owner, "첫째", LAYOUT, SOUNDS, 1));
		var second = presets.saveAndFlush(KitPreset.create(owner, "둘째", LAYOUT, SOUNDS, 1));
		var third = presets.saveAndFlush(KitPreset.create(owner, "셋째", LAYOUT, SOUNDS, 1));
		presets.saveAndFlush(KitPreset.create(other, "남의 것", LAYOUT, SOUNDS, 1));
		first.markDefault();
		presets.flush();

		assertThat(presets.findAllByUserIdOrderByIsDefaultDescCreatedAtDescIdDesc(owner))
				.extracting(KitPreset::getId)
				.containsExactly(first.getId(), third.getId(), second.getId());
		assertThat(presets.countByUserId(owner)).isEqualTo(3);
	}

	@Test
	void findsOnlyOwnPresetById() {
		var mine = presets.saveAndFlush(KitPreset.create(owner, "내 것", LAYOUT, SOUNDS, 1));
		assertThat(presets.findByIdAndUserId(mine.getId(), owner)).isPresent();
		assertThat(presets.findByIdAndUserId(mine.getId(), other)).isEmpty();
	}

	@Test
	void nameExistenceChecksAreScopedToOwnerAndCanExcludeSelf() {
		var mine = presets.saveAndFlush(KitPreset.create(owner, "같은 이름", LAYOUT, SOUNDS, 1));
		assertThat(presets.existsByUserIdAndName(owner, "같은 이름")).isTrue();
		assertThat(presets.existsByUserIdAndName(other, "같은 이름")).isFalse();
		assertThat(presets.existsByUserIdAndNameAndIdNot(owner, "같은 이름", mine.getId())).isFalse();
		var another = presets.saveAndFlush(KitPreset.create(owner, "다른 이름", LAYOUT, SOUNDS, 1));
		assertThat(presets.existsByUserIdAndNameAndIdNot(owner, "같은 이름", another.getId())).isTrue();
	}

	@Test
	void sameNameIsUniquePerOwnerOnly() {
		presets.saveAndFlush(KitPreset.create(owner, "같은 이름", LAYOUT, SOUNDS, 1));
		presets.saveAndFlush(KitPreset.create(other, "같은 이름", LAYOUT, SOUNDS, 1));
		assertThatThrownBy(() -> presets.saveAndFlush(KitPreset.create(owner, "같은 이름", LAYOUT, SOUNDS, 1)))
				.isInstanceOf(DataIntegrityViolationException.class);
	}

	@Test
	void onlyOneDefaultPerOwner() {
		var a = presets.saveAndFlush(KitPreset.create(owner, "가", LAYOUT, SOUNDS, 1));
		var b = presets.saveAndFlush(KitPreset.create(owner, "나", LAYOUT, SOUNDS, 1));
		var others = presets.saveAndFlush(KitPreset.create(other, "다", LAYOUT, SOUNDS, 1));
		a.markDefault();
		others.markDefault();
		presets.flush();
		b.markDefault();
		assertThatThrownBy(() -> presets.flush()).isInstanceOf(DataIntegrityViolationException.class);
	}

	@Test
	void clearDefaultClearsOnlyOwnersDefault() {
		var mine = presets.saveAndFlush(KitPreset.create(owner, "가", LAYOUT, SOUNDS, 1));
		var others = presets.saveAndFlush(KitPreset.create(other, "나", LAYOUT, SOUNDS, 1));
		mine.markDefault();
		others.markDefault();
		presets.flush();

		assertThat(presets.clearDefault(owner)).isEqualTo(1);
		assertThat(presets.findById(mine.getId()).orElseThrow().isDefault()).isFalse();
		assertThat(presets.findById(others.getId()).orElseThrow().isDefault()).isTrue();
	}

	@Test
	void newestRemainingIsFoundForDefaultSuccession() {
		presets.saveAndFlush(KitPreset.create(owner, "오래된", LAYOUT, SOUNDS, 1));
		var newest = presets.saveAndFlush(KitPreset.create(owner, "최신", LAYOUT, SOUNDS, 1));
		presets.saveAndFlush(KitPreset.create(other, "남의 최신", LAYOUT, SOUNDS, 1));
		assertThat(presets.findFirstByUserIdOrderByCreatedAtDescIdDesc(owner)).get()
				.extracting(KitPreset::getId).isEqualTo(newest.getId());
		assertThat(presets.findFirstByUserIdOrderByCreatedAtDescIdDesc(Long.MAX_VALUE)).isEmpty();
	}

	@Test
	void jsonColumnsMustBeObjects() {
		var id = presets.saveAndFlush(KitPreset.create(owner, "제약", LAYOUT, SOUNDS, 1)).getId();
		for (var sql : new String[] {
				"UPDATE kit_presets SET layout='[]' WHERE id=?",
				"UPDATE kit_presets SET sounds='\"x\"' WHERE id=?" }) {
			// 위반 하나가 테스트 트랜잭션을 중단시키지 않도록 문장마다 savepoint로 되돌린다.
			db.execute("SAVEPOINT ck");
			assertThatThrownBy(() -> db.update(sql, id)).as(sql).isInstanceOf(DataIntegrityViolationException.class);
			db.execute("ROLLBACK TO SAVEPOINT ck");
		}
	}

	/** 128: 캘리브레이션은 기기·세션 값이라 프리셋에 저장하지 않는다(명세 미결 #23). V13이 컬럼과 CHECK를 함께 지운다. */
	@Test
	void calibrationColumnAndConstraintAreDropped() {
		assertThat(db.queryForObject("SELECT count(*) FROM information_schema.columns "
				+ "WHERE table_schema = current_schema() AND table_name = 'kit_presets' AND column_name = 'calibration'",
				Long.class)).isZero();
		assertThat(db.queryForObject(
				"SELECT count(*) FROM pg_constraint WHERE conname = 'ck_kit_presets_calibration'", Long.class)).isZero();
	}

	@Test
	void deleteAllByUserIdRemovesOnlyThatOwnersPresets() {
		presets.saveAndFlush(KitPreset.create(owner, "가", LAYOUT, SOUNDS, 1));
		presets.saveAndFlush(KitPreset.create(owner, "나", LAYOUT, SOUNDS, 1));
		presets.saveAndFlush(KitPreset.create(other, "다", LAYOUT, SOUNDS, 1));

		presets.deleteAllByUserId(owner);
		presets.flush();

		assertThat(presets.countByUserId(owner)).isZero();
		assertThat(presets.countByUserId(other)).isEqualTo(1);
	}

	@Test
	void deletingUserRowCascadesToPresets() {
		presets.saveAndFlush(KitPreset.create(other, "다", LAYOUT, SOUNDS, 1));
		em.clear();
		db.update("DELETE FROM users WHERE id=?", other);
		assertThat(db.queryForObject("SELECT count(*) FROM kit_presets WHERE user_id=?", Long.class, other)).isZero();
	}

	@Test
	void deletingPresetNullsPlaySessionReference() {
		var preset = presets.saveAndFlush(KitPreset.create(owner, "플레이에 쓴", LAYOUT, SOUNDS, 1));
		var playId = UUID.randomUUID();
		db.update("""
				INSERT INTO play_sessions(id,user_id,mode,input_source,kit_preset_id,payload_schema_version,payload_hash,
				  started_at,ended_at) VALUES(?,?,'FREE','KEYBOARD',?,1,?,now(),now())
				""", playId, owner, preset.getId(), "a".repeat(64));

		presets.delete(preset);
		presets.flush();

		assertThat(db.queryForObject("SELECT kit_preset_id FROM play_sessions WHERE id=?", Long.class, playId)).isNull();
	}

}

package com.ssafy.airdrum.domain.song.service.admin;

import java.sql.ResultSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.ssafy.airdrum.domain.lesson.service.LessonService;
import com.ssafy.airdrum.domain.lesson.model.LessonSpec;
import com.ssafy.airdrum.domain.song.model.SongMetadata;
import com.ssafy.airdrum.domain.song.repository.SongMetadataRepository;

/**
 * 공용 곡 카탈로그를 DB에 맞춘다(254번 설계 3-2절). 살아 있는 공용 곡 중 제목이 같은 곡이 없으면 등록하고, 난이도가 3개 미만이면
 * MIDI로 채운다. 이미 3난이도면 건너뛴다. 곡마다 따로 처리해 하나가 실패해도 나머지는 계속한다.
 * 라이선스·아티스트·공개 여부는 등록 때만 쓰고 이후에는 덮지 않는다(운영자가 ADMIN API로 바꾼 값을 지키려고).
 * 곡 추천용 메타데이터(255번)는 결과와 무관하게 매번 카탈로그 값으로 맞춘다.
 * 학습 코스 레슨(331번, 중급은 학습 코스 설계)은 곡을 모두 처리한 뒤 카탈로그 레슨으로 통째로 바꾼다. 그래서 {@link #seed}는 카탈로그 전체를 받는다.
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class BuiltinSongSeeder {

	/** 여러 인스턴스가 동시에 떠도 한 곳만 실행하도록 잡는 PostgreSQL advisory lock 키. */
	static final long LOCK_KEY = 254_001L;

	enum Outcome { REGISTERED, FILLED, SKIPPED, FAILED }

	private static final Logger log = LoggerFactory.getLogger(BuiltinSongSeeder.class);

	private record Existing(long id, int difficulties) {
	}

	private final AdminSongService songs;
	private final SongMetadataRepository metadata;
	private final LessonService lessons;
	private final JdbcTemplate db;

	BuiltinSongSeeder(AdminSongService songs, SongMetadataRepository metadata, LessonService lessons, JdbcTemplate db) {
		this.songs = songs;
		this.metadata = metadata;
		this.lessons = lessons;
		this.db = db;
	}

	/** 곡 제목별 결과. 다른 인스턴스가 잠금을 쥐고 있으면 아무것도 하지 않고 빈 결과를 돌려준다. */
	Map<String, Outcome> seed(List<BuiltinSongCatalog.Entry> entries) {
		return db.execute((ConnectionCallback<Map<String, Outcome>>) connection -> {
			try (var lock = connection.prepareStatement("SELECT pg_try_advisory_lock(?)")) {
				lock.setLong(1, LOCK_KEY);
				try (ResultSet r = lock.executeQuery()) {
					r.next();
					if (!r.getBoolean(1)) {
						log.info("공용 곡 카탈로그 등록을 건너뜀: 다른 인스턴스가 실행 중");
						return Map.of();
					}
				}
			}
			try {
				var result = new LinkedHashMap<String, Outcome>();
				var lessonSongs = new LinkedHashMap<Long, LessonSpec>();
				for (var entry : entries) {
					var outcome = apply(entry);
					result.put(entry.title(), outcome);
					// 이번 처리가 실패해도 이미 있는 곡이면 레슨에 남긴다(빠지면 일반 공용 곡으로 목록·추천에 나온다)
					if (entry.lesson() != null) {
						var existing = find(entry.title());
						if (existing != null) lessonSongs.put(existing.id(), entry.lesson());
					}
				}
				syncLessons(lessonSongs);
				return result;
			} finally {
				try (var unlock = connection.prepareStatement("SELECT pg_advisory_unlock(?)")) {
					unlock.setLong(1, LOCK_KEY);
					unlock.execute();
				}
			}
		});
	}

	private Outcome apply(BuiltinSongCatalog.Entry entry) {
		try {
			var existing = find(entry.title());
			Outcome outcome;
			long id;
			if (existing == null) {
				id = songs.register(entry.title(), entry.artist(), entry.license(), entry.published(), entry.midi(), entry.offsetMs()).id();
				log.info("공용 곡 등록: {}", entry.title());
				outcome = Outcome.REGISTERED;
			} else if (existing.difficulties() >= 3) {
				id = existing.id();
				outcome = Outcome.SKIPPED;
			} else {
				id = existing.id();
				songs.regenerate(id, entry.midi(), entry.offsetMs());
				log.info("공용 곡 난이도 채움: {} (기존 난이도 {}개)", entry.title(), existing.difficulties());
				outcome = Outcome.FILLED;
			}
			syncMetadata(id, entry.meta());
			return outcome;
		} catch (RuntimeException e) {
			log.warn("공용 곡 등록 실패: {} errorType={} message={}", entry.title(), e.getClass().getSimpleName(), e.getMessage());
			return Outcome.FAILED;
		}
	}

	/** 레슨 교체가 실패해도 곡 등록 결과는 그대로 둔다. 레슨은 이전 상태로 남는다(한 트랜잭션). */
	private void syncLessons(java.util.Map<Long, LessonSpec> lessonSongs) {
		try {
			lessons.replaceAll(lessonSongs);
			if (!lessonSongs.isEmpty()) log.info("학습 코스 레슨 {}개", lessonSongs.size());
		} catch (RuntimeException e) {
			log.warn("학습 코스 레슨 교체 실패 errorType={} message={}", e.getClass().getSimpleName(), e.getMessage());
		}
	}

	/**
	 * 곡 추천용 메타데이터는 카탈로그가 유일한 출처라 시작할 때마다 덮어쓰고, 카탈로그에서 빠지면 지운다(255번 설계 U2).
	 * 곡 등록과 다른 문장이라 여기서 실패하면 곡은 남고 결과만 FAILED가 된다.
	 */
	private void syncMetadata(long songId, SongMetadata meta) {
		if (meta == null) metadata.delete(songId);
		else metadata.upsert(songId, meta);
	}

	/** 살아 있는 공용 곡 중 제목이 같은 곡(가장 오래된 것)과 그 곡의 난이도 수. 없으면 null. */
	private Existing find(String title) {
		return db.query("""
				SELECT s.id, count(DISTINCT c.difficulty) FROM songs s LEFT JOIN charts c ON c.song_id=s.id
				WHERE s.source='BUILTIN' AND s.owner_id IS NULL AND s.deleted_at IS NULL AND s.title=?
				GROUP BY s.id ORDER BY s.id LIMIT 1
				""", (r, n) -> new Existing(r.getLong(1), r.getInt(2)), title).stream().findFirst().orElse(null);
	}
}

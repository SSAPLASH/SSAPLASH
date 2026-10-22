package com.ssafy.airdrum.chart.asset;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import javax.sql.DataSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 명시적으로 실행할 때만 기본 8비트 반주 객체와 DB 참조를 연결한다. */
public final class PracticeBackingRegistrar {
	static final String TITLE = "기본 8비트";
	static final String KEY_PREFIX = "accompaniment/";
	static final String ORIGINAL_LICENSE = "프로젝트 FE 데모 연습 패턴; 원본 FE/src/domain/chart.ts@d4080d1; 별도 라이선스 표기 없음; 음원 미포함";
	static final String BACKING_LICENSE = "프로젝트 연습 패턴; 채보 원본 FE/src/domain/chart.ts@d4080d1(별도 라이선스 표기 없음); 반주 FE/src/audio/practiceBacking.ts 기준 직접 합성, 외부 샘플 미사용";
	static final String EXPECTED_NOTES_SHA256 = "acfae1ca6f3f3a850f738c7aef507050dbf9d48d88bda3eccc95235e1e0c4949";
	private static final byte[] BASIC_8_WAV = PracticeBackingWav.create();

	private final DataSource dataSource;
	private final PracticeBackingObjectStore objects;
	private final JsonMapper json;

	public PracticeBackingRegistrar(DataSource dataSource, PracticeBackingObjectStore objects) {
		this(dataSource, objects, JsonMapper.builder().build());
	}

	PracticeBackingRegistrar(DataSource dataSource, PracticeBackingObjectStore objects, JsonMapper json) {
		this.dataSource = dataSource;
		this.objects = objects;
		this.json = json;
	}

	public RegistrationResult register(String bucket) {
		if (bucket == null || bucket.isBlank()) throw new IllegalArgumentException("반주 버킷을 지정해야 합니다.");
		Target beforeUpload;
		try (var connection = dataSource.getConnection()) {
			beforeUpload = readTarget(connection, false);
		} catch (java.sql.SQLException ex) {
			throw databaseFailure();
		}

		byte[] wav = BASIC_8_WAV.clone();
		String sha256 = sha256(wav);
		String key = KEY_PREFIX + beforeUpload.songId() + ".wav";
		boolean reused = objects.ensureBytes(bucket, key, wav, sha256);
		boolean alreadyLinked;
		try (var connection = dataSource.getConnection()) {
			connection.setAutoCommit(false);
			try {
				Target current = readTarget(connection, true);
				if (current.songId() != beforeUpload.songId()) throw invalidTarget();
				if (current.accompanimentKey() != null && !current.accompanimentKey().equals(key)) throw invalidTarget();
				alreadyLinked = key.equals(current.accompanimentKey()) && BACKING_LICENSE.equals(current.license());
				if (!alreadyLinked) {
					try (var update = connection.prepareStatement("""
						UPDATE songs SET accompaniment_key=?, license=?, updated_at=now()
						WHERE id=? AND (accompaniment_key IS NULL OR accompaniment_key=?)
						""")) {
						update.setString(1, key);
						update.setString(2, BACKING_LICENSE);
						update.setLong(3, current.songId());
						update.setString(4, key);
						if (update.executeUpdate() != 1) throw invalidTarget();
					}
				}
				connection.commit();
			} catch (RuntimeException | java.sql.SQLException ex) {
				rollback(connection);
				if (ex instanceof RuntimeException runtime) throw runtime;
				throw databaseFailure();
			}
		} catch (java.sql.SQLException ex) {
			throw databaseFailure();
		}
		return new RegistrationResult(beforeUpload.songId(), key, wav.length, sha256, reused, alreadyLinked);
	}

	private Target readTarget(java.sql.Connection connection, boolean lock) throws java.sql.SQLException {
		String lockClause = lock ? " FOR UPDATE" : "";
		Target song;
		try (var query = connection.prepareStatement("""
			SELECT id, owner_id, title, artist, source, status, bpm, offset_ms, time_signature,
				duration_ms, license, accompaniment_key, deleted_at
			FROM songs WHERE title=?
			""" + lockClause)) {
			query.setString(1, TITLE);
			try (var rows = query.executeQuery()) {
				if (!rows.next()) throw invalidTarget();
				long id = rows.getLong("id");
				String license = rows.getString("license");
				String key = rows.getString("accompaniment_key");
				Integer offsetMs = (Integer) rows.getObject("offset_ms");
				if (rows.getObject("owner_id") != null || !TITLE.equals(rows.getString("title"))
						|| rows.getString("artist") != null || !"BUILTIN".equals(rows.getString("source"))
						|| !"READY".equals(rows.getString("status"))
						|| rows.getBigDecimal("bpm") == null || rows.getBigDecimal("bpm").compareTo(new BigDecimal("90.00")) != 0
						|| offsetMs == null || offsetMs != 0 || !"4/4".equals(rows.getString("time_signature"))
						|| rows.getInt("duration_ms") != 21_333 || rows.getObject("deleted_at") != null
						|| !(ORIGINAL_LICENSE.equals(license) || BACKING_LICENSE.equals(license))
						|| (key != null && !key.equals(KEY_PREFIX + id + ".wav"))) throw invalidTarget();
				if (rows.next()) throw invalidTarget();
				song = new Target(id, key, license);
			}
		}

		long chartId;
		try (var query = connection.prepareStatement("SELECT id, difficulty FROM charts WHERE song_id=?" + lockClause)) {
			query.setLong(1, song.songId());
			try (var rows = query.executeQuery()) {
				if (!rows.next() || !"EASY".equals(rows.getString("difficulty"))) throw invalidTarget();
				chartId = rows.getLong("id");
				if (rows.next()) throw invalidTarget();
			}
		}
		try (var query = connection.prepareStatement("""
			SELECT version, schema_version, notes::text AS notes, timing::text AS timing,
				notation_status, note_count, generator, generator_version, sheet_pages::text AS sheet_pages
			FROM chart_versions WHERE chart_id=?
			""" + lockClause)) {
			query.setLong(1, chartId);
			try (var rows = query.executeQuery()) {
				if (!rows.next()) throw invalidTarget();
				if (rows.getInt("version") != 1 || rows.getInt("schema_version") != 1
						|| !"UNAVAILABLE".equals(rows.getString("notation_status")) || rows.getInt("note_count") != 96
						|| !"BUILTIN".equals(rows.getString("generator"))
						|| !"FE-d4080d1".equals(rows.getString("generator_version"))
						|| rows.getString("sheet_pages") != null) throw invalidTarget();
				validateTiming(rows.getString("timing"));
				validateNotes(rows.getString("notes"));
				if (rows.next()) throw invalidTarget();
			}
		}
		return song;
	}

	private void validateTiming(String raw) {
		try {
			JsonNode timing = json.readTree(raw);
			if (timing == null || !timing.isObject() || timing.size() != 3
					|| !timing.path("bpm").isNumber() || timing.path("bpm").decimalValue().compareTo(new BigDecimal("90")) != 0
					|| !timing.path("offsetMs").isIntegralNumber() || !timing.path("offsetMs").canConvertToInt()
					|| timing.path("offsetMs").intValue() != 0
					|| !timing.path("timeSignature").isString() || !"4/4".equals(timing.path("timeSignature").asString()))
				throw invalidTarget();
		} catch (RuntimeException ex) { throw invalidTarget(); }
	}

	private void validateNotes(String raw) {
		try {
			JsonNode notes = json.readTree(raw);
			if (notes == null || !notes.isArray() || notes.size() != 96) throw invalidTarget();
			var canonical = new StringBuilder();
			long previousTime = -1;
			for (int index = 0; index < notes.size(); index++) {
				JsonNode note = notes.get(index);
				if (!note.isObject() || note.size() != 4 || !note.path("noteId").isString()
						|| !note.path("noteId").asString().equals("n" + String.format(Locale.ROOT, "%04d", index + 1))
						|| !note.path("timeMs").isIntegralNumber() || !note.path("timeMs").canConvertToLong()
						|| !note.path("pad").isString() || !note.path("velocityHint").isIntegralNumber()
						|| !note.path("velocityHint").canConvertToInt()) throw invalidTarget();
				long time = note.path("timeMs").longValue();
				String pad = note.path("pad").asString();
				int velocity = note.path("velocityHint").intValue();
				if (time < 0 || time < previousTime || pad.isBlank() || velocity < 0 || velocity > 127) throw invalidTarget();
				previousTime = time;
				if (index > 0) canonical.append('\n');
				canonical.append(time).append('|').append(pad).append('|').append(velocity);
			}
			String actual = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
					.digest(canonical.toString().getBytes(StandardCharsets.UTF_8)));
			if (!EXPECTED_NOTES_SHA256.equals(actual)) throw invalidTarget();
		} catch (java.security.NoSuchAlgorithmException ex) { throw invalidTarget(); }
	}

	private static String sha256(byte[] bytes) {
		try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
		catch (java.security.NoSuchAlgorithmException ex) { throw new IllegalStateException("SHA-256을 계산할 수 없습니다."); }
	}

	private static void rollback(java.sql.Connection connection) {
		try { connection.rollback(); } catch (java.sql.SQLException ignored) { /* 원래 실패를 유지한다. */ }
	}

	private static IllegalStateException invalidTarget() {
		return new IllegalStateException("기본 8비트 곡·채보가 등록 도구의 검증 기준과 달라 DB 연결을 중단했습니다.");
	}

	private static IllegalStateException databaseFailure() {
		return new IllegalStateException("기본 8비트 반주 DB 확인 또는 트랜잭션 등록에 실패했습니다.");
	}

	public record RegistrationResult(long songId, String objectKey, int byteLength, String sha256,
			boolean reusedObject, boolean alreadyLinked) {}

	private record Target(long songId, String accompanimentKey, String license) {}
}

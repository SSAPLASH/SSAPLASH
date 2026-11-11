package com.ssafy.airdrum.domain.chart.tool;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.AbstractDataSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 별도 PostgreSQL 스키마와 저장소 대역으로 등록 도구의 실패·재실행 경계를 확인한다. */
@SpringBootTest
class PracticeBackingRegistrationTest {
	@Autowired DataSource dataSource;
	private String schema;
	private JdbcTemplate db;
	private MemoryObjectStore objects;
	private PracticeBackingRegistrar registrar;

	@BeforeEach
	void prepareIsolatedSchema() throws Exception {
		schema = "mode82_" + java.util.UUID.randomUUID().toString().replace("-", "");
		try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
			statement.execute("CREATE SCHEMA " + schema);
		}
		Flyway.configure().dataSource(dataSource).locations("classpath:db/test-migration")
				.schemas(schema).defaultSchema(schema).target("12").load().migrate();
		var isolated = new SchemaDataSource(dataSource, schema);
		db = new JdbcTemplate(isolated);
		objects = new MemoryObjectStore();
		registrar = new PracticeBackingRegistrar(isolated, objects);
	}

	@AfterEach
	void removeIsolatedSchema() throws Exception {
		if (schema == null || !schema.matches("mode82_[a-f0-9]{32}")) return;
		try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
			statement.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
		}
	}

	@Test
	void generatedWavIsDeterministic44KhzStereoEightBarPcm() {
		byte[] wav = PracticeBackingWav.create();
		assertThat(new String(wav, 0, 4, StandardCharsets.US_ASCII)).isEqualTo("RIFF");
		assertThat(new String(wav, 8, 4, StandardCharsets.US_ASCII)).isEqualTo("WAVE");
		ByteBuffer header = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
		assertThat(Short.toUnsignedInt(header.getShort(22))).isEqualTo(2);
		assertThat(header.getInt(24)).isEqualTo(44_100);
		assertThat(Short.toUnsignedInt(header.getShort(34))).isEqualTo(16);
		assertThat(header.getInt(40)).isEqualTo(PracticeBackingWav.FRAME_COUNT * 4);
		assertThat(wav).hasSize(44 + PracticeBackingWav.FRAME_COUNT * 4);
		assertThat(Arrays.copyOfRange(wav, 44, 4096)).containsAnyOf((byte) 1, (byte) -1);
		assertThat(S3PracticeBackingObjectStore.sha256(wav)).isEqualTo("1911fe0ac366c41423ed196d9564f04cf971752600e9d71cbeb79f2d9bb1d85d");
		assertThat(S3PracticeBackingObjectStore.sha256(PracticeBackingWav.create())).isEqualTo(S3PracticeBackingObjectStore.sha256(wav));
	}

	@Test
	void linksVerifiedObjectAndIsIdempotentOnRerun() {
		var first = registrar.register("backing");
		assertThat(first.objectKey()).isEqualTo("accompaniment/" + builtinSongId() + ".wav");
		assertThat(first.byteLength()).isEqualTo(44 + PracticeBackingWav.FRAME_COUNT * 4);
		assertThat(first.reusedObject()).isFalse();
		assertThat(first.alreadyLinked()).isFalse();
		assertThat(objects.writeCount).isEqualTo(1);
		assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?", String.class, builtinSongId()))
				.isEqualTo(first.objectKey());
		assertThat(db.queryForObject("SELECT license FROM songs WHERE id=?", String.class, builtinSongId()))
				.isEqualTo(PracticeBackingRegistrar.BACKING_LICENSE);

		var second = registrar.register("backing");
		assertThat(second.reusedObject()).isTrue();
		assertThat(second.alreadyLinked()).isTrue();
		assertThat(second.sha256()).isEqualTo(first.sha256());
		assertThat(objects.writeCount).isEqualTo(1);
	}

	@Test
	void uploadFailureOrMismatchingExistingBytesLeavesDatabaseUnchanged() {
		objects.failure = true;
		assertThatThrownBy(() -> registrar.register("backing")).hasMessageContaining("저장소");
		assertThat(accompanimentKey()).isNull();

		objects.failure = false;
		objects.existing.put(objectName(), new byte[] {1, 2, 3});
		assertThatThrownBy(() -> registrar.register("backing")).hasMessageContaining("내용");
		assertThat(accompanimentKey()).isNull();
		assertThat(objects.writeCount).isZero();
	}

	@Test
	void changedSeedNotesAreRejectedBeforeStorage() {
		db.update("UPDATE chart_versions SET notes=jsonb_set(notes, '{0,pad}', '\"SNARE\"'::jsonb) " +
				"WHERE chart_id=(SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title=?)", PracticeBackingRegistrar.TITLE);
		assertThatThrownBy(() -> registrar.register("backing")).hasMessageContaining("검증 기준과 달라");
		assertThat(objects.callCount).isZero();
	}

	@Test
	void integerValuesOutsideCanonicalRangeAreRejectedBeforeStorage() {
		db.update("UPDATE chart_versions SET notes=jsonb_set(notes, '{0,velocityHint}', '4294967296'::jsonb) " +
				"WHERE chart_id=(SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title=?)", PracticeBackingRegistrar.TITLE);
		assertThatThrownBy(() -> registrar.register("backing")).hasMessageContaining("검증 기준과 달라");
		assertThat(objects.callCount).isZero();
	}

	@Test
	void noteTimesOutsideLongRangeAreRejectedBeforeStorage() {
		db.update("UPDATE chart_versions SET notes=jsonb_set(notes, '{0,timeMs}', '9223372036854775808'::jsonb) " +
				"WHERE chart_id=(SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title=?)", PracticeBackingRegistrar.TITLE);
		assertThatThrownBy(() -> registrar.register("backing")).hasMessageContaining("검증 기준과 달라");
		assertThat(objects.callCount).isZero();
	}

	@Test
	void duplicateBuiltinTitleIsRejectedBeforeStorage() {
		db.update("INSERT INTO songs(title,source,status,bpm,offset_ms,time_signature,duration_ms,license) " +
				"VALUES (?,'BUILTIN','READY',90,0,'4/4',21333,'중복 fixture')", PracticeBackingRegistrar.TITLE);
		assertThatThrownBy(() -> registrar.register("backing")).hasMessageContaining("검증 기준과 달라");
		assertThat(objects.callCount).isZero();
	}

	@Test
	void extraChartVersionIsRejectedBeforeStorage() {
		long chartId = db.queryForObject("SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title=?", Long.class,
				PracticeBackingRegistrar.TITLE);
		db.update("INSERT INTO chart_versions(chart_id,version,schema_version,notes,timing,notation_status,note_count,generator,generator_version) " +
				"SELECT chart_id,2,schema_version,notes,timing,notation_status,note_count,generator,generator_version FROM chart_versions WHERE chart_id=?", chartId);
		assertThatThrownBy(() -> registrar.register("backing")).hasMessageContaining("검증 기준과 달라");
		assertThat(objects.callCount).isZero();
		assertThat(accompanimentKey()).isNull();
	}

	@Test
	void rechecksLockedSongAfterObjectUploadBeforeCommittingReference() {
		long songId = builtinSongId();
		String changedKey = "accompaniment/" + songId + ".mp3";
		objects.afterWrite = () -> db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", changedKey, songId);
		assertThatThrownBy(() -> registrar.register("backing")).hasMessageContaining("검증 기준과 달라");
		assertThat(accompanimentKey()).isEqualTo(changedKey);
		assertThat(objects.writeCount).isEqualTo(1);
	}

	private long builtinSongId() {
		return db.queryForObject("SELECT id FROM songs WHERE title=?", Long.class, PracticeBackingRegistrar.TITLE);
	}

	private String accompanimentKey() {
		return db.queryForObject("SELECT accompaniment_key FROM songs WHERE title=?", String.class, PracticeBackingRegistrar.TITLE);
	}

	private String objectName() { return "backing/accompaniment/" + builtinSongId() + ".wav"; }

	private static final class MemoryObjectStore implements PracticeBackingObjectStore {
		private final Map<String, byte[]> existing = new HashMap<>();
		private int callCount;
		private int writeCount;
		private boolean failure;
		private Runnable afterWrite;

		@Override
		public boolean ensureBytes(String bucket, String key, byte[] expectedBytes, String expectedSha256) {
			callCount++;
			if (failure) throw new IllegalStateException("저장소 업로드 실패");
			String id = bucket + "/" + key;
			byte[] actual = existing.get(id);
			if (actual != null) {
				if (actual.length != expectedBytes.length || !S3PracticeBackingObjectStore.sha256(actual).equals(expectedSha256))
					throw new IllegalStateException("기존 객체 내용이 다릅니다.");
				return true;
			}
			existing.put(id, expectedBytes.clone());
			writeCount++;
			if (afterWrite != null) afterWrite.run();
			return false;
		}
	}

	private static final class SchemaDataSource extends AbstractDataSource {
		private final DataSource delegate;
		private final String schema;
		private SchemaDataSource(DataSource delegate, String schema) { this.delegate = delegate; this.schema = schema; }
		@Override public Connection getConnection() throws SQLException { return scoped(delegate.getConnection()); }
		@Override public Connection getConnection(String username, String password) throws SQLException {
			return scoped(delegate.getConnection(username, password));
		}
		private Connection scoped(Connection connection) throws SQLException {
			connection.setSchema(schema);
			return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class}, (proxy, method, args) -> {
				if ("close".equals(method.getName()) && method.getParameterCount() == 0) {
					try { connection.setSchema("public"); } finally { connection.close(); }
					return null;
				}
				try { return method.invoke(connection, args); }
				catch (InvocationTargetException ex) { throw ex.getCause(); }
			});
		}
	}
}

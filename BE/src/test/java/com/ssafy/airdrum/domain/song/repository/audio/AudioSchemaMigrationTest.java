package com.ssafy.airdrum.domain.song.repository.audio;

import static org.assertj.core.api.Assertions.*;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.UUID;

import javax.sql.DataSource;

@SpringBootTest
class AudioSchemaMigrationTest {
    @Autowired DataSource source;

    @Test
    void v14UpgradeAndFreshApplyPreserveData() throws Exception {
        for (boolean upgrade : new boolean[] {true, false}) {
            String schema = "audio_" + UUID.randomUUID().toString().replace("-", "");
            try {
                if (upgrade) {
                    var before = flyway(schema, "14");
                    assertThat(before.migrate().migrationsExecuted).isEqualTo(13);
                    try (var c = source.getConnection();
                            var st = c.createStatement()) {
                        c.setSchema(schema);
                        st.execute("INSERT INTO users(nickname) VALUES('existing')");
                    }
                }
                var after = flyway(schema, "15");
                assertThat(after.migrate().migrationsExecuted).isEqualTo(upgrade ? 1 : 14);
                after.validate();
                assertThat(after.migrate().migrationsExecuted).isZero();
                try (var c = source.getConnection();
                        var st = c.createStatement()) {
                    c.setSchema(schema);
                    try (var rows = st.executeQuery("SELECT count(*) FROM audio_uploads")) {
                        rows.next();
                        assertThat(rows.getInt(1)).isZero();
                    }
                    if (upgrade)
                        try (var rows =
                                st.executeQuery(
                                        "SELECT nickname FROM users WHERE nickname='existing'")) {
                            assertThat(rows.next()).isTrue();
                        }
                }
            } finally {
                try (var c = source.getConnection();
                        var st = c.createStatement()) {
                    st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
                }
            }
        }
    }

    @Test
    void v24ExpandsMimeConstraintWithoutChangingExistingRows() throws Exception {
        String schema = "audio_" + UUID.randomUUID().toString().replace("-", "");
        try {
            var before = flyway(schema, "23");
            assertThat(before.migrate().migrationsExecuted).isEqualTo(22);
            var originalIds = new java.util.HashMap<String, String>();
            try (var c = source.getConnection(); var st = c.createStatement()) {
                c.setSchema(schema);
                st.execute("INSERT INTO users(nickname) VALUES('existing')");
                for (String mime : new String[] {"audio/mpeg", "audio/wav"}) originalIds.put(mime, insertAudio(st, mime));
            }
            var after = flyway(schema, "24");
            assertThat(after.migrate().migrationsExecuted).isEqualTo(1);
            after.validate();
            assertThat(after.migrate().migrationsExecuted).isZero();
            try (var c = source.getConnection(); var st = c.createStatement()) {
                c.setSchema(schema);
                for (String mime : new String[] {"audio/mp4", "audio/ogg"}) insertAudio(st, mime);
                try (var rows = st.executeQuery("SELECT id, content_type FROM audio_uploads")) {
                    var types = new java.util.ArrayList<String>();
                    while (rows.next()) {
                        String mime = rows.getString("content_type");
                        types.add(mime);
                        if (originalIds.containsKey(mime)) assertThat(rows.getString("id")).isEqualTo(originalIds.get(mime));
                    }
                    assertThat(types).containsExactlyInAnyOrder("audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav");
                }
                assertThatThrownBy(() -> insertAudio(st, "video/mp4")).isInstanceOf(java.sql.SQLException.class);
            }
        } finally {
            try (var c = source.getConnection(); var st = c.createStatement()) {
                st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            }
        }
    }

    private String insertAudio(java.sql.Statement st, String mime) throws java.sql.SQLException {
        String id = UUID.randomUUID().toString();
        st.execute("INSERT INTO audio_uploads(id,user_id,object_key,content_type,size_bytes,sha256,duration_ms,status,expires_at) "
                + "VALUES('" + id + "',(SELECT id FROM users WHERE nickname='existing'),'source-audio/" + id
                + "','" + mime + "',1,'" + "a".repeat(64) + "',1000,'UPLOADING',now()+interval '1 hour')");
        return id;
    }

    Flyway flyway(String schema, String target) {
        return Flyway.configure()
                .dataSource(source)
                .schemas(schema)
                .defaultSchema(schema)
                .locations("classpath:db/test-migration")
                .target(target)
                .load();
    }
}

package com.ssafy.airdrum.song.audio;

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

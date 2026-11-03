package com.ssafy.airdrum.song;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest
class SongLevelMigrationTest {
    @Autowired DataSource source;
    @Test void v28PreservesRowsEnforcesAllFieldsAndRestrictsDeletion() throws Exception {
        String schema="level28_"+UUID.randomUUID().toString().replace("-","");
        var pool=(HikariDataSource)source;
        DataSource isolated=new DriverManagerDataSource(pool.getJdbcUrl(),pool.getUsername(),pool.getPassword());
        try {
            flyway(isolated,schema,"27").migrate();
            try (Connection c=isolated.getConnection(); var s=c.createStatement()) {
                s.execute("SET search_path TO "+schema);
                try {
                    s.execute("INSERT INTO songs(id,title,source,status,license,duration_ms) OVERRIDING SYSTEM VALUE VALUES(999999,'legacy','BUILTIN','READY','x',1000)");
                    s.execute("INSERT INTO charts(id,song_id,difficulty) OVERRIDING SYSTEM VALUE VALUES(999999,999999,'NORMAL')");
                    s.execute("INSERT INTO chart_versions(id,chart_id,version,notes,timing,notation_status,note_count,generator) OVERRIDING SYSTEM VALUE VALUES(999999,999999,1,'[]','{}','PENDING',0,'BUILTIN')");
                } finally { s.execute("RESET search_path"); }
            }
            flyway(isolated,schema,"29").migrate();
            try (Connection c=isolated.getConnection(); var s=c.createStatement()) {
                s.execute("SET search_path TO "+schema);
                try {
                    try (var rows=s.executeQuery("SELECT title,level_legacy_fallback,song_level FROM songs WHERE id=999999")) {
                        assertThat(rows.next()).isTrue(); assertThat(rows.getString(1)).isEqualTo("legacy");
                        assertThat(rows.getBoolean(2)).isTrue(); assertThat(rows.getString(3)).isNull();
                    }
                    assertThatThrownBy(() -> s.execute("UPDATE songs SET song_level='BEGINNER' WHERE id=999999"))
                            .isInstanceOf(SQLException.class).extracting(ex -> ((SQLException)ex).getSQLState()).isEqualTo("23514");
                    s.execute("UPDATE songs SET song_level='BEGINNER',level_chart_version_id=999999,level_rule_version='song-level-1',level_duration_ms=1000 WHERE id=999999");
                    assertThatThrownBy(() -> s.execute("DELETE FROM chart_versions WHERE id=999999"))
                            .isInstanceOf(SQLException.class).extracting(ex -> ((SQLException)ex).getSQLState()).isEqualTo("23503");
                    s.execute("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE id=999999");
                    s.execute("DELETE FROM chart_versions WHERE id=999999"); s.execute("DELETE FROM charts WHERE id=999999"); s.execute("DELETE FROM songs WHERE id=999999");
                } finally { s.execute("RESET search_path"); }
            }
            assertThat(flyway(isolated,schema,"29").migrate().migrationsExecuted).isZero();
        } finally {
            try (Connection c=isolated.getConnection(); var s=c.createStatement()) { s.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE"); }
        }
    }
    private Flyway flyway(DataSource isolated,String schema,String target) {
        return Flyway.configure().dataSource(isolated).schemas(schema).defaultSchema(schema).locations("classpath:db/test-migration").target(target).load();
    }
}

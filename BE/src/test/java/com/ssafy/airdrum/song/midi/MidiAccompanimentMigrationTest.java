package com.ssafy.airdrum.song.midi;

import static org.assertj.core.api.Assertions.*;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.zaxxer.hikari.HikariDataSource;

@SpringBootTest
class MidiAccompanimentMigrationTest {
    @Autowired DataSource dataSource;
    @Test void v30PreservesOldDataAndEnforcesNewReferencesAndActiveUniqueness() throws Exception {
        String schema="midi30_"+UUID.randomUUID().toString().replace("-","");
        var pool=(HikariDataSource)dataSource;
        DataSource isolated=new DriverManagerDataSource(pool.getJdbcUrl(),pool.getUsername(),pool.getPassword());
        try {
            flyway(isolated,schema,"29").migrate(); long user,song;
            try (Connection connection=isolated.getConnection(); var sql=connection.createStatement()) {
                sql.execute("SET search_path TO "+schema);
                try (var row=sql.executeQuery("INSERT INTO users(nickname) VALUES('legacy') RETURNING id")) { row.next(); user=row.getLong(1); }
                try (var row=sql.executeQuery("INSERT INTO songs(owner_id,title,source) VALUES("+user+",'legacy MIDI','MIDI') RETURNING id")) { row.next(); song=row.getLong(1); }
                sql.execute("INSERT INTO songs(owner_id,title,source,accompaniment_key) VALUES("+user+",'legacy AUDIO','AUDIO','accompaniment/legacy.flac')");
            }
            assertThat(flyway(isolated,schema,"30").migrate().migrationsExecuted).isEqualTo(1);
            try (Connection connection=isolated.getConnection(); var sql=connection.createStatement()) {
                sql.execute("SET search_path TO "+schema);
                try (var row=sql.executeQuery("SELECT title,accompaniment_key FROM songs WHERE id="+song)) {
                    assertThat(row.next()).isTrue(); assertThat(row.getString(1)).isEqualTo("legacy MIDI"); assertThat(row.getString(2)).isNull();
                }
                assertThat(sql.executeUpdate("UPDATE songs SET accompaniment_key='accompaniment/"+song+".flac' WHERE id="+song)).isEqualTo(1);
                var original=UUID.randomUUID();
                sql.execute("INSERT INTO midi_original_uploads(id,user_id,reserved_song_id,song_id,object_key,size_bytes,sha256,status,expires_at) VALUES('"+original+"',"+user+","+song+","+song+",'midi-original/test',3,'"+"a".repeat(64)+"','ACCEPTED',clock_timestamp()+interval '30 seconds')");
                String insert="INSERT INTO midi_accompaniment_jobs(song_id,user_id,original_id,timing,duration_ms,status) VALUES("+song+","+user+",'"+original+"','{}',1000,'QUEUED')";
                sql.execute(insert);
                assertThatThrownBy(()->sql.execute(insert)).isInstanceOf(SQLException.class).extracting(e->((SQLException)e).getSQLState()).isEqualTo("23505");
                assertThatThrownBy(()->sql.execute("INSERT INTO file_cleanup_tasks(object_key,file_role) VALUES('bad','MIDI_ORIGINAL')"))
                        .isInstanceOf(SQLException.class).extracting(e->((SQLException)e).getSQLState()).isEqualTo("23514");
                assertThatThrownBy(()->sql.execute("INSERT INTO file_cleanup_tasks(object_key,file_role,midi_job_id,midi_attempt_id) SELECT 'bad2','ACCOMPANIMENT',id,'"+UUID.randomUUID()+"' FROM midi_accompaniment_jobs WHERE song_id="+song))
                        .isInstanceOf(SQLException.class).extracting(e->((SQLException)e).getSQLState()).isEqualTo("23503");
            }
            assertThat(flyway(isolated,schema,"30").migrate().migrationsExecuted).isZero();
        } finally {
            try (Connection connection=isolated.getConnection(); var sql=connection.createStatement()) { sql.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE"); }
        }
    }
    private static Flyway flyway(DataSource source,String schema,String target) {
        return Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).locations("classpath:db/test-migration").target(target).load();
    }
}

package com.ssafy.airdrum.chart.worker;

import static org.assertj.core.api.Assertions.*;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;
import javax.sql.DataSource;
import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@SpringBootTest
class ChartFailureReasonMigrationTest {
    @Autowired DataSource source;
    @Test void v49PreservesExistingFailureAndConstrainsReason() throws Exception {
        String schema="reason49_"+UUID.randomUUID().toString().replace("-","");
        var pool=(HikariDataSource)source;
        DataSource isolated=new DriverManagerDataSource(pool.getJdbcUrl(),pool.getUsername(),pool.getPassword());
        try {
            flyway(isolated,schema,"48").migrate();
            try (Connection c=isolated.getConnection(); var s=c.createStatement()) {
                s.execute("SET search_path TO "+schema);
                s.execute("INSERT INTO users(id,nickname) OVERRIDING SYSTEM VALUE VALUES(999999,'legacy')");
                s.execute("INSERT INTO songs(id,owner_id,title,source,status) OVERRIDING SYSTEM VALUE VALUES(999999,999999,'legacy','AUDIO','FAILED')");
                s.execute("INSERT INTO chart_jobs(id,song_id,user_id,status,error_code,error_message,finished_at,idempotency_key,request_hash) OVERRIDING SYSTEM VALUE VALUES(999999,999999,999999,'FAILED','INPUT_INVALID','old',now(),'legacy','"+"a".repeat(64)+"')");
            }
            var migration=flyway(isolated,schema,"49");
            assertThat(migration.migrate().migrationsExecuted).isEqualTo(1);
            try (Connection c=isolated.getConnection(); var s=c.createStatement()) {
                s.execute("SET search_path TO "+schema);
                try (var rows=s.executeQuery("SELECT error_code,error_message,error_reason FROM chart_jobs WHERE id=999999")) {
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getString(1)).isEqualTo("INPUT_INVALID");
                    assertThat(rows.getString(2)).isEqualTo("old");
                    assertThat(rows.getString(3)).isNull();
                }
                for (String reason : new String[]{"SOURCE_INVALID", "NOT_TRANSCRIBABLE", "GPU_OUT_OF_MEMORY", "INTERNAL_ERROR"})
                    assertThat(s.executeUpdate("UPDATE chart_jobs SET error_reason='"+reason+"' WHERE id=999999")).isEqualTo(1);
                assertThatThrownBy(() -> s.execute("UPDATE chart_jobs SET error_reason='UNKNOWN' WHERE id=999999"))
                        .isInstanceOf(SQLException.class).extracting(ex -> ((SQLException)ex).getSQLState()).isEqualTo("23514");
            }
            assertThat(migration.migrate().migrationsExecuted).isZero();
        } finally {
            try (Connection c=isolated.getConnection(); var s=c.createStatement()) { s.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE"); }
        }
    }
    private Flyway flyway(DataSource source,String schema,String target) {
        return Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).locations("classpath:db/test-migration").target(target).load();
    }
}

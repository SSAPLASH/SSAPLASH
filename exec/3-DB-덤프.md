# 3. DB 덤프

덤프 파일: [`db/app_schema.sql`](./db/app_schema.sql)

## 3.1 담은 것과 뺀 것

| 구분 | 내용 |
| --- | --- |
| 담음 | 운영 앱 DB(PostgreSQL 16 + TimescaleDB)의 전체 스키마(테이블, 인덱스, 뷰, 함수), Flyway 마이그레이션 이력(`flyway_schema_history`) |
| 뺌 | 회원, 소셜 계정, 연주 기록, 녹음, 리포트, 동의 이력 등 **개인정보가 든 데이터** |

- 기본 곡과 레슨 데이터는 덤프에 넣지 않는다. BE가 시작할 때 `BE/src/main/resources/builtin-songs/`의 카탈로그로 자동 등록한다(`BuiltinSongSeeder`).
- 스키마의 원본은 Flyway 마이그레이션(`BE/src/main/resources/db/migration/`)이다. 빈 DB에 BE를 띄우면 같은 스키마가 만들어진다.

## 3.2 덤프 만드는 법 (EC2 서버)

`/srv/airdrum/Infra`에서 실행한다. 컨테이너 안의 환경변수를 쓰므로 비밀번호를 명령에 적지 않는다.

```bash
cd /srv/airdrum/Infra
OUT=~/app_schema.sql
# 1. 스키마
sudo docker compose -p infra exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema-only --no-owner --no-privileges' > "$OUT"
# 2. Flyway 이력 (개인정보 없음)
sudo docker compose -p infra exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --data-only --no-owner --table=public.flyway_schema_history' >> "$OUT"
grep -c "CREATE TABLE" "$OUT"
```

- TimescaleDB 내부 카탈로그 때문에 `circular foreign-key constraints` 경고가 나올 수 있다. 덤프는 정상이다.
- 파일에 `INSERT`나 `COPY`가 `flyway_schema_history` 말고 없는지 확인한다: `grep -E "^COPY " "$OUT"`

## 3.3 복원하는 법

빈 DB에 복원한다. 운영 DB에 바로 복원하지 않는다.

```bash
cd /srv/airdrum/Infra
sudo docker compose -p infra exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE restore_test"'
sudo docker compose -p infra exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d restore_test -c "CREATE EXTENSION IF NOT EXISTS timescaledb"'
sudo docker compose -p infra exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d restore_test -c "SELECT timescaledb_pre_restore()"'
sudo docker compose -p infra exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d restore_test' < exec/db/app_schema.sql
sudo docker compose -p infra exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d restore_test -c "SELECT timescaledb_post_restore()"'
```

- 스키마만 담은 덤프라 TimescaleDB 내부 카탈로그 데이터가 없다. 그래서 `telemetry_events`가 hypertable로 복원되지 않을 수 있다. hypertable 전환은 마이그레이션 `V8__convert_telemetry_to_hypertable.sql`이 한다. 이 복원 절차는 서버에서 시험하지 않았다.
- 복원한 DB의 `flyway_schema_history`가 저장소의 마이그레이션과 같으면, BE가 마이그레이션을 이미 적용된 것으로 보고 그대로 시작한다.
- 새 서버를 만들 때는 복원 없이 빈 DB에 BE를 띄워도 된다. Flyway가 스키마를 만들고 기본 곡이 등록된다.
- 운영 데이터까지 옮기는 백업·복구 절차(개인정보 포함, 저장소에 올리지 않음)는 [Infra/PORTING.md](../Infra/PORTING.md) 6절에 있다.

-- S15P31A307-99: 프로젝트 FE의 반주 없는 내장 연습 채보 3개를 최초 적재한다.
-- 원본: https://lab.ssafy.com/s15-final/S15P31A307/-/blob/d4080d10521263e6040f3ef6b2ddfe80cff3d771/FE/src/domain/chart.ts
-- license는 저작권 선언이 아니라 출처와 미표기 상태를 기록한다.

WITH inserted_song AS (
  INSERT INTO songs (title, artist, source, status, bpm, offset_ms, time_signature, duration_ms, license, accompaniment_key)
  VALUES ('기본 8비트', NULL, 'BUILTIN', 'READY', 90, 0, '4/4', 21333, '프로젝트 FE 데모 연습 패턴; 원본 FE/src/domain/chart.ts@d4080d1; 별도 라이선스 표기 없음; 음원 미포함', NULL)
  RETURNING id
), inserted_chart AS (
  INSERT INTO charts (song_id, difficulty)
  SELECT id, 'EASY' FROM inserted_song
  RETURNING id
)
INSERT INTO chart_versions (chart_id, version, schema_version, notes, timing, notation_status, note_count, generator, generator_version, sheet_pages)
SELECT id, 1, 1, '[
  {
    "noteId": "n0001",
    "timeMs": 0,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0002",
    "timeMs": 0,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0003",
    "timeMs": 333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0004",
    "timeMs": 667,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0005",
    "timeMs": 667,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0006",
    "timeMs": 1000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0007",
    "timeMs": 1333,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0008",
    "timeMs": 1333,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0009",
    "timeMs": 1667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0010",
    "timeMs": 2000,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0011",
    "timeMs": 2000,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0012",
    "timeMs": 2333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0013",
    "timeMs": 2667,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0014",
    "timeMs": 2667,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0015",
    "timeMs": 3000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0016",
    "timeMs": 3333,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0017",
    "timeMs": 3333,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0018",
    "timeMs": 3667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0019",
    "timeMs": 4000,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0020",
    "timeMs": 4000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0021",
    "timeMs": 4333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0022",
    "timeMs": 4667,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0023",
    "timeMs": 4667,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0024",
    "timeMs": 5000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0025",
    "timeMs": 5333,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0026",
    "timeMs": 5333,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0027",
    "timeMs": 5667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0028",
    "timeMs": 6000,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0029",
    "timeMs": 6000,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0030",
    "timeMs": 6333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0031",
    "timeMs": 6667,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0032",
    "timeMs": 6667,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0033",
    "timeMs": 7000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0034",
    "timeMs": 7333,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0035",
    "timeMs": 7333,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0036",
    "timeMs": 7667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0037",
    "timeMs": 8000,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0038",
    "timeMs": 8000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0039",
    "timeMs": 8333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0040",
    "timeMs": 8667,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0041",
    "timeMs": 8667,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0042",
    "timeMs": 9000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0043",
    "timeMs": 9333,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0044",
    "timeMs": 9333,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0045",
    "timeMs": 9667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0046",
    "timeMs": 10000,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0047",
    "timeMs": 10000,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0048",
    "timeMs": 10333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0049",
    "timeMs": 10667,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0050",
    "timeMs": 10667,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0051",
    "timeMs": 11000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0052",
    "timeMs": 11333,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0053",
    "timeMs": 11333,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0054",
    "timeMs": 11667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0055",
    "timeMs": 12000,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0056",
    "timeMs": 12000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0057",
    "timeMs": 12333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0058",
    "timeMs": 12667,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0059",
    "timeMs": 12667,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0060",
    "timeMs": 13000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0061",
    "timeMs": 13333,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0062",
    "timeMs": 13333,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0063",
    "timeMs": 13667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0064",
    "timeMs": 14000,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0065",
    "timeMs": 14000,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0066",
    "timeMs": 14333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0067",
    "timeMs": 14667,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0068",
    "timeMs": 14667,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0069",
    "timeMs": 15000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0070",
    "timeMs": 15333,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0071",
    "timeMs": 15333,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0072",
    "timeMs": 15667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0073",
    "timeMs": 16000,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0074",
    "timeMs": 16000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0075",
    "timeMs": 16333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0076",
    "timeMs": 16667,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0077",
    "timeMs": 16667,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0078",
    "timeMs": 17000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0079",
    "timeMs": 17333,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0080",
    "timeMs": 17333,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0081",
    "timeMs": 17667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0082",
    "timeMs": 18000,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0083",
    "timeMs": 18000,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0084",
    "timeMs": 18333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0085",
    "timeMs": 18667,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0086",
    "timeMs": 18667,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0087",
    "timeMs": 19000,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0088",
    "timeMs": 19333,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0089",
    "timeMs": 19333,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0090",
    "timeMs": 19667,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0091",
    "timeMs": 20000,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0092",
    "timeMs": 20000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0093",
    "timeMs": 20333,
    "pad": "HIHAT",
    "velocityHint": 70
  },
  {
    "noteId": "n0094",
    "timeMs": 20667,
    "pad": "HIHAT",
    "velocityHint": 90
  },
  {
    "noteId": "n0095",
    "timeMs": 20667,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0096",
    "timeMs": 21000,
    "pad": "HIHAT",
    "velocityHint": 70
  }
]'::jsonb, '{"bpm":90,"offsetMs":0,"timeSignature":"4/4"}'::jsonb, 'UNAVAILABLE', 96, 'BUILTIN', 'FE-d4080d1', NULL
FROM inserted_chart;

WITH inserted_song AS (
  INSERT INTO songs (title, artist, source, status, bpm, offset_ms, time_signature, duration_ms, license, accompaniment_key)
  VALUES ('8비트 + 필인', NULL, 'BUILTIN', 'READY', 100, 0, '4/4', 19200, '프로젝트 FE 데모 연습 패턴; 원본 FE/src/domain/chart.ts@d4080d1; 별도 라이선스 표기 없음; 음원 미포함', NULL)
  RETURNING id
), inserted_chart AS (
  INSERT INTO charts (song_id, difficulty)
  SELECT id, 'NORMAL' FROM inserted_song
  RETURNING id
)
INSERT INTO chart_versions (chart_id, version, schema_version, notes, timing, notation_status, note_count, generator, generator_version, sheet_pages)
SELECT id, 1, 1, '[
  {
    "noteId": "n0001",
    "timeMs": 0,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0002",
    "timeMs": 0,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0003",
    "timeMs": 300,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0004",
    "timeMs": 600,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0005",
    "timeMs": 600,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0006",
    "timeMs": 900,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0007",
    "timeMs": 1200,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0008",
    "timeMs": 1200,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0009",
    "timeMs": 1500,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0010",
    "timeMs": 1500,
    "pad": "KICK",
    "velocityHint": 95
  },
  {
    "noteId": "n0011",
    "timeMs": 1800,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0012",
    "timeMs": 1800,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0013",
    "timeMs": 2100,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0014",
    "timeMs": 2400,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0015",
    "timeMs": 2400,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0016",
    "timeMs": 2700,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0017",
    "timeMs": 3000,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0018",
    "timeMs": 3000,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0019",
    "timeMs": 3300,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0020",
    "timeMs": 3600,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0021",
    "timeMs": 3600,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0022",
    "timeMs": 3900,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0023",
    "timeMs": 3900,
    "pad": "KICK",
    "velocityHint": 95
  },
  {
    "noteId": "n0024",
    "timeMs": 4200,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0025",
    "timeMs": 4200,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0026",
    "timeMs": 4500,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0027",
    "timeMs": 4800,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0028",
    "timeMs": 4800,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0029",
    "timeMs": 5100,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0030",
    "timeMs": 5400,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0031",
    "timeMs": 5400,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0032",
    "timeMs": 5700,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0033",
    "timeMs": 6000,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0034",
    "timeMs": 6000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0035",
    "timeMs": 6300,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0036",
    "timeMs": 6300,
    "pad": "KICK",
    "velocityHint": 95
  },
  {
    "noteId": "n0037",
    "timeMs": 6600,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0038",
    "timeMs": 6600,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0039",
    "timeMs": 6900,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0040",
    "timeMs": 7200,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0041",
    "timeMs": 7200,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0042",
    "timeMs": 7500,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0043",
    "timeMs": 7800,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0044",
    "timeMs": 7800,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0045",
    "timeMs": 8100,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0046",
    "timeMs": 8400,
    "pad": "SNARE",
    "velocityHint": 100
  },
  {
    "noteId": "n0047",
    "timeMs": 8550,
    "pad": "SNARE",
    "velocityHint": 90
  },
  {
    "noteId": "n0048",
    "timeMs": 8700,
    "pad": "HI_TOM",
    "velocityHint": 100
  },
  {
    "noteId": "n0049",
    "timeMs": 8850,
    "pad": "HI_TOM",
    "velocityHint": 90
  },
  {
    "noteId": "n0050",
    "timeMs": 9000,
    "pad": "FLOOR_TOM",
    "velocityHint": 105
  },
  {
    "noteId": "n0051",
    "timeMs": 9150,
    "pad": "FLOOR_TOM",
    "velocityHint": 95
  },
  {
    "noteId": "n0052",
    "timeMs": 9300,
    "pad": "FLOOR_TOM",
    "velocityHint": 110
  },
  {
    "noteId": "n0053",
    "timeMs": 9600,
    "pad": "CRASH",
    "velocityHint": 115
  },
  {
    "noteId": "n0054",
    "timeMs": 9600,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0055",
    "timeMs": 9900,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0056",
    "timeMs": 10200,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0057",
    "timeMs": 10200,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0058",
    "timeMs": 10500,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0059",
    "timeMs": 10800,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0060",
    "timeMs": 10800,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0061",
    "timeMs": 11100,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0062",
    "timeMs": 11100,
    "pad": "KICK",
    "velocityHint": 95
  },
  {
    "noteId": "n0063",
    "timeMs": 11400,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0064",
    "timeMs": 11400,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0065",
    "timeMs": 11700,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0066",
    "timeMs": 12000,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0067",
    "timeMs": 12000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0068",
    "timeMs": 12300,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0069",
    "timeMs": 12600,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0070",
    "timeMs": 12600,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0071",
    "timeMs": 12900,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0072",
    "timeMs": 13200,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0073",
    "timeMs": 13200,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0074",
    "timeMs": 13500,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0075",
    "timeMs": 13500,
    "pad": "KICK",
    "velocityHint": 95
  },
  {
    "noteId": "n0076",
    "timeMs": 13800,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0077",
    "timeMs": 13800,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0078",
    "timeMs": 14100,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0079",
    "timeMs": 14400,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0080",
    "timeMs": 14400,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0081",
    "timeMs": 14700,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0082",
    "timeMs": 15000,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0083",
    "timeMs": 15000,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0084",
    "timeMs": 15300,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0085",
    "timeMs": 15600,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0086",
    "timeMs": 15600,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0087",
    "timeMs": 15900,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0088",
    "timeMs": 15900,
    "pad": "KICK",
    "velocityHint": 95
  },
  {
    "noteId": "n0089",
    "timeMs": 16200,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0090",
    "timeMs": 16200,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0091",
    "timeMs": 16500,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0092",
    "timeMs": 16800,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0093",
    "timeMs": 16800,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0094",
    "timeMs": 17100,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0095",
    "timeMs": 17400,
    "pad": "HIHAT",
    "velocityHint": 100
  },
  {
    "noteId": "n0096",
    "timeMs": 17400,
    "pad": "SNARE",
    "velocityHint": 110
  },
  {
    "noteId": "n0097",
    "timeMs": 17700,
    "pad": "HIHAT",
    "velocityHint": 75
  },
  {
    "noteId": "n0098",
    "timeMs": 18000,
    "pad": "SNARE",
    "velocityHint": 100
  },
  {
    "noteId": "n0099",
    "timeMs": 18150,
    "pad": "SNARE",
    "velocityHint": 90
  },
  {
    "noteId": "n0100",
    "timeMs": 18300,
    "pad": "HI_TOM",
    "velocityHint": 100
  },
  {
    "noteId": "n0101",
    "timeMs": 18450,
    "pad": "HI_TOM",
    "velocityHint": 90
  },
  {
    "noteId": "n0102",
    "timeMs": 18600,
    "pad": "FLOOR_TOM",
    "velocityHint": 105
  },
  {
    "noteId": "n0103",
    "timeMs": 18750,
    "pad": "FLOOR_TOM",
    "velocityHint": 95
  },
  {
    "noteId": "n0104",
    "timeMs": 18900,
    "pad": "FLOOR_TOM",
    "velocityHint": 110
  }
]'::jsonb, '{"bpm":100,"offsetMs":0,"timeSignature":"4/4"}'::jsonb, 'UNAVAILABLE', 104, 'BUILTIN', 'FE-d4080d1', NULL
FROM inserted_chart;

WITH inserted_song AS (
  INSERT INTO songs (title, artist, source, status, bpm, offset_ms, time_signature, duration_ms, license, accompaniment_key)
  VALUES ('라이드 16비트', NULL, 'BUILTIN', 'READY', 120, 0, '4/4', 16000, '프로젝트 FE 데모 연습 패턴; 원본 FE/src/domain/chart.ts@d4080d1; 별도 라이선스 표기 없음; 음원 미포함', NULL)
  RETURNING id
), inserted_chart AS (
  INSERT INTO charts (song_id, difficulty)
  SELECT id, 'HARD' FROM inserted_song
  RETURNING id
)
INSERT INTO chart_versions (chart_id, version, schema_version, notes, timing, notation_status, note_count, generator, generator_version, sheet_pages)
SELECT id, 1, 1, '[
  {
    "noteId": "n0001",
    "timeMs": 0,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0002",
    "timeMs": 0,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0003",
    "timeMs": 250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0004",
    "timeMs": 500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0005",
    "timeMs": 500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0006",
    "timeMs": 750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0007",
    "timeMs": 750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0008",
    "timeMs": 875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0009",
    "timeMs": 1000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0010",
    "timeMs": 1000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0011",
    "timeMs": 1250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0012",
    "timeMs": 1500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0013",
    "timeMs": 1500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0014",
    "timeMs": 1750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0015",
    "timeMs": 1750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0016",
    "timeMs": 1875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0017",
    "timeMs": 2000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0018",
    "timeMs": 2000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0019",
    "timeMs": 2250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0020",
    "timeMs": 2500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0021",
    "timeMs": 2500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0022",
    "timeMs": 2750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0023",
    "timeMs": 2750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0024",
    "timeMs": 2875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0025",
    "timeMs": 3000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0026",
    "timeMs": 3000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0027",
    "timeMs": 3250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0028",
    "timeMs": 3500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0029",
    "timeMs": 3500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0030",
    "timeMs": 3625,
    "pad": "HI_TOM",
    "velocityHint": 95
  },
  {
    "noteId": "n0031",
    "timeMs": 3750,
    "pad": "FLOOR_TOM",
    "velocityHint": 100
  },
  {
    "noteId": "n0032",
    "timeMs": 3875,
    "pad": "CRASH",
    "velocityHint": 110
  },
  {
    "noteId": "n0033",
    "timeMs": 4000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0034",
    "timeMs": 4000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0035",
    "timeMs": 4250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0036",
    "timeMs": 4500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0037",
    "timeMs": 4500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0038",
    "timeMs": 4750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0039",
    "timeMs": 4750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0040",
    "timeMs": 4875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0041",
    "timeMs": 5000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0042",
    "timeMs": 5000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0043",
    "timeMs": 5250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0044",
    "timeMs": 5500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0045",
    "timeMs": 5500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0046",
    "timeMs": 5750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0047",
    "timeMs": 5750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0048",
    "timeMs": 5875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0049",
    "timeMs": 6000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0050",
    "timeMs": 6000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0051",
    "timeMs": 6250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0052",
    "timeMs": 6500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0053",
    "timeMs": 6500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0054",
    "timeMs": 6750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0055",
    "timeMs": 6750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0056",
    "timeMs": 6875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0057",
    "timeMs": 7000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0058",
    "timeMs": 7000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0059",
    "timeMs": 7250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0060",
    "timeMs": 7500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0061",
    "timeMs": 7500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0062",
    "timeMs": 7625,
    "pad": "HI_TOM",
    "velocityHint": 95
  },
  {
    "noteId": "n0063",
    "timeMs": 7750,
    "pad": "FLOOR_TOM",
    "velocityHint": 100
  },
  {
    "noteId": "n0064",
    "timeMs": 7875,
    "pad": "CRASH",
    "velocityHint": 110
  },
  {
    "noteId": "n0065",
    "timeMs": 8000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0066",
    "timeMs": 8000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0067",
    "timeMs": 8250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0068",
    "timeMs": 8500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0069",
    "timeMs": 8500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0070",
    "timeMs": 8750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0071",
    "timeMs": 8750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0072",
    "timeMs": 8875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0073",
    "timeMs": 9000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0074",
    "timeMs": 9000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0075",
    "timeMs": 9250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0076",
    "timeMs": 9500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0077",
    "timeMs": 9500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0078",
    "timeMs": 9750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0079",
    "timeMs": 9750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0080",
    "timeMs": 9875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0081",
    "timeMs": 10000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0082",
    "timeMs": 10000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0083",
    "timeMs": 10250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0084",
    "timeMs": 10500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0085",
    "timeMs": 10500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0086",
    "timeMs": 10750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0087",
    "timeMs": 10750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0088",
    "timeMs": 10875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0089",
    "timeMs": 11000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0090",
    "timeMs": 11000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0091",
    "timeMs": 11250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0092",
    "timeMs": 11500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0093",
    "timeMs": 11500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0094",
    "timeMs": 11625,
    "pad": "HI_TOM",
    "velocityHint": 95
  },
  {
    "noteId": "n0095",
    "timeMs": 11750,
    "pad": "FLOOR_TOM",
    "velocityHint": 100
  },
  {
    "noteId": "n0096",
    "timeMs": 11875,
    "pad": "CRASH",
    "velocityHint": 110
  },
  {
    "noteId": "n0097",
    "timeMs": 12000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0098",
    "timeMs": 12000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0099",
    "timeMs": 12250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0100",
    "timeMs": 12500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0101",
    "timeMs": 12500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0102",
    "timeMs": 12750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0103",
    "timeMs": 12750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0104",
    "timeMs": 12875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0105",
    "timeMs": 13000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0106",
    "timeMs": 13000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0107",
    "timeMs": 13250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0108",
    "timeMs": 13500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0109",
    "timeMs": 13500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0110",
    "timeMs": 13750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0111",
    "timeMs": 13750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0112",
    "timeMs": 13875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0113",
    "timeMs": 14000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0114",
    "timeMs": 14000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0115",
    "timeMs": 14250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0116",
    "timeMs": 14500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0117",
    "timeMs": 14500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0118",
    "timeMs": 14750,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0119",
    "timeMs": 14750,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0120",
    "timeMs": 14875,
    "pad": "SNARE",
    "velocityHint": 45
  },
  {
    "noteId": "n0121",
    "timeMs": 15000,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0122",
    "timeMs": 15000,
    "pad": "KICK",
    "velocityHint": 110
  },
  {
    "noteId": "n0123",
    "timeMs": 15250,
    "pad": "RIDE",
    "velocityHint": 80
  },
  {
    "noteId": "n0124",
    "timeMs": 15500,
    "pad": "RIDE",
    "velocityHint": 100
  },
  {
    "noteId": "n0125",
    "timeMs": 15500,
    "pad": "SNARE",
    "velocityHint": 115
  },
  {
    "noteId": "n0126",
    "timeMs": 15625,
    "pad": "HI_TOM",
    "velocityHint": 95
  },
  {
    "noteId": "n0127",
    "timeMs": 15750,
    "pad": "FLOOR_TOM",
    "velocityHint": 100
  },
  {
    "noteId": "n0128",
    "timeMs": 15875,
    "pad": "CRASH",
    "velocityHint": 110
  }
]'::jsonb, '{"bpm":120,"offsetMs":0,"timeSignature":"4/4"}'::jsonb, 'UNAVAILABLE', 128, 'BUILTIN', 'FE-d4080d1', NULL
FROM inserted_chart;

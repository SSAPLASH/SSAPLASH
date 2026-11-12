"""서비스 추론 모듈 (설계 `.claude/plans/CHART-003-CHART-004-inference-modules.md` 2장).

원곡 파일을 받아 드럼 트랙·반주 파일(음원 분리, S15P31A307-167)과 채보 JSON(드럼 채보, S15P31A307-169)을
만드는 모듈. 모델은 벤치마크 어댑터(`ssaplash_ai.bench.separators`·`bench.transcribers`)를 그대로 import해
쓰고 다시 구현하지 않음. 입출력은 파일 경로 + 결과 메타(dataclass), numpy 배열은 모듈 안에서만.
MusicXML 드럼 악보 → 채보 JSON 변환(S15P31A307-292)과 분리 전 음악 여부 검사도 여기 있음.

- config: `configs/chart/*.yaml` 읽기와 환경 변수(`SSAPLASH_` 접두사) 덮어쓰기
- audio_io: 원곡 읽기(mp3·wav·flac·opus·m4a → 44.1kHz 스테레오 float32), 트랙 쓰기(flac 16비트·wav)
- errors: 예외 분류(입력·모델·출력). 워커가 실패 보고의 code·retryable·reason으로 바꿈
- music_check: MusicCheckModule. 원곡 파일 → 음악 확률·말소리 확률, 분리 전 음악 여부 검사
- separation: SeparationModule. 원곡 파일 → 드럼 트랙·반주 파일 + SeparationOutput
- transcription: TranscriptionModule. 드럼 트랙 파일 → chart.json + TranscriptionOutput
- chart_json: 타격 표 → 채보 JSON, BE 검사와 같은 검증
- tempo: 박 시각에서 bpm 추정(입력은 원곡, 없으면 드럼 트랙. 서비스 Beat This!, mock librosa)
- tempo_refine: 채보 노트로 bpm·offsetMs 다시 맞추기
- sheet: MusicXML 드럼 악보 → 채보 JSON
- cli: `ssaplash-chart separate / transcribe / run / sheet / music-check` 명령

의존 방향: cli → separation·transcription·music_check·sheet → bench. transcription·sheet → chart_json·tempo.
chart_json → tempo_refine.
bench는 chart를 모름. 워커·서버가 chart를 부름.
"""

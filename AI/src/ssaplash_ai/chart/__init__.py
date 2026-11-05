"""서비스 추론 모듈 (설계 `.claude/plans/CHART-003-CHART-004-inference-modules.md` 2장).

원곡 파일을 받아 드럼 트랙·반주 파일(음원 분리, S15P31A307-167)과 채보 JSON(드럼 채보, S15P31A307-169)을
만드는 모듈. 모델은 벤치마크 어댑터(`ssaplash_ai.bench.separators`·`bench.transcribers`)를 그대로 import해
쓰고 다시 구현하지 않음. 입출력은 파일 경로 + 결과 메타(dataclass), numpy 배열은 모듈 안에서만.

- config: `configs/chart/*.yaml` 읽기와 환경 변수(`SSAPLASH_` 접두사) 덮어쓰기
- audio_io: 원곡 읽기(mp3·wav·flac·opus·m4a → 44.1kHz 스테레오 float32), 트랙 쓰기(flac 16비트·wav)
- errors: 예외 분류(입력·모델·출력). 워커가 실패 보고의 code·retryable로 바꿈
- separation: SeparationModule. 원곡 파일 → 드럼 트랙·반주 파일 + SeparationOutput
- transcription: TranscriptionModule. 드럼 트랙 파일 → chart.json + TranscriptionOutput
- chart_json: 타격 표 → 채보 JSON, BE 검사와 같은 검증
- tempo: 드럼 트랙에서 bpm 추정(서비스 Beat This!, mock librosa)
- cli: `ssaplash-chart separate / transcribe / run` 명령

의존 방향: cli → separation·transcription → bench. transcription → chart_json·tempo.
bench는 chart를 모름. 워커·서버가 chart를 부름.
"""

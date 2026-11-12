"""채보 워커 (설계 `.claude/plans/CHART-003-chart-worker.md`, S15P31A307-171).

BE 워커 API(`/internal/v1/chart-jobs`, S15P31A307-160)에서 채보 작업을 받아 음악 여부 검사(`chart.music_check`),
음원 분리(`chart.separation`), 드럼 채보(`chart.transcription`)를 돌리고 결과를 BE에 돌려주는 상시 프로세스.
작업 하나를 검사 → 분리 → 채보까지 한 워커가 끝까지 처리함.

- config: 환경 변수 `SSAPLASH_WORKER_*`·`SSAPLASH_WORK_DIR`·`SSAPLASH_NARRATIVE_*`·`SSAPLASH_LIVE_*` → WorkerSettings
- payload: BE와 같은 정규 JSON 직렬화와 payloadHash(SHA-256)
- api: BE API 6개 호출부(claim·heartbeat·file-access·결과 제출 2개·실패 보고)와 503 재시도
- transfer: 서명 URL로 파일 내려받기(크기·sha256 검사)·올리기
- heartbeat: 10초 heartbeat 스레드와 eventSeq 번호
- job: 배정 하나를 끝까지 처리하는 실행기. 모듈 출력 → 결과 본문, 예외 → 실패 보고
- loop: 모델 올리기 → claim 폴링 → 작업 처리 반복, 종료 신호
- narrative_job: LLM 총평 작업 호출부·실행기
- live_coach_job: 연주 중 LLM 구간 코칭 호출부·실행기·전용 루프
- cli: `ssaplash-worker run / check / live-run / fake-be`
- fake_be: 테스트·로컬 확인용 BE 대역(6개 API + 저장소 GET/PUT)

의존 방향: cli → loop → job → api·transfer·heartbeat·payload·chart. chart·bench는 worker를 모름.
"""

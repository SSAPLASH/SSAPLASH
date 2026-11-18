"""채보 워커. BE 워커 API(`/internal/v1/chart-jobs`)에서 작업을 받아 처리하고 결과를 돌려주는 상시 프로세스.

작업 하나를 음악 여부 검사 → 음원 분리 → 드럼 채보까지 한 워커가 끝까지 처리함.
의존 방향: cli → loop → job → api·transfer·heartbeat·payload·chart. chart·bench는 worker를 모름.
"""

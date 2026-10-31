"""약점 분석 실측 보정 배치. 동의한 사용자의 비식별 연주 기록으로 임계값 후보를 만들어 MLflow에 기록한다.

임계값을 자동으로 바꾸지 않는다. 기록은 `approval=pending`으로 남고, 사람이 검토·승인한 뒤 `config.py`를 고치는 MR로 적용한다.
설계는 `.claude/plans/COACH-003-실측보정-설계.md`에 있고, 서버(`ssaplash_ai.server`)는 이 패키지를 가져다 쓰지 않는다.
"""

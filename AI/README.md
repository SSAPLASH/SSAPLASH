# AI 파트

싸플래쉬(SSAPLASH)의 AI·데이터 영역. 채보 생성(MIDI 규칙 변환, 음원 드럼 분리, 드럼 트랜스크립션), 실시간·리포트 코칭, 악보 자동 넘기기를 맡는다. 현재는 **드럼 분리 모델 벤치마크 하네스**를 만드는 단계다.

## 스택

| 항목 | 선택 | 비고 |
| --- | --- | --- |
| Python | 3.11 | 시스템 파이썬(3.13)과 분리된 가상환경. 분리·채보 모델 패키지 호환 때문 |
| 환경·의존성 | [uv](https://docs.astral.sh/uv/) | `uv.lock`으로 버전 고정 |
| 코드 검사 | ruff | lint + format |
| 테스트 | pytest | |
| 실험 기록 | MLflow (로컬 파일 모드) | 팀 MLflow 서버(S15P31A307-45)가 생기면 그쪽으로 옮긴다 |
| 모델 실행 | PyTorch + ZFTurbo MSST (예정) | 벤치마크 하네스 작업에서 추가 |

이 스택은 2026-10-19 기준 잠정 확정이다. 팀 전체 기술 스택이 확정되면 바뀔 수 있다.

## 폴더 구조

```
AI/
├─ pyproject.toml        패키지·의존성·ruff·pytest 설정
├─ uv.lock               의존성 잠금
├─ .python-version       3.11
├─ src/ssaplash_ai/      패키지 본체
│   ├─ bench/            벤치마크 하네스 (예정)
│   └─ chart/            채보 형식·패드 매핑 (예정)
├─ tests/                pytest
├─ configs/              모델·데이터셋 설정 yaml (예정)
├─ notebooks/            코랩 실행용 노트북 (예정)
├─ data/                 데이터셋·모델 가중치·결과 (git 미추적)
└─ DESIGN.md             작업 기록·세션 인계 문서 (git 미추적, 개인 문서)
```

## 환경 구축

uv가 없으면 먼저 설치한다 (Windows PowerShell).

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

저장소 루트가 아니라 `AI/` 폴더에서 실행한다.

```bash
cd AI
uv sync          # .venv 생성 + 의존성 설치 (Python 3.11은 uv가 받아 준다)
```

## 실행·검증 명령

```bash
cd AI
uv run ruff check .      # lint
uv run ruff format .     # 포맷 (커밋 전)
uv run pytest            # 테스트
```

커밋 전에 `ruff check`와 `pytest`가 모두 통과해야 한다 (CLAUDE.md 규칙). GitLab CI의 AI lint·test 단계도 같은 명령을 쓴다.

## 데이터

`AI/data/`는 git이 추적하지 않는다. 공개 데이터셋(MUSDB18-HQ, StemGMD 등)과 모델 가중치, 벤치마크 결과가 들어간다. 받는 방법과 라이선스는 각 데이터셋 로더 설명과 벤치마크 문서를 따른다.

## 관련 문서

- 공통 명세서: `Docs/Service Design/공통 명세서.md` (11장 AI 활용 계획, 15장 기술 검증 포인트)
- Jira: 에픽 `[CHART] 채보` (S15P31A307-29), 스토리 CHART-003 (S15P31A307-62) · CHART-004 (S15P31A307-69)

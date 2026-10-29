"""평가 실행: 시나리오 × 강도 × 시드를 돌려 시험 결과를 모은다.

시험 한 번의 노트 수와 판정 폭은 시드 번호로 정해서(섞어서) 한 칸 안에서 여러 조건이 골고루 나온다.
같은 설정이면 결과가 같다(난수는 모두 시드에서 나온다).
"""

from __future__ import annotations

import dataclasses
import json
import time
from dataclasses import dataclass

from ssaplash_ai.coach import AnalysisRequest, analyze
from ssaplash_ai.coach.config import DEFAULT_THRESHOLDS, Thresholds
from ssaplash_ai.coach_eval.chart import make_chart
from ssaplash_ai.coach_eval.metrics import Trial, evaluate
from ssaplash_ai.coach_eval.player import PlayerModel, simulate
from ssaplash_ai.coach_eval.scenarios import SCENARIOS, Scenario


@dataclass(frozen=True)
class RunConfig:
    seeds: int = 100  # 시나리오·강도마다 시험 횟수
    note_counts: tuple[int, ...] = (60, 200, 600)
    good_ms_values: tuple[float, ...] = (30.0, 50.0, 60.0, 100.0, 150.0)
    base_seed: int = 0


@dataclass(frozen=True)
class RunResult:
    config: RunConfig
    trials: list[Trial]
    elapsed_sec: float


DEFAULT_CONFIG = RunConfig()


def trial_seed(config: RunConfig, scenario_index: int, strength_index: int, k: int) -> int:
    """시나리오·강도·반복 번호마다 서로 다른 시드를 만든다."""
    return config.base_seed * 1_000_003 + scenario_index * 10_007 + strength_index * 101 + k


def run_trial(
    scenario: Scenario,
    strength: float,
    config: RunConfig,
    seed: int,
    k: int,
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> Trial:
    n_notes = config.note_counts[k % len(config.note_counts)]
    good_ms = config.good_ms_values[k % len(config.good_ms_values)]
    chart = make_chart(n_notes, scenario.layout, seed=seed)
    play = simulate(chart, scenario.build(strength, chart), good_ms=good_ms, seed=seed)
    response = analyze(AnalysisRequest.model_validate(play.request), thresholds)
    trial = evaluate(response, scenario, strength, scenario.truth(strength, chart))
    return dataclasses.replace(trial, good_ms=good_ms, n_notes=n_notes)


def run_all(
    config: RunConfig = DEFAULT_CONFIG,
    scenarios: tuple[Scenario, ...] = SCENARIOS,
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> RunResult:
    started = time.perf_counter()
    trials: list[Trial] = []
    for si, scenario in enumerate(scenarios):
        for ti, strength in enumerate(scenario.strengths):
            for k in range(config.seeds):
                seed = trial_seed(config, si, ti, k)
                trials.append(run_trial(scenario, strength, config, seed, k, thresholds))
    return RunResult(config, trials, time.perf_counter() - started)


def measure_performance(sizes: tuple[int, ...] = (5_000, 48_000), repeats: int = 3) -> list[dict]:
    """큰 로그의 처리 시간(초). 검증(`model_validate`)과 분석(`analyze`)을 나눠 재고 반복 중 최솟값을 쓴다.

    BE 응답 제한은 3초이고 목표는 5,000건 1초, 50,000건 3초다. 로그 상한이 5만 건이라
    큰 쪽은 4.8만 건 안팎으로 만든다.
    """
    rows = []
    for n in sizes:
        chart = make_chart(n, "random", seed=1)
        play = simulate(chart, PlayerModel(p_stray=0.01), good_ms=50.0, seed=1)
        validate_s, analyze_s = [], []
        for _ in range(repeats):
            t0 = time.perf_counter()
            request = AnalysisRequest.model_validate(play.request)
            t1 = time.perf_counter()
            analyze(request)
            t2 = time.perf_counter()
            validate_s.append(t1 - t0)
            analyze_s.append(t2 - t1)
        rows.append(
            {
                "hits": len(play.request["hits"]),
                "validateSec": round(min(validate_s), 3),
                "analyzeSec": round(min(analyze_s), 3),
            }
        )
    return rows


def server_smoke(play_requests: list[dict]) -> list[dict]:
    """서버 처리 함수(`process_body`)를 거친 결과가 `analyze()` 직접 호출과 같은지 확인한다.

    HTTP 라우팅과 바깥 연결은 제외한다(윈도우에서 `TestClient`가 간헐 실패해 함수 단위로 확인).
    """
    from ssaplash_ai.server.weak_segments import process_body

    rows = []
    for request in play_requests:
        direct = analyze(AnalysisRequest.model_validate(request)).model_dump()
        reply = process_body(json.dumps(request).encode("utf-8"))
        rows.append(
            {
                "playId": request["playId"],
                "status": reply.status_code,
                "same": reply.status_code == 200 and json.loads(reply.body) == direct,
            }
        )
    return rows

"""R3 운영 배치: 입력 읽기 → 검증 → 학습 → 사용자별 후보 생성 → 적재(설계 문서 부록 C.3·C.8).

```
uv run python scripts/run_recommend_batch.py --synthetic --stage P0
uv run python scripts/run_recommend_batch.py --from-views --stage P2 --p2-approval <근거> --upload
```

- 기본은 **적재하지 않는다**(`--upload`를 줘야 보낸다). 합성 입력은 적재할 수 없다.
- 입력이 스키마에서 벗어나면 `DataError`로 멈추고 아무것도 보내지 않는다.
- 후보는 LightGCN의 순위 그대로다. PoC의 M6 재정렬(하드 제외, 규칙 점수 혼합)은 사용자의 현재 상태로 BE가 서빙 때 한다.
- `modelVersion`은 변형과 하이퍼파라미터로만 정한다. 데이터가 바뀌어도 같아서 BE 허용 목록을 배치마다 고치지 않는다.
- 사용자 벡터와 사용자 키는 저장·출력하지 않는다. 출력과 MLflow에는 집계 값만 남긴다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

from ssaplash_ai.recommend import schema as S
from ssaplash_ai.recommend.candidates_client import (
    MAX_SONGS_PER_USER,
    CandidateBatch,
    CandidatesClient,
    UploadResult,
    UserCandidates,
)
from ssaplash_ai.recommend.data import DataError, Dataset, dataset_from_frames
from ssaplash_ai.recommend.graph import FEATURES_CHART, FEATURES_CHART_META, FEATURES_NONE
from ssaplash_ai.recommend.models import LightGCN
from ssaplash_ai.recommend.simulate import SimConfig
from ssaplash_ai.recommend.source import (
    ExportSource,
    PostgresExportSource,
    SyntheticSource,
    require_views,
)

# 배치 설정의 변형 이름 → 그래프 특징. U25: 어떤 변형을 쓸지는 실데이터 보고서로 정한다
VARIANTS = {"base": FEATURES_NONE, "feat": FEATURES_CHART, "feat_meta": FEATURES_CHART_META}


@dataclass(frozen=True)
class BatchConfig:
    variant: str = "base"
    candidates_per_user: int = MAX_SONGS_PER_USER
    seed: int = 0

    def __post_init__(self) -> None:
        if self.variant not in VARIANTS:
            raise ValueError(f"variant는 {sorted(VARIANTS)} 중 하나여야 합니다: {self.variant!r}")
        if not 1 <= self.candidates_per_user <= MAX_SONGS_PER_USER:
            raise ValueError(f"사용자당 후보 수는 1~{MAX_SONGS_PER_USER}개여야 합니다.")


@dataclass(frozen=True)
class BatchStats:
    """집계 값만 담는다."""

    users: int
    users_with_candidates: int
    users_without_history: int
    candidate_pairs: int
    songs_covered: int


def build_model(cfg: BatchConfig) -> LightGCN:
    return LightGCN(VARIANTS[cfg.variant], seed=cfg.seed)


def model_version(cfg: BatchConfig, model: LightGCN) -> str:
    """`r3-{변형}-{하이퍼파라미터 해시 8자}`."""
    text = json.dumps(model.params(), sort_keys=True, default=str)
    return f"r3-{cfg.variant}-{hashlib.sha256(text.encode('utf-8')).hexdigest()[:8]}"


def generate_candidates(
    data: Dataset, cfg: BatchConfig, *, generated_at: datetime | None = None
) -> tuple[CandidateBatch, BatchStats]:
    """전체 연주로 학습해 사용자별 후보를 만든다. 이미 친 곡은 후보에서 뺀다(PoC 평가와 같은 조건).

    연주가 없는 사용자는 개인화할 근거가 없어 후보를 만들지 않는다. BE가 R1로 응답한다.
    """
    if data.interactions.empty:
        raise DataError("연주가 없어 학습할 수 없습니다.")
    if VARIANTS[cfg.variant] == FEATURES_CHART_META and data.song_meta.empty:
        raise DataError("메타데이터가 없어 feat_meta 변형을 쓸 수 없습니다.")

    model = build_model(cfg)
    model.fit(data.interactions, data)
    users: list[UserCandidates] = []
    covered: set[int] = set()
    without_history = 0
    for key in sorted(str(u) for u in data.users["user_key"]):
        if key not in model.histories:
            without_history += 1
            continue
        songs = model.rank(key, cfg.candidates_per_user, exclude=model.seen_songs(key))
        if songs:
            users.append(UserCandidates(key, tuple(songs)))
            covered.update(songs)

    stamp = (generated_at or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    batch = CandidateBatch(
        f"{stamp}-{data.data_hash[:8]}", model_version(cfg, model), stamp, tuple(users)
    )
    stats = BatchStats(
        users=len(data.users),
        users_with_candidates=len(users),
        users_without_history=without_history,
        candidate_pairs=sum(len(u.song_ids) for u in users),
        songs_covered=len(covered),
    )
    return batch, stats


def load_input(source: ExportSource, stage: str, *, p2_approval: str | None = None) -> Dataset:
    frames = source.frames()
    require_views(frames)
    return dataset_from_frames(frames, stage, p2_approval=p2_approval)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="곡 추천 R3 후보 배치")
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--from-views", action="store_true", help="BE 읽기 뷰에서 읽는다")
    source.add_argument("--synthetic", action="store_true", help="합성 입력을 쓴다(P0)")
    p.add_argument("--stage", required=True, choices=S.STAGES, help="데이터 출처 단계")
    p.add_argument("--p2-approval", help="P2 사용 승인 근거(동의 범위 결정 문서·번호)")
    p.add_argument("--variant", default="base", choices=sorted(VARIANTS))
    p.add_argument("--candidates", type=int, default=MAX_SONGS_PER_USER, help="사용자당 후보 수")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--upload", action="store_true", help="BE에 적재한다(없으면 만들기만 한다)")
    p.add_argument("--synthetic-users", type=int, default=500)
    p.add_argument("--synthetic-songs", type=int, default=120)
    p.add_argument("--mlflow", action="store_true", help="MLflow에 기록(집계 값만)")
    p.add_argument("--tracking-uri")
    p.add_argument("--experiment", default="song-recommend")
    return p


def _source(args: argparse.Namespace) -> ExportSource:
    if args.synthetic:
        if args.stage != S.STAGE_SYNTHETIC:
            raise DataError("합성 입력은 출처 단계 P0로만 쓸 수 있습니다.")
        if args.upload:
            raise DataError("합성 입력은 적재할 수 없습니다.")
        return SyntheticSource(
            SimConfig(seed=args.seed, n_users=args.synthetic_users, n_songs=args.synthetic_songs)
        )
    if args.stage == S.STAGE_SYNTHETIC:
        raise DataError("뷰에서 읽은 입력은 출처 단계 P0로 쓸 수 없습니다.")
    return PostgresExportSource()


def main(
    argv: list[str] | None = None,
    *,
    source: ExportSource | None = None,
    client: CandidatesClient | None = None,
) -> int:
    args = build_parser().parse_args(argv)
    try:
        cfg = BatchConfig(args.variant, args.candidates, args.seed)
        data = load_input(source or _source(args), args.stage, p2_approval=args.p2_approval)
        batch, stats = generate_candidates(data, cfg)
    except (DataError, ValueError, RuntimeError) as ex:
        print(f"배치 중단(적재 안 함): {ex}", file=sys.stderr)
        return 2
    except Exception as ex:  # DB 오류 메시지에 접속 정보가 섞일 수 있어 종류만 남긴다
        print(f"배치 중단(적재 안 함): {type(ex).__name__}", file=sys.stderr)
        return 2

    print(f"단계 {args.stage} · 데이터 {data.data_hash[:12]} · {batch.model_version}")
    print(f"배치 {batch.batch_id} · {asdict(stats)}")

    result: UploadResult | None = None
    if args.upload:
        try:
            result = (client or CandidatesClient.from_env()).upload(batch)
        except (RuntimeError, ValueError) as ex:
            print(f"적재 준비 실패: {ex}", file=sys.stderr)
            return 3
        print(f"적재 {asdict(result)}")
    else:
        print("적재하지 않음(--upload 없음)")

    if args.mlflow:
        from ssaplash_ai.recommend.mlflow_log import log_batch

        log_batch(
            batch.batch_id,
            batch.model_version,
            data,
            asdict(stats),
            asdict(result) if result else None,
            tracking_uri=args.tracking_uri,
            experiment=args.experiment,
        )
    if result is not None and not result.complete:
        print(f"일부만 적재됨: {result.error}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

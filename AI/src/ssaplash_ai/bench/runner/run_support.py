"""분리·채보 러너가 같이 쓰는 조각.

- runId·host·장치 판정·오류 요약
- CsvWriter: 행을 받을 때마다 바로 쓰는 CSV. 열 목록을 받아 어떤 결과 CSV에도 씀
- 이어하기: 기존 CSV에서 error가 빈 행은 유지, error가 있던 행은 다시 돌림. 키 열은 러너가 정함
분리 러너(benchmark_runner)는 여기 함수를 그대로 가져다 쓰며 동작·열·테스트는 바뀌지 않음.
"""

from __future__ import annotations

import csv
import datetime as dt
import importlib.util
import os
import secrets
from collections.abc import Callable, Sequence
from pathlib import Path

from ssaplash_ai.bench.metrics.resource_usage import cuda_available

ERROR_MAX_LEN = 300

Logger = Callable[[str], None]


def new_run_id(now: dt.datetime | None = None) -> str:
    now = now or dt.datetime.now()
    return f"{now:%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"


def detect_host() -> str:
    """코랩이면 colab, 아니면 local."""
    if os.environ.get("COLAB_RELEASE_TAG") or importlib.util.find_spec("google.colab") is not None:
        return "colab"
    return "local"


def resolve_device(requested: str, log: Logger) -> str:
    """cuda를 요청했는데 못 쓰면 cpu로 내리고 알림."""
    if requested.startswith("cuda") and not cuda_available(requested):
        log(f"경고: {requested}를 쓸 수 없어 cpu로 실행 (torch 미설치 또는 CUDA 없음)")
        return "cpu"
    return requested


def format_error(exc: BaseException) -> str:
    text = f"{type(exc).__name__}: {exc}".replace("\n", " ")
    return text[:ERROR_MAX_LEN]


class CsvWriter:
    """행을 받을 때마다 바로 파일에 쓰는 CSV. 중간에 죽어도 그때까지의 행이 남음.

    keep_rows를 주면 파일을 그 행들로 새로 쓰고(이어하기: 성공 행만 유지) 뒤에 이어 붙임.
    """

    def __init__(
        self, path: Path, columns: Sequence[str], keep_rows: Sequence[dict] | None = None
    ) -> None:
        self.path = path
        self.columns = tuple(columns)
        path.parent.mkdir(parents=True, exist_ok=True)
        if keep_rows is not None:
            self._file = open(path, "w", encoding="utf-8", newline="")
            self._writer = csv.DictWriter(self._file, fieldnames=self.columns)
            self._writer.writeheader()
            for row in keep_rows:
                self._writer.writerow({c: row.get(c, "") for c in self.columns})
            self._file.flush()
            return
        new_file = not path.exists() or path.stat().st_size == 0
        self._file = open(path, "a", encoding="utf-8", newline="")
        self._writer = csv.DictWriter(self._file, fieldnames=self.columns)
        if new_file:
            self._writer.writeheader()
            self._file.flush()

    def write(self, row: dict) -> None:
        self._writer.writerow({c: row.get(c, "") for c in self.columns})
        self._file.flush()

    def write_many(self, rows: Sequence[dict]) -> None:
        for row in rows:
            self._writer.writerow({c: row.get(c, "") for c in self.columns})
        self._file.flush()

    def close(self) -> None:
        self._file.close()


def row_key(row: dict, key_columns: Sequence[str]) -> tuple[str, ...]:
    """이어하기 판단 단위. 러너마다 키 열이 다름 (분리: dataset·model·songId)."""
    return tuple(str(row.get(c, "")) for c in key_columns)


def load_resume_rows(
    csv_path: Path, columns: Sequence[str], key_columns: Sequence[str]
) -> tuple[list[dict], int]:
    """기존 CSV에서 유지할 행(error 없음)과 다시 돌릴 행 수(error 있음)를 돌려줌.

    열 구성이 columns와 다르면 다른 버전의 결과라 ValueError.
    """
    with open(csv_path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None or list(reader.fieldnames) != list(columns):
            raise ValueError(
                f"이어하기 불가: {csv_path}의 열 구성이 현재 열 목록과 다름 (기존 {reader.fieldnames})"
            )
        rows = list(reader)
    kept: dict[tuple[str, ...], dict] = {}
    n_stale = 0
    for row in rows:
        if row.get("error"):
            n_stale += 1
            continue
        kept[row_key(row, key_columns)] = row  # 같은 키가 중복이면 마지막 행
    return list(kept.values()), n_stale


def read_csv_rows(csv_path: Path) -> list[dict]:
    with open(csv_path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))

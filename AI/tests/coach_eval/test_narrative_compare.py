"""LLM 총평 후보 모델 비교와 MLflow 기록. 가짜 생성기로 모델 서버 없이 본다."""

from __future__ import annotations

import json

import pytest

from ssaplash_ai.coach_eval import narrative_compare as nc

GOOD = (
    "전체적으로 기본기는 잘 잡혀 있어요. 스네어를 자주 놓쳤어요. "
    "7~12초 구간에서 노트 10개 중 4개를 놓쳤으니 그 부분만 느린 템포로 반복해 보세요."
)


def _good(system, user):
    return GOOD


def _bad(system, user):
    return "good job"


def test_비교용_사실은_네_가지이고_이전_기록_유무가_갈린다():
    cases = nc.build_cases()

    assert list(cases) == [
        "약점 있음(이전 기록 없음)",
        "약점 없음(이전 기록 없음)",
        "이전보다 좋아짐",
        "이전보다 나빠짐",
    ]
    assert cases["약점 있음(이전 기록 없음)"].history is None
    assert cases["이전보다 좋아짐"].history is not None


def test_통과율과_첫_시도_통과율과_위반을_센다():
    result = nc.run_model("m", nc.build_cases(), 2, _bad)

    assert result["total"] == 8 and result["passed"] == 0 and result["first_try"] == 0
    assert result["n_violations"] > 0 and result["violations"]
    assert all(not row["ok"] and row["text"] is None for row in result["rows"])


def test_사실에_맞는_문장은_통과한다():
    cases = {"약점 있음(이전 기록 없음)": nc.build_cases()["약점 있음(이전 기록 없음)"]}

    result = nc.run_model("m", cases, 3, _good)

    assert result["passed"] == 3 and result["first_try"] == 3
    assert [row["attempts"] for row in result["rows"]] == [1, 1, 1]


def test_표에는_모델과_통과율과_문장이_있다():
    cases = {"약점 있음(이전 기록 없음)": nc.build_cases()["약점 있음(이전 기록 없음)"]}
    text = nc.render([nc.run_model("m1", cases, 1, _good), nc.run_model("m2", cases, 1, _bad)])

    assert "| m1 | 1/1 | 1/1 |" in text and "| m2 | 0/1 | 0/1 |" in text
    assert GOOD in text and "## m2" in text


def test_모델_이름의_콜론은_지표_이름에서_밑줄로_바뀐다():
    assert nc.metric_key("qwen3:4b") == "qwen3_4b"
    assert nc.metric_key("exaone3.5:2.4b") == "exaone3.5_2.4b"


def test_프롬프트_해시는_고정된_12자리이다():
    assert len(nc.prompt_hash()) == 12 and nc.prompt_hash() == nc.prompt_hash()


def test_main은_표와_JSONL을_저장하고_MLflow에_모델마다_run을_남긴다(tmp_path, monkeypatch):
    mlflow = pytest.importorskip("mlflow")
    monkeypatch.setenv("MLFLOW_ALLOW_FILE_STORE", "true")
    out = tmp_path / "compare.md"
    uri = str(tmp_path / "mlruns")

    def factory(url, model, **kwargs):
        return _good if model == "good:1b" else _bad

    code = nc.main(
        [
            "--model",
            "good:1b",
            "--model",
            "bad:1b",
            "--repeats",
            "1",
            "--out",
            str(out),
            "--mlflow",
            "--tracking-uri",
            uri,
        ],
        generator_factory=factory,
    )

    assert code == 0 and out.stat().st_size > 0
    rows = [json.loads(line) for line in out.with_suffix(".jsonl").read_text("utf-8").splitlines()]
    assert len(rows) == 8 and {r["model"] for r in rows} == {"good:1b", "bad:1b"}

    mlflow.set_tracking_uri(uri)
    experiment = mlflow.get_experiment_by_name(nc.EXPERIMENT_NAME)
    runs = mlflow.search_runs([experiment.experiment_id])
    assert len(runs) == 2
    by_model = {row["params.model"]: row for _, row in runs.iterrows()}
    good = by_model["good:1b"]
    # "약점 없음" 사실에는 문장 속 7·12·10·4가 없어 거절되고 나머지 셋은 통과한다
    assert good["metrics.good_1b/passRate"] == pytest.approx(0.75)
    assert by_model["bad:1b"]["metrics.bad_1b/passRate"] == 0.0
    assert good["tags.promptHash"] == nc.prompt_hash()
    assert good["params.analyzerVersion"]


def test_MLflow_없이도_표만_저장한다(tmp_path):
    out = tmp_path / "x.md"

    code = nc.main(
        ["--model", "m", "--repeats", "1", "--out", str(out)],
        generator_factory=lambda url, model, **kw: _good,
    )

    assert code == 0 and "| m |" in out.read_text(encoding="utf-8")


def _down(system, user):
    raise ConnectionError("모델 서버 꺼짐")


def test_모델_서버에_닿지_못하면_표와_MLflow에_기록하지_않고_멈춘다(tmp_path, capsys):
    out = tmp_path / "x.md"
    uri = str(tmp_path / "mlruns")

    code = nc.main(
        ["--model", "m", "--repeats", "1", "--out", str(out), "--mlflow", "--tracking-uri", uri],
        generator_factory=lambda url, model, **kw: _down,
    )

    assert code == 2
    assert not out.exists() and not (tmp_path / "mlruns").exists()
    assert "한 건도 쓰지 못함" in capsys.readouterr().err


def test_일부_모델만_서버_오류면_그_모델만_알리고_멈춘다(tmp_path, capsys):
    out = tmp_path / "x.md"

    def factory(url, model, **kw):
        return _down if model == "dead:1b" else _good

    code = nc.main(
        ["--model", "ok:1b", "--model", "dead:1b", "--repeats", "1", "--out", str(out)],
        generator_factory=factory,
    )

    assert code == 2 and not out.exists()
    assert "dead:1b" in capsys.readouterr().err

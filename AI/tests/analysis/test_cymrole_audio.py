"""오디오 LLM 하이햇·라이드 마디 판정 시험 스크립트 테스트 (설계 CHART-003-audio-llm-cymbal)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cases = _load("cymrole_audio_cases")
ev = _load("cymrole_audio_eval")


def _truth(cid, lab, cur, split="val10", song="s1", bar=0, bp=None, bs=None):
    return {"case_id": cid, "song": song, "bar": bar, "split": split, "truth": lab, "current": cur,
            "bar_pad": bp, "bar_stem": bs}  # fmt: skip


def test_bar_truth_needs_enough_notes_and_majority():
    h = np.array([0.1, 0.2, 0.3, 0.4])
    assert cases.bar_truth(h, np.array([]), 0.0, 1.0) == "H"
    assert cases.bar_truth(h[:3], np.array([]), 0.0, 1.0) is None  # 3개뿐
    assert cases.bar_truth(h[:2], np.array([0.5, 0.6]), 0.0, 1.0) is None  # 반반
    assert cases.bar_truth(np.array([0.1]), np.array([0.2, 0.3, 0.4]), 0.0, 1.0) == "R"
    assert cases.bar_truth(h, np.array([]), 0.25, 1.0) is None  # 범위 안 2개


def test_chart_label():
    assert cases.chart_label([]) == "N"
    assert cases.chart_label(["HIHAT", "RIDE", "RIDE"]) == "R"
    assert cases.chart_label(["HIHAT", "RIDE"]) == "H"


def test_clip_length_matches_bar_and_peak():
    sr = 44100
    audio = np.sin(np.linspace(0, 2000, sr * 3)).astype(np.float32) * 0.1
    out = cases.clip(audio, sr, 0.5, 2.0)
    assert abs(len(out) - int(1.5 * cases.SR_OUT)) <= 2
    assert np.isclose(np.max(np.abs(out)), cases.PEAK, atol=1e-3)


def test_pick_pilot_prefers_wrong_bars_and_limits_per_song():
    rows = []
    for s in range(5):
        for b in range(6):
            rows.append(_truth(f"s{s}_{b}_r", "R", "H" if b < 2 else "R", song=f"s{s}", bar=b))
            rows.append(_truth(f"s{s}_{b}_h", "H", "H", song=f"s{s}", bar=b))
    rows.append(_truth("x_r", "R", "H", split="hold8", song="x"))  # 작은 시험에 안 들어가는 split
    picked = cases.pick_pilot(rows, n_per=10, per_song=3, seed=0)
    by = {r["case_id"]: r for r in rows}
    r_ids = [c for c in picked if by[c]["truth"] == "R"]
    assert len(r_ids) == 10 and "x_r" not in picked
    assert sum(by[c]["current"] != "R" for c in r_ids) == 10  # 틀린 마디 10개가 먼저
    for s in range(5):
        assert sum(by[c]["song"] == f"s{s}" for c in r_ids) <= 3


def test_case_rows_have_no_answer_fields(tmp_path):
    # 모델에 가는 질문 줄에는 정답·지금 채보·비교 기준이 없어야 함
    row = {
        "case_id": "a_000",
        "audio_mix": "clips/a_000_mix.wav",
        "audio_drums": "clips/a_000_drums.wav",
        "seconds": 2.0,
    }
    assert set(row) == set(cases.CASE_FIELDS)
    assert not {"truth", "current", "bar_pad", "bar_stem", "song", "split"} & set(cases.CASE_FIELDS)


def test_auc_matches_hand_count():
    score = np.array([0.9, 0.8, 0.3, 0.1, 0.8])
    pos = np.array([True, True, False, False, False])
    # 양성 2 × 음성 3 = 6쌍. 0.9가 셋 다 이김(3), 0.8은 0.3·0.1 이기고 0.8과 비김(2.5) → 5.5/6
    assert ev.auc(score, pos) == pytest.approx(5.5 / 6)


def test_metrics_fixed_broken():
    ts = [
        _truth("a", "R", "H"),
        _truth("b", "R", "R"),
        _truth("c", "H", "H"),
        _truth("d", "H", "R"),
    ]
    m = ev.metrics(["R", "H", "H", "N"], [1.0, -1.0, -1.0, 0.0], ts)
    assert m["acc"] == pytest.approx(0.5)
    assert m["bal_acc"] == pytest.approx(0.5)
    assert (
        m["n_current_wrong"] == 2 and m["fixed"] == 1 and m["broken"] == 1 and m["answered_N"] == 1
    )


def test_gate_needs_margin_over_baselines():
    rows = [
        {"name": "m_mix", "auc": 0.85}, {"name": "m_mix|current", "auc": 0.9},
        {"name": "m_mix|bar_pad", "auc": 0.82}, {"name": "m_mix|bar_stem", "auc": 0.6},
        {"name": "k_mix", "auc": 0.9}, {"name": "k_mix|current", "auc": 0.9},
        {"name": "k_mix|bar_pad", "auc": 0.82}, {"name": "k_mix|bar_stem", "auc": 0.6},
    ]  # fmt: skip
    assert ev.gate(rows) == ["k_mix"]


def test_sections_and_threshold(tmp_path):
    truth = {
        "a": _truth("a", "R", "H", song="s", bar=3),
        "b": _truth("b", "H", "H", song="s", bar=4),
        "c": _truth("c", "R", "H", split="hold8", song="t", bar=1),
    }
    ans = {
        "a": {"choice": "R", "p": {"H": 0.1, "R": 0.9, "N": 0.0}},
        "b": {"choice": "R", "p": {"H": 0.4, "R": 0.6, "N": 0.0}},
        "c": {"choice": "R", "p": {"H": 0.05, "R": 0.95, "N": 0.0}},
    }
    th = ev.pick_threshold(ans, truth)
    assert th == pytest.approx(
        0.9
    )  # 0.6 답(망침)은 빼고 0.9 답(고침)은 넣음, 같은 점수면 높은 기준
    secs = ev.to_sections(ans, truth, "hold8", th)
    assert secs == {
        "t": {"sections": [{"from_bar": 1, "to_bar": 1, "timekeeping": "R", "confidence": 0.95}]}
    }


def test_score_cli_writes_csv_and_gate(tmp_path):
    truth = [_truth(f"c{i}", "R" if i % 2 else "H", "H", bp=0.1, bs=-0.1) for i in range(10)]
    (tmp_path / "truth.jsonl").write_text(
        "".join(json.dumps(t) + "\n" for t in truth), encoding="utf-8"
    )
    ad = tmp_path / "answers"
    ad.mkdir()
    lines = []
    for t in truth:
        r = 0.95 if t["truth"] == "R" else 0.05
        lines.append({"case_id": t["case_id"], "p": {"H": 1 - r, "R": r, "N": 0.0},
                      "choice": "R" if r > 0.5 else "H", "raw": "", "sec": 0.1})  # fmt: skip
    (ad / "answers_fake_mix.jsonl").write_text(
        "".join(json.dumps(x) + "\n" for x in lines), encoding="utf-8"
    )
    import sys

    argv = sys.argv
    sys.argv = ["x", "score", "--answers", str(ad), "--truth", str(tmp_path / "truth.jsonl"),
                "--out", str(tmp_path / "s.csv"), "--gate", str(tmp_path / "g.json")]  # fmt: skip
    try:
        assert ev.main() == 0
    finally:
        sys.argv = argv
    assert json.loads((tmp_path / "g.json").read_text(encoding="utf-8")) == ["fake_mix"]


llm = _load("cymrole_audio_llm")


def _cases_dir(tmp_path, n=6):
    d = tmp_path / "cases"
    (d / "clips").mkdir(parents=True)
    rows = []
    for i in range(n):
        cid = f"song_{i:03d}" + "x" * i  # 파일 이름 길이로 가짜 백엔드 답이 바뀜
        for kind in ("mix", "drums"):
            (d / "clips" / f"{cid}_{kind}.wav").write_bytes(b"")
        rows.append(
            {
                "case_id": cid,
                "audio_mix": f"clips/{cid}_mix.wav",
                "audio_drums": f"clips/{cid}_drums.wav",
                "seconds": 2.0,
            }
        )
    (d / "cases.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    return d, rows


def _run(argv):
    import sys

    old = sys.argv
    sys.argv = ["x", *argv]
    try:
        return llm.main()
    finally:
        sys.argv = old


def test_llm_fake_backend_resumes_and_probs_sum_to_one(tmp_path):
    d, rows = _cases_dir(tmp_path)
    out = tmp_path / "answers"
    assert (
        _run(
            [
                "--backend",
                "fake",
                "--cases",
                str(d),
                "--audio",
                "mix",
                "--out",
                str(out),
                "--limit",
                "3",
            ]
        )
        == 0
    )
    f = out / "answers_fake_mix.jsonl"
    assert len(f.read_text(encoding="utf-8").splitlines()) == 3
    # 다시 돌리면 남은 마디만 답함
    assert _run(["--backend", "fake", "--cases", str(d), "--audio", "mix", "--out", str(out)]) == 0
    ans = [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines()]
    assert [a["case_id"] for a in ans] == [r["case_id"] for r in rows]
    for a in ans:
        assert sum(a["p"].values()) == pytest.approx(1.0)
        assert a["choice"] == max(a["p"], key=a["p"].get) and a["p_source"] == "logits"
    assert json.loads((out / "meta_fake_mix.json").read_text(encoding="utf-8"))["n"] == 3


def test_letter_probs_merges_space_variants():
    import torch

    names = ["H", " H", "R", "the", "N"]
    logits = torch.log(torch.tensor([0.3, 0.2, 0.25, 0.2, 0.05]))
    p, mass = llm.letter_probs(logits, lambda i: names[i])
    assert mass == pytest.approx(0.8)
    assert p["H"] == pytest.approx(0.5 / 0.8) and p["R"] == pytest.approx(0.25 / 0.8)


def test_letter_from_text():
    assert llm.letter_from_text(" R") == "R"
    assert llm.letter_from_text("The drummer plays the ride cymbal.") == "R"
    assert llm.letter_from_text("It sounds like a hi-hat") == "H"
    assert llm.letter_from_text("Neither is heard") == "N"
    assert llm.letter_from_text("cowbell") is None


def test_pipeline_runs_end_to_end_with_fake_backend(tmp_path):
    import shutil
    import subprocess
    import sys
    import zipfile

    work = tmp_path / "work"
    d, rows = _cases_dir(tmp_path, n=8)
    shutil.copytree(d, work)
    (work / "scripts").mkdir()
    for n in ("cymrole_audio_llm.py", "cymrole_audio_eval.py"):
        shutil.copy(SCRIPTS / n, work / "scripts" / n)
    truth = [
        _truth(r["case_id"], "R" if i % 2 else "H", "H", bp=0.0, bs=0.0) for i, r in enumerate(rows)
    ]
    (work / "truth.jsonl").write_text(
        "".join(json.dumps(t) + "\n" for t in truth), encoding="utf-8"
    )
    (work / "pilot.txt").write_text(
        "\n".join(r["case_id"] for r in rows[:6]) + "\n", encoding="utf-8"
    )
    cmd = [sys.executable, str(SCRIPTS / "cymrole_audio_pipeline.py"), "run", "--work", str(work),
           "--results", str(tmp_path / "results"), "--models", "fake", "--python", sys.executable]  # fmt: skip
    for _ in range(2):  # 두 번째 실행은 끝난 단계를 건너뜀
        env = {**__import__("os").environ, "PYTHONIOENCODING": "utf-8"}
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", env=env)
        assert res.returncode == 0, res.stdout + res.stderr
        out = res.stdout
    assert "시작 pilot_fake" not in out and "전체 끝" in out
    for n in ("check", "pilot_fake", "gate_fake"):
        assert (work / "done" / n).exists()
    pilot_ans = (
        (work / "answers" / "answers_fake_mix.jsonl").read_text(encoding="utf-8").splitlines()
    )
    assert len(pilot_ans) >= 6
    assert (work / "gate" / "fake.json").is_file()
    with zipfile.ZipFile(tmp_path / "results" / "cymrole_audio.zip") as z:
        assert "cymrole_audio/answers/answers_fake_mix.jsonl" in z.namelist()


def test_stated_probs_from_gemini_reply():
    assert llm.stated_probs("R 70") == pytest.approx({"H": 0.15, "R": 0.7, "N": 0.15})
    assert llm.stated_probs("h 100") == {"H": 1.0, "R": 0.0, "N": 0.0}
    assert llm.stated_probs("R") is None and llm.stated_probs("HR 50") is None
    row = llm.answer_row("x", llm.stated_probs("R 70"), "R 70", None, 1.0)
    assert row["choice"] == "R" and row["p_source"] == "stated"

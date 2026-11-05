"""학습 대기열 스크립트 테스트 (S15P31A307-164 설계 v0.4 3-4·4-3절)."""

from __future__ import annotations

import importlib.util
import json
import sys
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "train_queue.py"
SRC = Path(__file__).resolve().parents[2] / "src"


def _load():
    spec = importlib.util.spec_from_file_location("train_queue", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


Q = _load()


def _queue(run_dir: Path, names: list[str]) -> Path:
    st = run_dir / "status"
    st.mkdir(parents=True)
    queue = {
        "runs": [{"name": n, "config": f"configs/train/{n}.yaml"} for n in names],
        "out_root": "data/models/adtof_ft",
        "num_workers": 8,
        "python": sys.executable,
    }
    (st / "queue.json").write_text(json.dumps(queue), encoding="utf-8")
    return st


def _fake(results: dict[str, int], calls: list[str]):
    """학습 대신 이름별로 정한 종료 코드를 내는 명령. 0이면 끝 표시를 찍음."""

    def make_cmd(queue: dict, run: dict) -> list[str]:
        calls.append(run["name"])
        rc = results[run["name"]]
        line = "[train] 끝. best.pth" if rc == 0 else "Traceback: 오류"
        return [sys.executable, "-c", f"print({line!r}); raise SystemExit({rc})"]

    return make_cmd


def test_대기열은_하나씩_돌리고_DONE은_건너뛰고_실패를_표시한다(tmp_path: Path):
    st = _queue(tmp_path, ["tom_5cls", "tom_6cls", "tom_7cls"])
    (st / "tom_5cls.DONE").write_text("10-30 14:00", encoding="utf-8")
    (st / "tom_7cls.FAILED").write_text("종료 코드 1", encoding="utf-8")  # 지난 실패는 지우고 다시
    calls: list[str] = []
    failed = Q.run_queue(tmp_path, _fake({"tom_6cls": 0, "tom_7cls": 2}, calls), SRC)
    assert calls == ["tom_6cls", "tom_7cls"] and failed == 1
    assert (st / "tom_6cls.DONE").is_file() and not (st / "tom_6cls.FAILED").exists()
    assert (st / "tom_7cls.FAILED").read_text(encoding="utf-8") == "종료 코드 2"
    assert (st / "queue.DONE").is_file()
    assert "[train] 끝." in (st / "tom_6cls.log").read_text(encoding="utf-8")
    assert Q.run_state(st, "tom_6cls") == "끝남"
    assert Q.run_state(st, "tom_7cls").startswith("실패")


def test_동시_실행은_정한_수만큼_같이_돌고_빈자리에_다음_것을_띄운다(tmp_path: Path):
    st = _queue(tmp_path, ["a", "b", "c"])
    queue = json.loads((st / "queue.json").read_text(encoding="utf-8"))
    queue["parallel"] = 2
    (st / "queue.json").write_text(json.dumps(queue), encoding="utf-8")

    def make_cmd(queue: dict, run: dict) -> list[str]:
        # 시작·끝 시각을 로그에 남김
        code = (
            "import time; print('start', time.time()); time.sleep(0.5); print('end', time.time()); "
            "print('[train] 끝. x')"
        )
        return [sys.executable, "-c", code]

    assert Q.run_queue(tmp_path, make_cmd, SRC, poll_sec=0.05) == 0
    t = {}
    for n in ("a", "b", "c"):
        rows = dict(
            line.split() for line in (st / f"{n}.log").read_text(encoding="utf-8").splitlines()[:2]
        )
        t[n] = (float(rows["start"]), float(rows["end"]))
    assert t["a"][0] < t["b"][1] and t["b"][0] < t["a"][1]  # a·b는 겹쳐 돎
    assert t["c"][0] >= min(t["a"][1], t["b"][1])  # c는 자리가 난 뒤 시작
    assert all((st / f"{n}.DONE").is_file() for n in ("a", "b", "c"))


def test_코어를_정하면_명령_앞에_taskset이_붙는다():
    queue = {"python": "py", "out_root": "o", "num_workers": 8}
    run = {"name": "a", "config": "c.yaml"}
    assert Q.train_command(queue, run)[0] == "py"
    assert Q.train_command({**queue, "cpus": "0-95"}, run)[:4] == ["taskset", "-c", "0-95", "py"]


def test_종료_코드가_0이어도_끝_표시가_없으면_실패(tmp_path: Path):
    st = _queue(tmp_path, ["tom_5cls"])

    def make_cmd(queue: dict, run: dict) -> list[str]:
        return [sys.executable, "-c", "print('[train] 에폭 3')"]

    assert Q.run_queue(tmp_path, make_cmd, SRC) == 1
    assert (st / "tom_5cls.FAILED").is_file()


def test_코드_사본이_아닌_곳에서_읽으면_학습을_안_돌린다(tmp_path: Path):
    st = _queue(tmp_path, ["tom_5cls"])
    calls: list[str] = []
    assert Q.run_queue(tmp_path, _fake({"tom_5cls": 0}, calls), tmp_path / "다른곳" / "src") == 1
    assert calls == [] and "PYTHONPATH" in (st / "queue.FAILED").read_text(encoding="utf-8")


def test_상태는_pid와_표시_파일로_판단한다(tmp_path: Path, monkeypatch):
    st = tmp_path / "status"
    st.mkdir()
    assert Q.run_state(st, "tom_5cls") == "대기"  # 로그 파일만 있어도 대기
    (st / "tom_5cls.log").write_text("[train] 에폭 8", encoding="utf-8")
    assert Q.run_state(st, "tom_5cls") == "대기"
    (st / "tom_5cls.pid").write_text("123")
    monkeypatch.setattr(Q, "pid_alive", lambda pid: True)
    assert Q.run_state(st, "tom_5cls") == "도는 중 pid 123"
    monkeypatch.setattr(Q, "pid_alive", lambda pid: False)
    assert Q.run_state(st, "tom_5cls").startswith("멈춤")


def test_대기열이_살아_있으면_start가_새로_안_띄운다(tmp_path: Path, monkeypatch, capsys):
    st = tmp_path / "status"
    st.mkdir()
    (st / "queue.pid").write_text("123")
    monkeypatch.setattr(Q, "pid_alive", lambda pid: True)
    args = Q.build_parser().parse_args(
        ["start", "--run-dir", str(tmp_path), "--zip", "없음.zip", "--shared-ai", str(tmp_path),
         "--run", "tom_5cls=configs/train/adtof_tom_5cls.yaml"]
    )  # fmt: skip
    assert args.func(args) == 1
    assert "이미 돌고 있음" in capsys.readouterr().out
    assert not (tmp_path / "S15P31A307").exists()


def test_코드_zip은_data_폴더를_빼고_푼다(tmp_path: Path):
    z = tmp_path / "code.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("S15P31A307/AI/src/ssaplash_ai/__init__.py", "")
        zf.writestr("S15P31A307/AI/data/README.md", "x")
        zf.writestr("S15P31A307/CLAUDE.md", "x")
    assert Q.extract_code(z, tmp_path / "run") == 2
    assert (tmp_path / "run/S15P31A307/AI/src/ssaplash_ai/__init__.py").is_file()
    assert not (tmp_path / "run/S15P31A307/AI/data").exists()

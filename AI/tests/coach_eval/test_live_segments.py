"""저장 기록으로 구간 사실 다시 만들기. 앞 절은 FE `coach/live/liveLlm.test.ts`의 '마디 구간'·'구간 사실' 사례를
같은 입력·같은 기대값으로 옮긴 것이다(설계 COACH-001 각도·실측평가 4.4). FE 시험이 바뀌면 같이 고친다."""

from __future__ import annotations

import json

import pytest

from ssaplash_ai.coach.live_narrative import LiveSegmentFacts
from ssaplash_ai.coach_eval.live_segments import (
    MIN_SEGMENT_JUDGED,
    AimHit,
    JudgedNote,
    PlayRecord,
    SegmentChart,
    SegmentTracker,
    TempoSegment,
    aim_facts,
    chart_from_detail,
    js_round,
    pad_radius,
    poses_from_hits,
    rebuild_segments,
    segment_bars,
    segment_index_at,
    segment_range,
)

# 120BPM 4/4: 한 마디 2000ms, 첫 마디는 0ms
CHART = SegmentChart(bpm=120, offsetMs=0, beatsPerBar=4)
STEP = 250  # 8분음표


def note(
    t: float, judgement: str = "GOOD", delta: float | None = 20, pad: str = "SNARE"
) -> JudgedNote:
    song = t + 60 if judgement == "MISS" else t + (delta or 0)
    return JudgedNote(
        song,
        t,
        judgement,  # type: ignore[arg-type]
        None if judgement == "MISS" else delta,
        pad,
        round(t / STEP) % 2,
        90,
    )


# ---------- FE '마디 구간' ----------


def test_구간은_4_4_8_16마디_뒤_16마디씩이다() -> None:
    assert [segment_bars(i) for i in range(6)] == [
        (0, 4),
        (4, 4),
        (8, 8),
        (16, 16),
        (32, 16),
        (48, 16),
    ]
    r = segment_range(CHART, 1)
    assert (r.fromBar, r.toBar, r.startMs, r.endMs) == (5, 8, 8000, 16000)


def test_빠르기_변화가_있으면_그_박_시각을_따른다() -> None:
    tempo = SegmentChart(
        bpm=120,
        offsetMs=0,
        beatsPerBar=4,
        tempoSegments=(TempoSegment(0, 0, 120), TempoSegment(16, 8000, 240)),
    )
    r = segment_range(tempo, 1)
    assert (r.startMs, r.endMs) == (8000, 12000)


def test_첫_마디_앞은_구간에_넣지_않는다() -> None:
    assert segment_index_at(SegmentChart(bpm=120, offsetMs=1000, beatsPerBar=4), 500) == -1
    assert segment_index_at(CHART, 7999) == 0
    assert segment_index_at(CHART, 8000) == 1


# ---------- FE '구간 사실' ----------


def test_구간_끝_더하기_판정_폭이_지나면_사실_하나를_만든다() -> None:
    t = SegmentTracker(CHART, 60, "stick")
    done = []
    for ms in range(0, 8000, STEP):
        done += t.push(note(ms, "MISS" if ms % 1000 == 0 else "GOOD", 30), 1)
    assert done == []
    done += t.push(note(8100), 2)
    assert len(done) == 1
    f = done[0].facts
    assert f["segment"] == {"index": 0, "fromBar": 1, "toBar": 4}
    assert f["counts"] == {"perfect": 0, "good": 24, "miss": 8}
    assert f["timing"]["meanDeltaMs"] == 30
    assert f["pads"][0]["pad"] == "SNARE" and f["pads"][0]["misses"] == 8
    assert f["previous"] == {"counts": None, "lastTip": None}
    assert done[0].nextDurationMs == 8000
    for word in ("playId", "songId", "title", "hits"):
        assert word not in json.dumps(f)
    # 워커가 그대로 읽는 모양이다
    LiveSegmentFacts.model_validate(f)


def test_판정이_적은_구간은_건너뛰고_다음_구간에_직전_판정_수와_문구를_담는다() -> None:
    assert MIN_SEGMENT_JUDGED == 8
    t = SegmentTracker(CHART, 60, "keyboard")
    for ms in range(0, 3 * STEP, STEP):
        t.push(note(ms), 1)
    assert t.push(note(8100), 1) == []
    t.set_last_tip("키 위에 손가락", "손가락을 키에 올려 둬요")
    for ms in range(8250, 16000, STEP):
        t.push(note(ms), 2)
    [seg] = t.push(note(16100), 2)
    assert seg.facts["input"] == "keyboard"
    assert seg.facts["hands"] == {"weakHand": None, "ratio": None}
    assert seg.facts["previous"]["counts"] == {"perfect": 0, "good": 3, "miss": 0}
    assert seg.facts["previous"]["lastTip"]["title"] == "키 위에 손가락"


def test_규칙_지적과_원인은_그_구간에_붙고_UNKNOWN은_뺀다() -> None:
    t = SegmentTracker(CHART, 60, "stick")
    t.note_rule_coach(3000, "LIVE_LATE", "UNKNOWN")
    t.note_rule_coach(3500, "LIVE_PAD_MISS", "WRONG_PAD")
    for ms in range(0, 8000, STEP):
        t.push(note(ms), 1)
    [seg] = t.push(note(8100), 2)
    assert seg.facts["ruleCoach"] == {
        "tags": ["LIVE_LATE", "LIVE_PAD_MISS"],
        "causes": ["WRONG_PAD"],
    }


def test_js_반올림은_반에서_올린다() -> None:
    assert js_round(0.25, 1) == 0.3 and js_round(-0.25, 1) == -0.2 and js_round(2.5) == 3


# ---------- 스틱 끝 방향 ----------

POSES = {
    "SNARE": {"pitch": -30.0, "yaw": 0.0},
    "SMALL_TOM": {"pitch": -15.0, "yaw": 40.0},
    "HIHAT": {"pitch": -20.0, "yaw": -45.0},
}


def aim_hit(
    pad: str, dpitch: float, dyaw: float = 0.0, stick: int = 1, wrong: bool = False
) -> AimHit:
    ref = POSES[pad]
    return AimHit(0, pad, ref["pitch"] + dpitch, ref["yaw"] + dyaw, stick, wrong)


def test_반경은_가장_가까운_패드까지_각도의_0_6배이고_15에서_35도다() -> None:
    r = pad_radius("SNARE", POSES)
    assert 15 <= r <= 35
    assert pad_radius("SNARE", {"SNARE": POSES["SNARE"]}) == 35


def test_낮게_친_패드는_LOW이고_정도와_손을_센다() -> None:
    r = pad_radius("SMALL_TOM", POSES)
    hits = [aim_hit("SMALL_TOM", -0.7 * r, stick=0, wrong=i < 2) for i in range(5)]
    [a] = aim_facts(hits, POSES)
    assert a == {
        "pad": "SMALL_TOM",
        "hits": 5,
        "wrongPad": 2,
        "vertical": "LOW",
        "horizontal": None,
        "size": "CLEAR",
        "hand": "LEFT",
    }


def test_치우침이_작거나_타격이_적으면_넣지_않고_방위각을_못_믿으면_좌우를_뺀다() -> None:
    r = pad_radius("SNARE", POSES)
    assert aim_facts([aim_hit("SNARE", -0.1 * r) for _ in range(6)], POSES) == []
    assert aim_facts([aim_hit("SNARE", -0.7 * r) for _ in range(3)], POSES) == []
    side = [aim_hit("SNARE", 0, 0.4 * r) for _ in range(6)]
    assert aim_facts(side, POSES)[0]["horizontal"] == "RIGHT"
    assert aim_facts(side, POSES, trust_yaw=False) == []


def test_다른_패드로_잡힌_타격이_많은_패드가_먼저다() -> None:
    r = pad_radius("SNARE", POSES)
    hits = [aim_hit("SNARE", 0.9 * r) for _ in range(5)] + [
        aim_hit("HIHAT", -0.4 * pad_radius("HIHAT", POSES), wrong=True) for _ in range(4)
    ]
    assert [a["pad"] for a in aim_facts(hits, POSES)] == ["HIHAT", "SNARE"]


# ---------- 한 판 다시 계산 ----------


def detail(notes: list[tuple[str, float, str]]) -> dict:
    return {
        "bpm": 120,
        "offsetMs": 0,
        "beatsPerBar": 4,
        "timing": {"ppq": 480, "tempoMap": [{"tick": 0, "bpm": 120}]},
        "notes": [{"noteId": i, "timeMs": t, "pad": p} for i, t, p in notes],
    }


def test_채보_변환은_옛_패드_이름을_바꾸고_모르는_패드는_버린다() -> None:
    c = chart_from_detail(detail([("a", 0, "HI_TOM"), ("b", 250, "COWBELL")]))
    assert c.notes["a"].pad == "SMALL_TOM" and "b" not in c.notes
    assert c.tempoSegments == ()  # 빠르기 구간이 하나면 고정 bpm


def _play(chart_notes, hits, events=(), input_source="STICK") -> tuple[SegmentChart, PlayRecord]:
    chart = chart_from_detail(detail(chart_notes))
    return chart, PlayRecord("k1", input_source, 60.0, hits, events, POSES)


def _hit(seq, nid, t, judgement="GOOD", delta=30.0, pad="SNARE", pitch=-30.0, yaw=0.0, stick=1):
    miss = judgement == "MISS"
    return {
        "seq": seq,
        "t_ms": t,
        "stick_id": None if miss else stick,
        "pad": pad,
        "judgement": judgement,
        "matched_note_id": nid,
        "delta_ms": None if miss else delta,
        "velocity": None if miss else 90,
        "pitch": None if miss else pitch,
        "yaw": None if miss else yaw,
    }


def test_한_판을_FE_순서로_다시_돌린다() -> None:
    notes = [(f"n{i}", i * STEP, "SNARE") for i in range(40)]
    hits = [_hit(i, f"n{i}", i * STEP + 30) for i in range(40) if i != 5]
    hits.append(_hit(99, "n5", 5 * STEP, judgement="MISS"))
    events = [
        {"tMs": 3030, "tag": "LIVE_LATE", "text": "늦어요"},
        {"tMs": 3030, "tag": "LIVE_CAUSE", "text": json.dumps({"picked": "DRIFT_LATE"})},
        {"tMs": 3530, "tag": "LIVE_GATE_DROP", "text": json.dumps({"tag": "LIVE_UNSTEADY"})},
        {"tMs": 3600, "tag": "LIVE_GOOD_STEADY", "text": "좋아요"},
    ]
    chart, play = _play(notes, hits, events)
    [seg] = rebuild_segments(chart, play, with_aim=False)  # 둘째 구간은 끝나지 않았다(FE와 같음)
    f = seg.facts
    assert f["counts"] == {"perfect": 0, "good": 31, "miss": 1}
    assert f["timing"]["meanDeltaMs"] == 30
    assert f["ruleCoach"] == {"tags": ["LIVE_LATE", "LIVE_UNSTEADY"], "causes": ["DRIFT_LATE"]}
    assert f["stage"] == 3 and "aim" not in f


def test_다른_패드로_잡힌_타격은_놓친_노트의_aim에_들어간다() -> None:
    r = pad_radius("SMALL_TOM", POSES)
    low = POSES["SMALL_TOM"]["pitch"] - 0.7 * r
    notes = [(f"n{i}", i * STEP, "SMALL_TOM" if i % 4 == 0 else "SNARE") for i in range(40)]
    hits = []
    for i in range(40):
        if i % 4 == 0 and i < 32:
            hits.append(_hit(i, f"n{i}", i * STEP, judgement="MISS"))
            # 스몰탐을 치려다 낮게 쳐서 스네어로 잡힌 채보 밖 타격
            hits.append(
                {
                    **_hit(100 + i, None, i * STEP + 10, pad="SNARE", pitch=low, yaw=40.0),
                    "judgement": None,
                    "delta_ms": None,
                }
            )
        else:
            hits.append(_hit(i, f"n{i}", i * STEP + 5))
    chart, play = _play(notes, hits)
    [seg] = rebuild_segments(chart, play, with_aim=True)
    [a] = seg.facts["aim"]
    assert a["pad"] == "SMALL_TOM" and a["vertical"] == "LOW" and a["wrongPad"] == a["hits"] == 8
    LiveSegmentFacts.model_validate(seg.facts)


def test_키보드_판에는_aim을_넣지_않는다() -> None:
    notes = [(f"n{i}", i * STEP, "SNARE") for i in range(40)]
    hits = [_hit(i, f"n{i}", i * STEP + 30, pitch=-60) for i in range(40)]
    chart, play = _play(notes, hits, input_source="KEYBOARD")
    [seg] = rebuild_segments(chart, play, with_aim=True)
    assert "aim" not in seg.facts and seg.facts["input"] == "keyboard"


@pytest.mark.parametrize("with_aim", [True, False])
def test_빈_판은_구간이_없다(with_aim: bool) -> None:
    chart, play = _play([], [])
    assert rebuild_segments(chart, play, with_aim=with_aim) == []


def test_기준_자세가_없으면_그_판에서_맞게_친_타격의_중앙값을_기준으로_쓴다() -> None:
    # FE 업로드는 calibration.pads를 null로 보낸다. 둘째 구간만 스틱 끝을 낮게 쳤다
    notes = [(f"n{i}", i * STEP, "SNARE") for i in range(96)]
    hits = [
        _hit(i, f"n{i}", i * STEP + 5, pitch=-60.0 if 32 <= i < 64 else -30.0) for i in range(96)
    ]
    chart = chart_from_detail(detail(notes))
    play = PlayRecord("k1", "STICK", 60.0, hits, (), {})
    first, second = rebuild_segments(chart, play, with_aim=True)
    assert "aim" not in first.facts
    assert second.facts["aim"][0]["vertical"] == "LOW" and second.facts["aim"][0]["size"] == "CLEAR"
    assert poses_from_hits([AimHit(0, "SNARE", -30, 0, 0, False)] * 3) == {}


def test_사실에_판정_폭과_대신_친_패드가_들어간다() -> None:
    t = SegmentTracker(CHART, 60, "stick")
    for ms in range(0, 8000, STEP):
        if ms % 1000 == 0:
            # 스몰탐 칠 차례에 미드탐을 쳤다(채보 밖 타격이 먼저, 놓침 판정이 뒤에 온다)
            t.note_stray("MID_TOM", ms + 10)
            t.push(note(ms, "MISS", None, "SMALL_TOM"), 1)
        else:
            t.push(note(ms), 1)
    [seg] = t.push(note(8100), 2)
    f = seg.facts
    assert f["timing"]["goodMs"] == 60
    tom = next(p for p in f["pads"] if p["pad"] == "SMALL_TOM")
    assert tom["instead"] == "MID_TOM" and tom["misses"] == 8
    LiveSegmentFacts.model_validate(f)


def test_대신_친_패드가_없으면_null이다() -> None:
    t = SegmentTracker(CHART, 60, "keyboard")
    for ms in range(0, 8000, STEP):
        t.push(note(ms, "MISS" if ms % 1000 == 0 else "GOOD", 30), 1)
    [seg] = t.push(note(8100), 2)
    assert seg.facts["pads"][0]["instead"] is None


def test_played_pads_counts_pads_with_two_or_more_notes_in_order() -> None:
    from ssaplash_ai.coach_eval.live_segments import JudgedNote, played_pads

    def n(pad: str) -> JudgedNote:
        return JudgedNote(0.0, 0.0, "GOOD", 10.0, pad, 0, 90)

    assert played_pads([n("KICK"), n("SNARE"), n("KICK"), n("SMALL_TOM"), n("SNARE")]) == [
        "KICK",
        "SNARE",
    ]
    assert played_pads([]) == []

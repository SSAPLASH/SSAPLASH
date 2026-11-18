"""MusicXML → 파트별 음표 목록(초 단위).

표준 라이브러리만 씀. music21은 드럼 악기 정보를 잃고 partitura는 드럼 꾸밈음에서 못 읽어서 직접 해석함.
- 연주 순서: 첫 파트의 도돌이표·1/2번 괄호·D.C.·D.S.·Fine·To Coda를 펼친 마디 순서를 모든 파트가 같이 씀
- 시간: 연주 순서대로 <sound tempo>를 따라 초로 바꿈. 모든 파트가 같은 마디 시작 시각을 씀
- 드럼: 음표의 <instrument id> → <midi-unpitched>(1부터) → GM 번호. 없으면 표준 드럼 기보 위치로 추정
- 하이햇 열림: <technical><open/>은 열림, <stopped/>(+)는 닫힘, 둘 다 없으면 GM 번호(46·26 열림, 42·22 닫힘)
- 못갖춘마디: 첫 마디가 implicit="yes"면 그 길이가 pickup_sec(첫 정마디 시작 시각)
- 마디 반복 기호: <measure-repeat type="start">N이 켜진 동안 음표가 없는 마디는 N마디 앞 음표를 복사
- 세기: 음표 dynamics 값 × 0.9, 없으면 90, 괄호 친 고스트 노트는 40
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from ssaplash_ai.chart.sheet.drum_map import CLOSED_HIHAT_PITCHES, OPEN_HIHAT_PITCHES

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DEFAULT_VELOCITY = 90
GHOST_VELOCITY = 40
DYNAMICS_SCALE = 0.9
# 표준 드럼 기보 위치(display-step+octave) → GM 번호. 악기 id가 없을 때만 씀
DISPLAY_FALLBACK = {
    "F4": 36,
    "E4": 36,
    "C5": 38,
    "G5": 42,
    "A5": 49,
    "F5": 51,
    "E5": 48,
    "D5": 45,
    "A4": 43,
    "D4": 44,
    "B5": 49,
}
DRUM_CHANNEL = 10
# 연주 순서 펼치기 반복 상한. 잘못된 반복 기호로 끝나지 않는 경우를 막음
MAX_ORDER_STEPS = 20000


@dataclass
class SheetNote:
    part: str
    onset_sec: float
    dur_sec: float
    midi: int | None  # 음높이 있는 악기
    gm: int | None  # 드럼 GM 번호
    velocity: int
    measure_no: str
    source: str  # instrument / display / pitched
    is_open: bool | None = None  # 하이햇 열림. 하이햇이 아니면 None


@dataclass
class SheetPart:
    pid: str
    name: str
    is_drum: bool
    program: int
    notes: list[SheetNote] = field(default_factory=list)


@dataclass
class SheetScore:
    parts: list[SheetPart]
    bpm: float
    tempo_found: bool
    time_signature: str
    pickup_sec: float
    duration_sec: float
    measures_written: int
    measures_played: int

    @property
    def drum_notes(self) -> list[SheetNote]:
        notes = [n for p in self.parts if p.is_drum for n in p.notes if n.gm is not None]
        return sorted(notes, key=lambda n: n.onset_sec)


def read_root(path: str | Path) -> ET.Element:
    """MusicXML 파일 → 루트 요소. `.mxl`은 zip 안 META-INF/container.xml이 가리키는 파일."""
    path = Path(path)
    try:
        if path.suffix.lower() == ".mxl":
            with zipfile.ZipFile(path) as z:
                container = ET.fromstring(z.read("META-INF/container.xml"))
                rootfile = container.find(".//{*}rootfile")
                if rootfile is None:
                    raise ValueError("container.xml에 rootfile이 없음")
                return ET.fromstring(z.read(rootfile.get("full-path")))
        return ET.parse(path).getroot()
    except (ET.ParseError, zipfile.BadZipFile, KeyError) as e:
        raise ValueError(f"MusicXML을 읽을 수 없음: {type(e).__name__}: {e}") from e


def _txt(el: ET.Element, tag: str, default=None):
    x = el.find(tag)
    return x.text.strip() if x is not None and x.text else default


def play_order(measures: list[ET.Element]) -> list[int]:
    """첫 파트 마디들 → 연주 순서(마디 인덱스 목록). 도돌이표·괄호·D.C.·D.S.·Fine·Coda 처리."""
    n = len(measures)
    info = []
    for m in measures:
        d = {
            "fwd": False,
            "bwd": 0,
            "ending": None,
            "segno": False,
            "coda": False,
            "fine": False,
            "dacapo": False,
            "dalsegno": False,
            "tocoda": False,
        }
        for bl in m.findall("barline"):
            rep = bl.find("repeat")
            if rep is not None:
                if rep.get("direction") == "forward":
                    d["fwd"] = True
                else:
                    d["bwd"] = int(rep.get("times", "2"))
            end = bl.find("ending")
            if end is not None and end.get("type") == "start":
                d["ending"] = {int(x) for x in re.findall(r"\d+", end.get("number", ""))}
        for s in m.iter("sound"):
            d["segno"] |= s.get("segno") is not None
            d["coda"] |= s.get("coda") is not None
            d["fine"] |= s.get("fine") is not None
            d["dacapo"] |= s.get("dacapo") == "yes"
            d["dalsegno"] |= s.get("dalsegno") is not None
            d["tocoda"] |= s.get("tocoda") is not None
        info.append(d)
    # 괄호 범위: 시작 마디부터 stop·discontinue 마디까지 같은 번호
    ending_of: list[set[int] | None] = [None] * n
    cur = None
    for i, m in enumerate(measures):
        if info[i]["ending"] is not None:
            cur = info[i]["ending"]
        ending_of[i] = cur
        for bl in m.findall("barline"):
            end = bl.find("ending")
            if end is not None and end.get("type") in ("stop", "discontinue"):
                cur = None

    order: list[int] = []
    i, repeat_start, pass_no = 0, 0, 1
    done_bwd: dict[int, int] = {}
    jumped = False  # D.C.·D.S. 뒤에는 반복을 건너뛰고 Fine·To Coda를 따름
    steps = 0
    while i < n and steps < MAX_ORDER_STEPS:
        steps += 1
        d = info[i]
        if d["fwd"] and done_bwd.get(i, 0) == 0 and not jumped:
            if repeat_start != i:
                pass_no = 1
            repeat_start = i
        if ending_of[i] is not None and pass_no not in ending_of[i] and not jumped:
            i += 1
            continue
        order.append(i)
        if jumped and d["fine"]:
            break
        if jumped and d["tocoda"]:
            nxt = next((j for j in range(i + 1, n) if info[j]["coda"]), None)
            if nxt is not None:
                i = nxt
                continue
        if d["bwd"] and not jumped:
            done = done_bwd.get(i, 0) + 1
            done_bwd[i] = done
            if done < d["bwd"]:
                pass_no += 1
                i = repeat_start
                continue
            pass_no = 1
            repeat_start = i + 1
        if (d["dacapo"] or d["dalsegno"]) and not jumped:
            jumped = True
            i = 0 if d["dacapo"] else next((j for j in range(n) if info[j]["segno"]), 0)
            continue
        i += 1
    return order


def _hihat_open(note: ET.Element, gm: int | None) -> bool | None:
    tech = note.find("notations/technical")
    if tech is not None and tech.find("open") is not None:
        return True
    if tech is not None and tech.find("stopped") is not None:
        return False
    if gm in OPEN_HIHAT_PITCHES:
        return True
    if gm in CLOSED_HIHAT_PITCHES:
        return False
    return None


def _velocity(note: ET.Element) -> int:
    if note.find("notehead[@parentheses='yes']") is not None:
        return GHOST_VELOCITY
    dyn = note.get("dynamics")
    return min(127, int(float(dyn) * DYNAMICS_SCALE)) if dyn else DEFAULT_VELOCITY


@dataclass
class _Event:
    measure: int
    onset_q: float
    dur_q: float
    midi: int | None
    gm: int | None
    velocity: int
    source: str
    measure_no: str
    tie_stop: bool = False
    is_open: bool | None = None


def _part_meta(root: ET.Element) -> dict[str, dict]:
    """score-part → 악기 id별 GM 드럼 번호, 프로그램, 채널."""
    out = {}
    for sp in root.iter("score-part"):
        inst_gm, program, channel = {}, 0, None
        for mi in sp.findall("midi-instrument"):
            un = _txt(mi, "midi-unpitched")
            if un:
                inst_gm[mi.get("id")] = int(un) - 1
            pr = _txt(mi, "midi-program")
            if pr:
                program = int(pr) - 1
            ch = _txt(mi, "midi-channel")
            if ch:
                channel = int(ch)
        out[sp.get("id")] = {
            "name": _txt(sp, "part-name", sp.get("id")),
            "inst_gm": inst_gm,
            "program": program,
            "channel": channel,
        }
    return out


def parse_musicxml(path: str | Path, default_bpm: float = 120.0) -> SheetScore:
    """MusicXML 파일 → SheetScore. 읽을 수 없거나 형식이 다르면 ValueError."""
    root = read_root(path)
    if root.tag.endswith("score-timewise"):
        raise ValueError(
            "score-timewise 형식은 받지 않음 (악보 프로그램의 기본 내보내기는 partwise)"
        )
    if not root.tag.endswith("score-partwise"):
        raise ValueError(f"MusicXML 악보가 아님: 루트 {root.tag}")
    parts_meta = _part_meta(root)
    xml_parts = root.findall("part")
    if not xml_parts:
        raise ValueError("파트가 없음")
    first_measures = xml_parts[0].findall("measure")
    order = play_order(first_measures)
    n_meas = len(first_measures)

    # 1단계: 파트별·마디별 사건(4분음표 단위 위치)과 마디 길이, 템포 사건 모으기
    per_part: dict[str, tuple[dict, list[_Event], bool]] = {}
    meas_len_q = [0.0] * n_meas  # 마디 길이. 파트 중 최댓값
    nominal_q: list[float | None] = [None] * n_meas
    tempo_events: dict[int, list[tuple[float, float]]] = {}
    time_sigs: list[str] = []
    for xp in xml_parts:
        pid = xp.get("id")
        meta = parts_meta.get(pid) or {"name": pid, "inst_gm": {}, "program": 0, "channel": None}
        divisions = 1.0
        transpose = 0
        events: list[_Event] = []
        has_unpitched = False
        beats = None
        repeat_n = 0  # 마디 반복 기호로 되풀이할 마디 수. 0이면 꺼짐
        for mi, m in enumerate(xp.findall("measure")):
            cursor = max_cursor = last_onset = 0.0
            n_before = len(events)
            for el in m:
                tag = el.tag
                if tag == "attributes":
                    divisions = float(_txt(el, "divisions", divisions))
                    t = el.find("time")
                    if t is not None and _txt(t, "beats"):
                        b, bt = _txt(t, "beats"), _txt(t, "beat-type")
                        beats = sum(float(x) for x in b.split("+")) * 4.0 / float(bt)
                        if xp is xml_parts[0]:
                            time_sigs.append(f"{b}/{bt}")
                    tr = el.find("transpose")
                    if tr is not None:
                        # MuseScore 3은 TAB 보표가 있는 파트를 실제 소리 높이로 적으면서 octave-change도 붙임 → 옥타브는 뺌
                        has_tab = any(_txt(c, "sign") == "TAB" for c in el.findall("clef"))
                        has_tab |= xp.find(".//staff-tuning") is not None
                        octave = 0 if has_tab else int(_txt(tr, "octave-change", 0))
                        transpose = int(_txt(tr, "chromatic", 0)) + 12 * octave
                    for mr in el.findall("measure-style/measure-repeat"):
                        if mr.get("type") == "start":
                            repeat_n = int(mr.text.strip()) if mr.text and mr.text.strip() else 1
                        elif mr.get("type") == "stop":
                            repeat_n = 0
                elif tag in ("direction", "sound"):
                    snds = [el] if tag == "sound" else el.findall("sound")
                    # direction의 <offset>은 지금 위치에서 앞뒤로 떨어진 거리(divisions 단위)
                    off = float(_txt(el, "offset", 0)) / divisions if tag == "direction" else 0.0
                    for s in snds:
                        if s.get("tempo"):
                            tempo_events.setdefault(mi, []).append(
                                (max(cursor + off, 0.0), float(s.get("tempo")))
                            )
                elif tag == "backup":
                    cursor -= float(_txt(el, "duration")) / divisions
                elif tag == "forward":
                    cursor += float(_txt(el, "duration")) / divisions
                    max_cursor = max(max_cursor, cursor)
                elif tag == "note":
                    if el.find("cue") is not None:
                        continue
                    grace = el.find("grace") is not None
                    dur = 0.0 if grace else float(_txt(el, "duration", 0)) / divisions
                    is_chord = el.find("chord") is not None
                    onset = last_onset if is_chord else cursor
                    if not is_chord:
                        last_onset = cursor
                        cursor += dur
                        max_cursor = max(max_cursor, cursor)
                    if el.find("rest") is not None:
                        continue
                    tie_stop = any(t.get("type") == "stop" for t in el.findall("tie"))
                    velocity = _velocity(el)
                    if el.find("unpitched") is not None:
                        has_unpitched = True
                        if tie_stop:
                            continue
                        inst = el.find("instrument")
                        gm, src = None, "instrument"
                        if inst is not None and inst.get("id") in meta["inst_gm"]:
                            gm = meta["inst_gm"][inst.get("id")]
                        elif len(meta["inst_gm"]) == 1:
                            gm = next(iter(meta["inst_gm"].values()))
                        else:
                            up = el.find("unpitched")
                            key = f"{_txt(up, 'display-step')}{_txt(up, 'display-octave')}"
                            gm, src = DISPLAY_FALLBACK.get(key), "display"
                        events.append(
                            _Event(
                                mi,
                                onset,
                                dur,
                                None,
                                gm,
                                velocity,
                                src,
                                m.get("number", ""),
                                is_open=_hihat_open(el, gm),
                            )
                        )
                    elif el.find("pitch") is not None:
                        p = el.find("pitch")
                        midi = (
                            (int(_txt(p, "octave")) + 1) * 12
                            + STEP[_txt(p, "step")]
                            + int(float(_txt(p, "alter", 0)))
                            + transpose
                        )
                        events.append(
                            _Event(
                                mi,
                                onset,
                                dur,
                                midi,
                                None,
                                velocity,
                                "pitched",
                                m.get("number", ""),
                                tie_stop=tie_stop,
                            )
                        )
            if repeat_n and len(events) == n_before and mi >= repeat_n:
                # 마디 반복 기호(%): 음표 없이 쉼표만 있는 마디 → repeat_n마디 앞 음표를 복사
                src_mi = mi - repeat_n
                for ev in [e for e in events if e.measure == src_mi]:
                    events.append(
                        _Event(
                            mi,
                            ev.onset_q,
                            ev.dur_q,
                            ev.midi,
                            ev.gm,
                            ev.velocity,
                            ev.source,
                            m.get("number", ""),
                            ev.tie_stop,
                            ev.is_open,
                        )
                    )
            if mi < n_meas:
                meas_len_q[mi] = max(meas_len_q[mi], max_cursor)
                nominal_q[mi] = beats
        is_drum = has_unpitched or meta["channel"] == DRUM_CHANNEL
        per_part[pid] = (meta, events, is_drum)

    # 2단계: 연주 순서대로 마디 시작 시각(초). 템포는 연주 순서상 마지막 값을 이어 씀
    tempo = default_bpm
    first_tempo = None
    starts: list[tuple[int, float, list[tuple[float, float, float]]]] = []
    t = 0.0
    for mi in order:
        segs: list[tuple[float, float, float]] = []  # (시작 q, 마디 시작 기준 초, 템포)
        q_prev, s_prev = 0.0, 0.0
        tempo_start = tempo
        for q, bpm in sorted(tempo_events.get(mi, [])):
            s_prev += (q - q_prev) * 60.0 / tempo
            q_prev = q
            tempo = bpm
            if first_tempo is None:
                first_tempo = bpm
            segs.append((q, s_prev, tempo))
        if not segs or segs[0][0] > 0:
            segs.insert(0, (0.0, 0.0, tempo_start))
        starts.append((mi, t, segs))
        t += _q_to_sec(segs, meas_len_q[mi] or (nominal_q[mi] or 4.0))
    total_sec = t
    first = first_measures[0] if first_measures else None
    pickup_sec = 0.0
    if (
        first is not None
        and first.get("implicit") == "yes"
        and order[:1] == [0]
        and len(starts) > 1
    ):
        pickup_sec = starts[1][1]

    parts: list[SheetPart] = []
    for xp in xml_parts:
        pid = xp.get("id")
        meta, events, is_drum = per_part[pid]
        part = SheetPart(pid, meta["name"], is_drum, meta["program"])
        by_meas: dict[int, list[_Event]] = {}
        for ev in events:
            by_meas.setdefault(ev.measure, []).append(ev)
        for mi, t0, segs in starts:
            for ev in by_meas.get(mi, []):
                on = t0 + _q_to_sec(segs, ev.onset_q)
                off = t0 + _q_to_sec(segs, ev.onset_q + ev.dur_q)
                if ev.midi is not None and ev.tie_stop and part.notes:
                    # 붙임줄: 앞 음 길이만 늘림
                    prev = next((x for x in reversed(part.notes) if x.midi == ev.midi), None)
                    if prev is not None:
                        prev.dur_sec = off - prev.onset_sec
                        continue
                part.notes.append(
                    SheetNote(
                        pid,
                        on,
                        off - on,
                        ev.midi,
                        ev.gm,
                        ev.velocity,
                        ev.measure_no,
                        ev.source,
                        ev.is_open,
                    )
                )
        part.notes.sort(key=lambda x: x.onset_sec)
        # 한 파트 안 같은 시각·같은 음은 하나만 (오선·TAB 두 보표에 같은 음이 겹침)
        seen: set[tuple] = set()
        kept = []
        for n in part.notes:
            key = (round(n.onset_sec, 4), n.midi, n.gm)
            if key not in seen:
                seen.add(key)
                kept.append(n)
        part.notes = kept
        parts.append(part)
    return SheetScore(
        parts=parts,
        bpm=first_tempo or default_bpm,
        tempo_found=first_tempo is not None,
        time_signature=time_sigs[0] if time_sigs else "4/4",
        pickup_sec=pickup_sec,
        duration_sec=total_sec,
        measures_written=n_meas,
        measures_played=len(order),
    )


def _q_to_sec(segs: list[tuple[float, float, float]], q: float) -> float:
    """마디 안 위치(4분음표 단위) → 마디 시작 기준 초. segs는 (시작 q, 시작 초, 템포) 오름차순."""
    seg = segs[0]
    for s in segs:
        if s[0] <= q:
            seg = s
    return seg[1] + (q - seg[0]) * 60.0 / seg[2]

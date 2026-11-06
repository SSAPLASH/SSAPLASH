"""약점 항목마다 붙이는 연습 조언(`tip`) 문장.

`description`이 "무슨 일이 있었는지"를 말한다면 `tip`은 "어떻게 연습할지"를 말한다. `pattern`으로 문장을
고르고 패드 이름만 채운다. 타격 데이터를 읽지 않고 새 숫자도 만들지 않아서 같은 입력은 항상 같은 문장이다.

문구 원칙
- 초보자 눈높이: 전문 용어를 풀어 쓰고 BPM 같은 숫자 대신 "느린 템포"라고 쓴다.
- 음악에 맞는 방법: 박, 템포, 마디, 반복 구간, 손목 반동처럼 실제 연습에서 쓰는 방법을 한두 가지만 말한다.
- 격려하는 말투: "~해 보세요", "~좋아요". 사용자의 실수를 단정하지 않는다.
- 실시간 코칭 문구(FE `coach/live/copy.ts`)와 어휘를 맞춘다(박, 살짝 앞서, 기다렸다 치기).
문구는 가정이다. 첫 배포 뒤 피드백으로 이 파일에서만 고친다.

이 모듈은 `patterns`를 가져오지 않는다. 후보 객체가 아니라 `pattern` 이름과 `pads`만 받는다.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

from ssaplash_ai.coach.config import PAD_LABELS_KO, SEVERITY_HIGH, SEVERITY_MEDIUM

_HANGUL_FIRST = 0xAC00
_HANGUL_LAST = 0xD7A3


def _jongseong(word: str) -> int | None:
    """마지막 글자의 받침 번호. 받침이 없으면 0, ㄹ이면 8, 한글이 아니면 None."""
    code = ord(word[-1])
    if _HANGUL_FIRST <= code <= _HANGUL_LAST:
        return (code - _HANGUL_FIRST) % 28
    return None


def _ro(word: str) -> str:
    """'로'/'으로'를 붙인다. 받침이 없거나 ㄹ이면 '로'."""
    return f"{word}로" if _jongseong(word) in (None, 0, 8) else f"{word}으로"


def _eul(word: str) -> str:
    """'를'/'을'을 붙인다."""
    return f"{word}를" if _jongseong(word) in (None, 0) else f"{word}을"


def _label(pads: Sequence[str], index: int, default: str) -> str:
    """`pads[index]`의 한글 이름. 패드 정보가 없으면 `default`."""
    if index >= len(pads) or not pads[index]:
        return default
    return PAD_LABELS_KO.get(pads[index], pads[index])


def _const(text: str) -> Callable[[Sequence[str]], str]:
    return lambda _pads: text


def _pad_late(pads: Sequence[str]) -> str:
    pad = _label(pads, 0, "그 패드")
    return (
        f"자유 연습에서 메트로놈을 켜고 {pad}만 박에 맞춰 쳐 보세요. "
        "그 패드로 손을 옮기는 동작을 미리 준비하면 제때 칠 수 있어요."
    )


def _pad_early(pads: Sequence[str]) -> str:
    pad = _label(pads, 0, "그 패드")
    return (
        f"자유 연습에서 메트로놈을 켜고 {pad}만 박에 맞춰 쳐 보세요. "
        "그 패드는 박을 조금 더 기다렸다가 치면 정확해져요."
    )


def _transition_late(pads: Sequence[str]) -> str:
    # pads는 [이전 패드, 현재 패드] 순서다(patterns/transition.py)
    a, b = _label(pads, 0, "앞 패드"), _label(pads, 1, "다음 패드")
    return (
        f"자유 연습에서 {a}에서 {_ro(b)} 넘어가는 동작을 천천히 반복해 보세요. "
        f"{_eul(a)} 치자마자 {b} 쪽으로 손을 미리 보내면 좋아요."
    )


def _transition_miss(pads: Sequence[str]) -> str:
    a, b = _label(pads, 0, "앞 패드"), _label(pads, 1, "다음 패드")
    return (
        f"자유 연습에서 {a}에서 {_ro(b)} 넘어가는 동작을 아주 천천히 시작해 보세요. "
        "익숙해지면 조금씩 빠르게 쳐 봐요."
    )


def _pad_confusion(pads: Sequence[str]) -> str:
    # 후속 규칙이다. 이 규칙을 켤 때 pads[0]이 "치려던 패드"인지 확인한다.
    pad = _label(pads, 0, "그 패드")
    return (
        f"{_eul(pad)} 칠 때 다른 패드 소리가 난다면 스틱 위치와 키트 배치를 확인해 보세요. "
        "연주 실수가 아니라 인식 문제일 수도 있어요."
    )


_TIPS: dict[str, Callable[[Sequence[str]], str]] = {
    "TIMING_LATE": _const(
        "스틱을 미리 올려 두고, 박에 맞춰 내려쳐 보세요. "
        "자유 연습에서 메트로놈을 켜고 치면 감이 빨리 와요."
    ),
    "TIMING_EARLY": _const(
        "박을 끝까지 기다렸다가 내려쳐 보세요. "
        "자유 연습에서 메트로놈을 켜고 여유 있게 쳐 보면 좋아요."
    ),
    "PAD_LATE": _pad_late,
    "PAD_EARLY": _pad_early,
    "TRANSITION_LATE": _transition_late,
    "TRANSITION_MISS": _transition_miss,
    # 조언은 pads만 받아서 "약한 쪽 손"이라고 쓴다. 어느 손인지는 제목과 설명이 알려 준다
    "HAND_WEAK": _const(
        "약한 쪽 손으로만 같은 리듬을 반복해 보세요. "
        "스틱을 꽉 쥐지 말고 튕겨 올리듯 치면 소리가 고르게 나요."
    ),
    "MISS_CLUSTER": _const(
        "이 구간을 들어 보며 어떤 노트를 놓쳤는지 먼저 확인해 보세요. "
        "그다음 쉬운 연습 단계로 쳐 보면 곡이 한결 쉬워져요."
    ),
    "UNSTEADY": _const(
        "자유 연습에서 메트로놈을 켜고 스네어 하나만 일정하게 쳐 보세요. "
        "간격이 고르게 느껴지면 다른 패드를 섞어 보세요."
    ),
    # 아래 다섯은 규칙이 아직 꺼져 있다(config.ENABLED_PATTERNS). 켜질 때 바로 붙도록 문구만 둔다.
    "TEMPO_DRIFT_FAST": _const(
        "박 소리를 끝까지 들으며 치는 연습을 해 보세요. "
        "신나는 부분에서 속도가 빨라지지 않게 숨을 고르는 것도 도움이 돼요."
    ),
    "TEMPO_DRIFT_SLOW": _const(
        "박 소리를 끝까지 들으며 치는 연습을 해 보세요. "
        "힘이 빠지는 후반에도 같은 속도를 지키도록 팔에 힘을 빼 보세요."
    ),
    "VELOCITY_FADE": _const(
        "후반에도 처음처럼 소리 크기를 맞춰 보세요. "
        "어깨와 팔에 힘을 빼고 손목으로 치면 오래 쳐도 덜 지쳐요."
    ),
    "PAD_CONFUSION": _pad_confusion,
    "DENSE_WEAK": _const(
        "음이 빽빽한 부분은 쉬운 연습 단계로 먼저 쳐 보세요. 익숙해지면 연습 단계를 하나씩 올려요."
    ),
}

# 조언 문장이 있는 pattern 이름
TIP_PATTERNS = frozenset(_TIPS)


def tip_for(pattern: str, pads: Sequence[str]) -> str | None:
    """`pattern`에 맞는 연습 조언 문장. 문구가 없는 새 pattern이면 None(응답에서 `tip` 키를 생략한다)."""
    build = _TIPS.get(pattern)
    return build(pads) if build is not None else None


def _eun(word: str) -> str:
    """'는'/'은'을 붙인다."""
    return f"{word}는" if _jongseong(word) in (None, 0) else f"{word}은"


def level_for(severity: float) -> str:
    """`metrics.severity`(0~1)를 단계로 옮긴다. 경계값은 윗단계에 속한다(0.4 → MEDIUM, 0.7 → HIGH)."""
    if severity >= SEVERITY_HIGH:
        return "HIGH"
    if severity >= SEVERITY_MEDIUM:
        return "MEDIUM"
    return "LOW"


def _weak_hand(metrics: dict[str, float | int | str]) -> str:
    """약한 손 이름. 스틱 0은 왼손, 1은 오른손이다(공통 명세서 9장). 값이 없으면 "약한 쪽 손"."""
    return {0: "왼손", 1: "오른손"}.get(metrics.get("weakStickId"), "약한 쪽 손")  # type: ignore[arg-type]


def _int(value: object) -> int | None:
    return int(round(float(value))) if isinstance(value, (int, float)) else None


def detail_for(
    pattern: str,
    pads: Sequence[str],
    metrics: dict[str, float | int | str],
    from_ms: float,
    to_ms: float,
) -> str | None:
    """약점이 무슨 뜻이고 얼마나 넓게 나타나는지 한두 문장. 숫자는 `metrics`에 있는 값이나 그 산술만 쓴다.

    `description`이 사실 한 줄이라면 `detail`은 그 사실이 곡 전체의 경향인지 특정 구간의 문제인지, 연습할 때
    어디에 집중할지를 풀어 준다. 문구가 없는 pattern이거나 필요한 `metrics`가 없으면 None(키 생략).
    """
    count = _int(metrics.get("hitCount"))
    if pattern in ("TIMING_LATE", "TIMING_EARLY") and count is not None:
        way = (
            ("늦게", "스틱을 미리 준비하는 습관")
            if pattern == "TIMING_LATE"
            else ("빠르게", "박을 기다리는 습관")
        )
        return (
            f"곡 전체에서 박보다 {way[0]} 치는 경향이에요({count}번 기준). "
            f"특정 구간보다 치는 습관에 가까워서 {way[1]}을 들이면 곡 전체가 좋아질 수 있어요."
        )
    if pattern in ("PAD_LATE", "PAD_EARLY"):
        mean, overall = metrics.get("meanDeltaMs"), metrics.get("overallMeanDeltaMs")
        if isinstance(mean, (int, float)) and isinstance(overall, (int, float)):
            pad = _label(pads, 0, "그 패드")
            way = "늦게" if pattern == "PAD_LATE" else "빠르게"
            return (
                f"{_eun(pad)} 다른 패드보다 평균 {abs(mean - overall):.0f}ms {way} 쳐요. "
                "나머지 패드와 비교한 차이라서 이 패드부터 연습하면 효과가 커요."
            )
    if pattern in ("TRANSITION_LATE", "TRANSITION_MISS"):
        times = _int(metrics.get("transitionCount"))
        a, b = _label(pads, 0, "앞 패드"), _label(pads, 1, "다음 패드")
        if pattern == "TRANSITION_LATE" and times is not None:
            return (
                f"{a}에서 {_ro(b)} 넘어가는 {times}번을 기준으로 한 평균이에요. "
                "손이 옮겨 가는 동작이 박보다 느려서 그 전환만 따로 연습하면 돼요."
            )
        missed = _int(metrics.get("missCount"))
        if pattern == "TRANSITION_MISS" and times is not None and missed is not None:
            return (
                f"{a}에서 {_ro(b)} 넘어가는 {times}번 중 {missed}번을 놓쳤어요. "
                "전환 동작이 아직 익숙하지 않다는 신호예요."
            )
    if pattern == "HAND_WEAK":
        ratio = metrics.get("velocityRatio")
        weak, strong = _int(metrics.get("weakHitCount")), _int(metrics.get("strongHitCount"))
        if isinstance(ratio, (int, float)) and weak is not None and strong is not None:
            return (
                f"{_weak_hand(metrics)}이 다른 손의 {ratio * 100:.0f}% 세기로 쳤어요(각각 {weak}번, {strong}번 기준). "
                "소리 크기가 들쭉날쭉하게 들릴 수 있어요."
            )
    if pattern == "MISS_CLUSTER":
        notes, missed = _int(metrics.get("noteCount")), _int(metrics.get("missCount"))
        if notes is not None and missed is not None:
            seconds = round((to_ms - from_ms) / 1000)
            return (
                f"이 {seconds}초 동안 노트 {notes}개 중 {missed}개를 놓쳤어요. "
                "곡의 다른 부분은 괜찮을 수 있으니 이 구간에 집중해 보세요."
            )
    if pattern == "UNSTEADY":
        std = metrics.get("stdDeltaMs")
        if isinstance(std, (int, float)) and count is not None:
            return (
                f"치는 시각이 박을 기준으로 약 {std:.0f}ms 폭으로 흔들려요({count}번 기준). "
                "곡 전체의 박자감을 맞추는 연습이 필요해요."
            )
    return None

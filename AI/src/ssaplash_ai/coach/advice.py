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

from ssaplash_ai.coach.config import PAD_LABELS_KO

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
        f"{pad}만 따로 골라 박에 맞춰 반복해 보세요. "
        "그 패드로 손을 옮기는 동작을 미리 준비하면 제때 칠 수 있어요."
    )


def _pad_early(pads: Sequence[str]) -> str:
    pad = _label(pads, 0, "그 패드")
    return (
        f"{pad}만 따로 골라 박에 맞춰 반복해 보세요. "
        "그 패드는 박 소리를 조금 더 기다렸다가 치면 정확해져요."
    )


def _transition_late(pads: Sequence[str]) -> str:
    # pads는 [이전 패드, 현재 패드] 순서다(patterns/transition.py)
    a, b = _label(pads, 0, "앞 패드"), _label(pads, 1, "다음 패드")
    return (
        f"{a}에서 {_ro(b)} 넘어가는 부분만 따로 느리게 반복해 보세요. "
        f"{_eul(a)} 치자마자 {b} 쪽으로 손을 미리 보내면 좋아요."
    )


def _transition_miss(pads: Sequence[str]) -> str:
    a, b = _label(pads, 0, "앞 패드"), _label(pads, 1, "다음 패드")
    return (
        f"{a}에서 {_ro(b)} 넘어가는 부분을 아주 느린 템포로 시작해 보세요. "
        "익숙해지면 템포를 조금씩 올려요."
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
        "스틱을 미리 올려 두고, 박 소리가 들리는 순간 내려쳐 보세요. "
        "느린 템포부터 시작하면 감이 빨리 와요."
    ),
    "TIMING_EARLY": _const(
        "박 소리를 끝까지 듣고, 소리가 울리는 순간에 내려쳐 보세요. "
        "서두르지 말고 느린 템포에서 여유를 가져 보세요."
    ),
    "PAD_LATE": _pad_late,
    "PAD_EARLY": _pad_early,
    "TRANSITION_LATE": _transition_late,
    "TRANSITION_MISS": _transition_miss,
    # 어느 손(왼손/오른손)인지는 문서에 없어서 "약한 쪽 손"이라고만 쓴다(patterns/hand.py)
    "HAND_WEAK": _const(
        "약한 쪽 손으로만 같은 리듬을 반복해 보세요. "
        "스틱을 꽉 쥐지 말고 튕겨 올리듯 치면 소리가 고르게 나요."
    ),
    "MISS_CLUSTER": _const(
        "놓친 부분만 따로 떼어 느린 템포로 반복해 보세요. "
        "한 번에 한 마디씩 익히면 곡 전체가 쉬워져요."
    ),
    "UNSTEADY": _const(
        "박 소리에 맞춰 스네어 하나만 일정하게 길게 쳐 보세요. "
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
        "음이 빽빽한 부분은 가장 느린 템포에서 시작해 보세요. "
        "박 하나하나를 또박또박 치다가 템포를 조금씩 올려요."
    ),
}

# 조언 문장이 있는 pattern 이름
TIP_PATTERNS = frozenset(_TIPS)


def tip_for(pattern: str, pads: Sequence[str]) -> str | None:
    """`pattern`에 맞는 연습 조언 문장. 문구가 없는 새 pattern이면 None(응답에서 `tip` 키를 생략한다)."""
    build = _TIPS.get(pattern)
    return build(pads) if build is not None else None

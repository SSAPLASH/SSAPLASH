// 자유 연습 키트 가이드(MODE-002 D2·D6): 패드 이름표 알약의 목록·자리·키를 만든다. React·runtime을 모르는 순수 함수
import { kitBoxFor, kitPadsFor, type KitSkin } from '@/domain/kit/drumKit';
import { KEY_MAP } from '@/domain/kit/keyMap';
import type { PadId } from '@/domain/kit/pads';

export interface KitGuideLabel {
  pad: PadId;
  /** 패드 이름(PAD_META 라벨) */
  name: string;
  /** 킷 상자 기준 가로 자리(0~100 %) */
  xPct: number;
  /** 킷 상자 기준 세로 자리(0~100 %) */
  yPct: number;
  /** 이 패드를 치는 키 글자(키보드로 칠 때만). 없으면 빈 배열 */
  keys: string[];
}

/** KeyboardEvent.code → 화면 글자(KeyF → F, Digit1 → 1, Space는 그대로) */
const keyText = (code: string) => code.replace('Key', '').replace('Digit', '');

/** 패드를 치는 키 글자들(KEY_MAP 순서) */
function keysOf(pad: PadId): string[] {
  return Object.entries(KEY_MAP)
    .filter(([, b]) => b.pad === pad)
    .map(([code]) => keyText(code));
}

/**
 * 스킨별 이름표 목록. 실물이면 원근 배치(그리는 순서, 9패드)대로, 전자·네온이면 빈 배열(내장 글자를 쓴다, D6).
 * 자리 = 조각 왼쪽·위 + 그림 자리 label × (조각 폭 ÷ 160), 킷 상자로 나눈 %. showKeys면 키 글자를 붙인다
 */
export function kitGuideLabels(skin: KitSkin, showKeys: boolean): KitGuideLabel[] {
  if (skin !== 'acoustic') return [];
  const box = kitBoxFor('acoustic', 'persp');
  return kitPadsFor('acoustic', 'persp').flatMap((p) => {
    if (!p.art) return [];
    const k = p.w / 160;
    return [
      {
        pad: p.pad,
        name: p.label,
        xPct: ((p.left + p.art.label.x * k) / box.w) * 100,
        yPct: ((p.top + p.art.label.y * k) / box.h) * 100,
        keys: showKeys ? keysOf(p.pad) : [],
      },
    ];
  });
}

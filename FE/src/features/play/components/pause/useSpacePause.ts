// 연주 중 Space로 일시정지(악보 연습·리듬 게임 공용). Esc 일시정지는 각 페이지의 키 처리가 그대로 맡는다.
// Space는 키보드 드럼의 킥 키(domain/kit/keyMap)라서, 킥을 페달로 치는 입력(동글 = 스틱 + 페달 보드)일 때만 일시정지 키로 쓴다.
// 키보드 전용·페달이 없는 입력에서는 Space가 유일한 킥이라 건드리지 않는다.
import { useEffect, useRef } from 'react';
import { pedalRequired } from '@/domain/kit/device/pedalStatus';
import { isKeyOwnedByTarget, type KeyTarget } from '@/domain/kit/keyTarget';
import { useSettings } from '@/store/settingsStore';

/** 이 입력에서 곡 중 Space가 일시정지 키인지. 페달이 필수인 입력(동글)만 참 */
export function spacePauses(sensorKind: string): boolean {
  return pedalRequired(sensorKind);
}

interface Options {
  /** 곡 연주 단계인지(카운트다운·일시정지 포함). 거짓이면 Space를 건드리지 않는다 */
  inSong: () => boolean;
  /** 지금 일시정지할 수 있는지. 이미 일시정지 중이거나 복귀 카운트다운 중이면 거짓 — 그때도 Space는 킥으로 새지 않는다 */
  canPause: () => boolean;
  pause: () => void;
}

export function useSpacePause(options: Options): void {
  const ref = useRef(options);
  useEffect(() => {
    ref.current = options;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
      if (!spacePauses(useSettings.getState().sensorKind)) return;
      const o = ref.current;
      if (!o.inSong()) return;
      // 버튼·입력 칸·다이얼로그(일시정지 창, Dock 패널)에 초점이 있으면 그 요소의 Space다
      if (isKeyOwnedByTarget(e.target as KeyTarget, 'Space')) return;
      // 이 입력에서는 곡 중 Space가 킥이 아니다. 키보드 드럼(window의 keydown)에 닿기 전에 여기서 끝낸다
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat && o.canPause()) o.pause();
    };
    // 캡처 단계: 키보드 드럼보다 먼저 받는다
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

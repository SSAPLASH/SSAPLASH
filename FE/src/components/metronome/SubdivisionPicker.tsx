// 메트로놈 박 분할 선택(자동 · 4분음표 · 8분음표)과 풀이 한 줄(설계 MODE-002-MODE-003-metronome-subdivision).
// Dock 메트로놈 패널과 악보 연습 시작 확인 창이 같이 쓴다. 값 저장과 예시 소리는 호출자가 onChange에서 한다 — 이 부품은 고르는 칸과 문구만 그린다.
// 예시 소리가 나는 동안 풀이 줄 오른쪽 점(PreviewDots)이 정박에 맞춰 켜진다.
import { useSyncExternalStore } from 'react';
import { SUBDIVISION_LABEL, SUBDIVISION_PREFS, subdivisionHint, type SubdivisionPlace, type SubdivisionPref } from '@/domain/time/metronome';
import { metronomePreview, type PreviewPlace } from '@/runtime/metronomePreview';
import { Segmented } from '@/components/ui/form/Segmented';
import './subdivision-picker.css';

interface Props {
  value: SubdivisionPref;
  onChange: (value: SubdivisionPref) => void;
  /** 풀이 문구의 기준 BPM. 자동인데 모르면 문구가 비어 있다 */
  bpm?: number;
  /** 풀이 문구 기준: 곡(「BPM 72 곡이라 …」) · 자유 연습 메트로놈(「지금 BPM에서는 …」) */
  place: SubdivisionPlace;
  /** 이 자리에서 예시 소리가 나면 점을 켠다. 없으면 점을 그리지 않는다 */
  previewPlace?: PreviewPlace;
  disabled?: boolean;
  className?: string;
}

export function SubdivisionPicker({ value, onChange, bpm, place, previewPlace, disabled = false, className }: Props) {
  const options = SUBDIVISION_PREFS.map((v) => ({ value: v, label: SUBDIVISION_LABEL[v], disabled }));
  return (
    <div className={['subdiv', disabled ? 'disabled' : '', className ?? ''].filter(Boolean).join(' ')}>
      <Segmented<SubdivisionPref> label="박 분할" className="subdiv-seg" options={options} value={value} onChange={onChange} />
      <div className="subdiv-hint-row">
        <p className="subdiv-hint">{subdivisionHint(value, bpm, place)}</p>
        {previewPlace && <PreviewDots place={previewPlace} />}
      </div>
    </div>
  );
}

/** 예시 소리의 박 표시(두 박). 그 자리에서 울리는 동안만 보이고 정박에 맞춰 하나씩 켜진다 */
export function PreviewDots({ place }: { place: PreviewPlace }) {
  const snap = useSyncExternalStore(metronomePreview.subscribe, metronomePreview.getSnapshot, metronomePreview.getSnapshot);
  const live = snap.place === place;
  return (
    <span className={live ? 'subdiv-dots live' : 'subdiv-dots'} aria-hidden="true">
      <i className={live && snap.beat === 0 ? 'on' : undefined} />
      <i className={live && snap.beat === 1 ? 'on' : undefined} />
    </span>
  );
}

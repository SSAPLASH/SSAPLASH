// 키 매핑 카드. 키보드는 스틱 도착 전까지의 임시 입력이라 한 컴포넌트로 격리해 둔다.
// VITE_KEYBOARD_INPUT=false로 빌드하면 이 카드와 키보드 소스 등록이 함께 빠진다(app/sources.ts).
import { useEffect, useState } from 'react';
import { useSettings } from '@/store/settingsStore';
import { LANE_ORDER, PAD_META, type PadId } from '@/domain/pads';

export function KeyboardMappingCard() {
  const keyMap = useSettings((s) => s.keyMap);
  const bindKey = useSettings((s) => s.bindKey);
  const unbindKey = useSettings((s) => s.unbindKey);
  const resetKeyMap = useSettings((s) => s.resetKeyMap);
  const [bindTarget, setBindTarget] = useState<{ pad: PadId; stickId: 0 | 1 } | null>(null);

  useEffect(() => {
    if (!bindTarget) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setBindTarget(null);
        return;
      }
      bindKey(e.code, bindTarget.pad, bindTarget.stickId);
      setBindTarget(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [bindTarget, bindKey]);

  return (
    <div className="card col">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>키 매핑</h3>
        <span className="small faint">임시 입력 (개발용)</span>
      </div>
      <p className="small dim">
        "추가"를 누른 뒤 키를 누르면 바인딩됩니다. 왼손 키는 스틱 0, 오른손 키는 스틱 1로 기록됩니다. Esc로 취소.
      </p>
      <div className="keymap-list">
        {LANE_ORDER.map((pad) => {
          const keys = Object.entries(keyMap).filter(([, b]) => b.pad === pad);
          const active = bindTarget?.pad === pad;
          return (
            <div key={pad} className={`keymap-row ${active ? 'active' : ''}`}>
              <span className="swatch" style={{ background: PAD_META[pad].color }} />
              <span>{PAD_META[pad].label}</span>
              <span className="keys">
                {keys.map(([code, b]) => (
                  <button key={code} title="클릭하면 해제" onClick={() => unbindKey(code)}>
                    <kbd className="kbd" style={{ borderColor: b.stickId === 0 ? 'var(--left)' : 'var(--right)' }}>
                      {code.replace('Key', '').replace('Digit', '')}
                    </kbd>
                  </button>
                ))}
                {active && <span className="small dim">키를 누르세요…</span>}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <button className="small" onClick={() => setBindTarget({ pad, stickId: 0 })}>
                  왼손 추가
                </button>
                <button className="small" onClick={() => setBindTarget({ pad, stickId: 1 })}>
                  오른손 추가
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <div>
        <button className="btn-ghost small" onClick={resetKeyMap}>
          기본 매핑으로
        </button>
      </div>
    </div>
  );
}

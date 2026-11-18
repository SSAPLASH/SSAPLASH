// 입력 소스 디스크립터가 선언한 설정 항목·동작 버튼을 그리는 공용 패널.
// 소스별 전용 UI는 없다 — 새 소스는 디스크립터만 등록하면 여기에 그대로 나타난다.
import { useEffect, useState } from 'react';
import { useSettings } from '@/store/settingsStore';
import { resolveOptions, sensorRegistry } from '@/runtime/sensorRegistry';
import type { OptionSpec } from '@/input/source/SourceDescriptor';
import type { OptionValue, SensorId } from '@/domain/events';

const keyName = (code: string) => code.replace('Key', '').replace('Digit', '');

/** "키를 누르세요" 캡처 입력. 클릭 후 누른 키가 값이 된다(Esc 취소) */
function KeyCapture(props: { value: string; onChange: (code: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  const { onChange } = props;

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation(); // 캡처하는 키가 소스의 타격으로 새지 않게
      if (e.code !== 'Escape') onChange(e.code);
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturing, onChange]);

  return (
    <span className="row" style={{ gap: 8 }}>
      <kbd className="kbd">{keyName(props.value)}</kbd>
      <button className="small" onClick={() => setCapturing(true)}>
        변경
      </button>
      {capturing && <span className="small dim">키를 누르세요… (Esc 취소)</span>}
    </span>
  );
}

function OptionControl(props: { spec: OptionSpec; value: OptionValue; onChange: (v: OptionValue) => void }) {
  const { spec, value, onChange } = props;
  if (spec.type === 'key') return <KeyCapture value={String(value)} onChange={onChange} />;
  if (spec.type === 'boolean') {
    return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (spec.type === 'number') {
    return (
      <input
        type="number"
        value={Number(value)}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(e) => onChange(+e.target.value)}
      />
    );
  }
  return <input type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} />;
}

export function SensorOptionsPanel(props: { id: SensorId }) {
  const stored = useSettings((s) => s.sensorOptions[props.id]);
  const setOption = useSettings((s) => s.setSensorOption);
  const desc = sensorRegistry.get(props.id);
  if (!desc) return null;

  const values = resolveOptions(desc, stored);
  const avail = desc.availability();

  return (
    <div className="col">
      {!avail.ok && <div className="notice error">{avail.reason}</div>}
      {desc.options?.map((spec) => (
        <div className="field" key={spec.key}>
          <label>{spec.label}</label>
          <OptionControl spec={spec} value={values[spec.key]} onChange={(v) => setOption(desc.id, spec.key, v)} />
          {spec.hint && <p className="small faint">{spec.hint}</p>}
        </div>
      ))}
      {desc.actions && (
        <div className="row">
          {desc.actions.map((a) => (
            <button
              key={a.label}
              className={a.variant === 'primary' ? 'btn-primary' : undefined}
              onClick={() => a.run(sensorRegistry.instance(desc.id)).catch(() => {})}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {desc.note && <p className="small faint">{desc.note}</p>}
    </div>
  );
}

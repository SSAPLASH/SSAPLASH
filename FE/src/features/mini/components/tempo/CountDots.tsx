// 점 묶음 — 예비 박(8)과 친 횟수(16)를 센다. 점은 장식이고 읽는 글은 「n / 합계」 하나다.
// 4개씩 묶어 박 단위로 보이게 한다.

const GROUP_SIZE = 4;

interface Props {
  /** 점의 수(예비 박 8, 타격 16) */
  total: number;
  /** 켜진 점의 수 */
  filled: number;
  /** 무엇을 세는지(「예비 박」·「친 횟수」). 화면 낭독기가 읽는 이름 */
  label: string;
}

export function CountDots({ total, filled, label }: Props) {
  const safeTotal = Math.max(0, Math.floor(total));
  const on = Math.min(safeTotal, Math.max(0, Math.floor(filled)));
  const groupCount = Math.ceil(safeTotal / GROUP_SIZE);

  return (
    <div className="mini-tempo-dots" role="group" aria-label={label}>
      <div className="mini-tempo-dot-row" aria-hidden="true">
        {Array.from({ length: groupCount }, (_, g) => (
          <span key={g} className="mini-tempo-dot-group">
            {Array.from({ length: Math.min(GROUP_SIZE, safeTotal - g * GROUP_SIZE) }, (_, k) => {
              const isOn = g * GROUP_SIZE + k < on;
              return (
                <span
                  key={k}
                  className={`mini-tempo-dot ${isOn ? 'is-on' : 'is-off'}`}
                  data-state={isOn ? 'on' : 'off'}
                />
              );
            })}
          </span>
        ))}
      </div>
      <span className="mini-tempo-count" data-testid="mini-tempo-count">
        {on} / {safeTotal}
      </span>
    </div>
  );
}

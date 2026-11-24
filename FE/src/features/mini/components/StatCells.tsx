// 숫자 칸 묶음 (Figma cells). 둥근 판 안에 세로 구분선으로 나뉜 칸. 안내와 결과가 같이 쓴다. 칸 수는 3이 아니어도 된다.
export interface StatCell {
  label: string;
  value: string;
  unit?: string;
  /** 값 아래 한 줄 */
  note?: string;
}

interface Props {
  cells: readonly StatCell[];
}

export function StatCells({ cells }: Props) {
  return (
    <dl className="mini-cells">
      {cells.map((cell) => (
        <div key={cell.label} className="mini-cell">
          <dt className="mini-cell-label">{cell.label}</dt>
          <dd className="mini-cell-value">
            <span>{cell.value}</span>
            {cell.unit ? <span className="mini-cell-unit">{cell.unit}</span> : null}
          </dd>
          {cell.note ? <dd className="mini-cell-note">{cell.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

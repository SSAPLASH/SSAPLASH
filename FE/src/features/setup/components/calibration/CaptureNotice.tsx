// 보정 팝업 첫 안내(PLAY-004 후속): 팝업이 열리면 드럼 그림 한가운데에 큰 글씨 두 줄을 겹쳐 띄운다.
// 강조할 말(같은 지점 · 스틱과 손목의 각도)만 은은한 네온 색, 나머지는 은은한 네온 화이트(setup.css .cal-notice).
// 보정은 뒤에서 그대로 진행된다. 떠 있는지는 useCaptureNotice가 정하고(첫 수락 타격 + 최소 표시 시간 뒤 닫힘) 여기서는 그리기만 한다.

/** 안내 두 줄. em = 네온 색으로 강조할 말 */
const NOTICE_LINES: ReadonlyArray<ReadonlyArray<{ text: string; em?: boolean }>> = [
  [{ text: '양 스틱 모두 ' }, { text: '동일한 지점', em: true }, { text: '을 타격해 주세요.' }],
  [{ text: '타격 시 ' }, { text: '스틱과 손목의 각도', em: true }, { text: '가 패드 형성에 반영됩니다.' }],
];

export function CaptureNotice({ open }: { open: boolean }) {
  return (
    <div className="cal-notice" data-open={open} aria-hidden={!open} data-testid="cal-notice">
      {NOTICE_LINES.map((line, i) => (
        <p key={i} className={i === 0 ? 'cal-notice-main' : 'cal-notice-sub'}>
          {line.map((seg) => (seg.em ? <em key={seg.text}>{seg.text}</em> : seg.text))}
        </p>
      ))}
    </div>
  );
}

// 내 곡 화면 알림 한 줄 (설계 CHART-001 4-2, U8). 곡 삭제 완료처럼 화면을 떠나지 않는 결과를 알린다.
// 보이는 시간은 호출자가 정한다(text를 null로 바꾸면 사라진다). 다른 화면에서도 쓰게 되면 앱 공용으로 옮긴다.

interface Props {
  text: string | null;
}

export function StudioToast({ text }: Props) {
  // 화면 읽기 프로그램이 새 문구를 읽도록 영역은 항상 두고 내용만 바꾼다
  return (
    <div className="studio-toast-region" role="status" aria-live="polite">
      {text && <div className="studio-toast">{text}</div>}
    </div>
  );
}

// 내 곡 화면 알림 한 줄 (설계 CHART-001 4-2, U8). 곡 삭제 완료처럼 화면을 떠나지 않는 결과를 알린다.
// 모양은 공용 Toast(info)가 맡고, 이 파일은 하단 중앙 고정 위치(.studio-toast-region)만 정한다.
// 보이는 시간은 호출자가 정한다(text를 null로 바꾸면 사라진다).
import { Toast } from '@/components/ui/feedback/Toast';
import './studio.css';

interface Props {
  text: string | null;
}

export function StudioToast({ text }: Props) {
  return <Toast variant="info" text={text} regionClassName="studio-toast-region" />;
}

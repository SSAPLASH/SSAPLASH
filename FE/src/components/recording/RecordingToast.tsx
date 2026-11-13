// 녹음 알림 토스트 (설계 REC-001 3-6·6-2). 스토어의 notice를 한 번 꺼내 4초 동안 보인다.
import { useEffect, useRef, useState } from 'react';
import { consumeNotice, useRecordingStore, type RecordingNotice } from '@/runtime/recordingStore';
import { Toast } from '@/components/ui/feedback/Toast';
import { toastContent } from './toastContent';
import './recording.css';

const TOAST_MS = 4000;

export function RecordingToast() {
  const [shown, setShown] = useState<RecordingNotice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const take = () => {
      const n = consumeNotice();
      if (!n) return;
      setShown(n);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(null), TOAST_MS);
    };
    // 마운트 전에 쌓인 알림도 비동기로 꺼낸다
    const initial = setTimeout(take, 0);
    const unsubscribe = useRecordingStore.subscribe((s, prev) => {
      if (s.notice && s.notice !== prev.notice) take();
    });
    return () => {
      clearTimeout(initial);
      unsubscribe();
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const content = shown ? toastContent(shown) : null;
  return <Toast variant={content?.variant ?? 'info'} text={content?.text ?? null} regionClassName="rec-toast-region" />;
}

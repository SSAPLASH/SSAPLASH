// 입문 코스 상태 (Jira 331, 설계 SETUP-입문-코스 2장). 진도의 원본은 서버다. 여기서는 목록과
// 이번 접속에서 통과한 레슨(업로드·저장이 늦어도 다음 스테이지를 열어 두려고), 권유 카드 닫기만 들고 있다.
import { create } from 'zustand';
import { fetchLessons } from '@/api/play/lessons';
import type { LessonList } from '@/domain/play/lesson';

/** 권유 카드를 닫았는지(브라우저마다). 진도가 아니라 표시 편의라 서버에 두지 않는다 */
const DISMISS_KEY = 'airdrum.lessonInvite.dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export type LessonStatus = 'idle' | 'loading' | 'ready' | 'error';

interface LessonState {
  status: LessonStatus;
  list: LessonList | null;
  /** 이번 접속에서 통과한 레슨의 곡 id */
  localPassed: ReadonlySet<number>;
  inviteDismissed: boolean;
  /** 목록을 읽는다. 진행 중이면 무시한다. force가 아니면 이미 읽은 목록을 그대로 둔다 */
  load: (force?: boolean) => Promise<void>;
  markPassed: (songId: number) => void;
  dismissInvite: () => void;
  resetForTest: () => void;
}

let active: AbortController | null = null;

export const useLessons = create<LessonState>((set, get) => ({
  status: 'idle',
  list: null,
  localPassed: new Set(),
  inviteDismissed: readDismissed(),
  load: async (force = false) => {
    const { status } = get();
    if (status === 'loading' || (!force && status === 'ready')) return;
    const ac = new AbortController();
    active = ac;
    set({ status: 'loading' });
    try {
      const list = await fetchLessons(ac.signal);
      if (active === ac) set({ status: 'ready', list });
    } catch {
      if (active === ac) set({ status: 'error' });
    }
  },
  markPassed: (songId) => set((s) => (s.localPassed.has(songId) ? s : { localPassed: new Set([...s.localPassed, songId]) })),
  dismissInvite: () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // 저장이 막힌 환경에서는 이번 접속에서만 닫는다
    }
    set({ inviteDismissed: true });
  },
  resetForTest: () => {
    active?.abort();
    active = null;
    set({ status: 'idle', list: null, localPassed: new Set(), inviteDismissed: readDismissed() });
  },
}));

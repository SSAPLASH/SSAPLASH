// 미니게임 「정적 뒤 한 방」의 이벤트 스위치 (설계 MODE-006-minigame-oneshot D19).
// 빌드 값 VITE_MINI_ONESHOT_AUDIO에 음원 폴더 주소를 주면 켜진다. 켜기와 음원 위치를 한 값으로 두어, 스위치만 켜고 음원 주소를 빼먹는 일이 없다.
// 비어 있으면 카드도 경로도 없다. 화면 청크를 빌드에서 빼는 일은 app/App.tsx가 빌드 값을 직접 읽어 한다(동적 import를 감싸야 해서).
const raw = String(import.meta.env.VITE_MINI_ONESHOT_AUDIO ?? '').trim();

/** 음원 파일이 있는 폴더의 주소. 로컬에서는 `/event-audio`. 꺼져 있으면 null */
export const ONE_SHOT_AUDIO_BASE: string | null = raw === '' ? null : raw;

/** 이 빌드에 「정적 뒤 한 방」이 들어 있는가 */
export const ONE_SHOT_ENABLED = ONE_SHOT_AUDIO_BASE !== null;

// 「정적 뒤 한 방」의 곡 표 (설계 MODE-006-minigame-oneshot 3절). 곡마다 음원 파일과, 그 파일 안에서 노래가 끊기는 위치·드럼이 들어오는 위치를 적는다.
// 음원은 저장소에 없다(권리자의 사용 허락을 받지 않은 원곡 구간이라 이벤트 환경에만 둔다). 여기에는 숫자만 있다.
// 곡을 더하려면 음원 파일을 마련하고 표에 한 줄을 더한다. 그러면 곡 고르기와 곡별 기록이 같이 나타난다.

export interface OneShotSong {
  /** 기록의 갈래와 같다. 한 번 정하면 바꾸지 않는다 */
  id: string;
  name: string;
  artist: string;
  /** 음원 폴더 안의 파일 이름 */
  file: string;
  /** 파일 전체 길이(ms). 받은 파일이 맞는지 보는 데 쓴다 */
  durationMs: number;
  /** 파일 처음부터 노래가 끊기는 위치(ms). 이보다 이른 타격이 「정적 전에 침」이다 */
  restStartMs: number;
  /** 파일 처음부터 드럼이 시작되는 위치(ms). 정답 위치이자 앞부분과 뒷부분을 나누는 자리다 */
  answerMs: number;
  /** 뒷부분(드럼 한 방과 후렴)을 트는 길이(ms) */
  tailMs: number;
}

/** 받은 음원의 길이가 곡 표와 이만큼 넘게 다르면 다른 파일로 본다(D21) */
export const CLIP_TOLERANCE_MS = 50;

/**
 * 곡 목록. 표의 순서가 고르기와 카드의 순서다.
 * 주의: 아래 길이·정적 시작·정답 위치는 음원 파일을 받기 전의 임시 값이다(설계 N1). 파일이 오면 파형에서 잰 값으로 바꾼다.
 * 그때까지는 맞는 파일을 넣어도 길이 검사나 판정이 어긋날 수 있다
 */
export const ONE_SHOT_SONGS: readonly OneShotSong[] = [
  {
    id: 'iwaly',
    name: 'I Will Always Love You',
    artist: 'Whitney Houston',
    file: 'iwaly.wav',
    durationMs: 20500,
    restStartMs: 10000,
    answerMs: 12500,
    tailMs: 8000,
  },
];

/** 기록의 갈래로 쓰는 곡 id와 이름(목록 표·카드 꼬리말) */
export const ONE_SHOT_VARIANTS: readonly { id: string; name: string }[] = ONE_SHOT_SONGS.map(({ id, name }) => ({ id, name }));

/** 곡 표에 있는 곡 id인가 */
export function isOneShotSongId(id: unknown): id is string {
  return typeof id === 'string' && ONE_SHOT_SONGS.some((song) => song.id === id);
}

/** 곡. 모르는 id면 첫 곡 */
export function songById(id: string | null | undefined): OneShotSong {
  return ONE_SHOT_SONGS.find((song) => song.id === id) ?? ONE_SHOT_SONGS[0];
}

/** 음원 파일의 주소. 폴더 주소 끝의 `/`를 정리해 파일 이름을 붙인다 */
export function songUrl(base: string, song: Pick<OneShotSong, 'file'>): string {
  return `${base.replace(/\/+$/, '')}/${song.file}`;
}

/** 받은 음원의 길이가 곡 표와 맞는가(차이 50ms 이하) */
export function clipMatches(song: Pick<OneShotSong, 'durationMs'>, clipMs: number): boolean {
  return Number.isFinite(clipMs) && Math.abs(clipMs - song.durationMs) <= CLIP_TOLERANCE_MS;
}

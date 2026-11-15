// 연주 기록(PlayLog)의 데이터 모양. 저장·조립은 engine/playLog, 이 모양을 읽는 계산은 domain이 한다.
import type { HihatPedalCoverage } from '@/domain/kit/device/hihatPedalCoverage';
import type { Judgement, TimingWindows } from './judgement';
import type { InputSourceKind } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';

export interface LoggedHit {
  hitId: number;
  /** null = 손 없음(페달 타격) */
  stickId: 0 | 1 | null;
  pad: PadId | null;
  hihatClosed?: boolean | null;
  velocity: number;
  tHit: number;
  tRecv: number;
  tResolved: number;
  tAudio?: number;
  judgement?: Judgement;
  matchedNoteIndex?: number;
  deltaMs?: number;
  distanceDeg?: number;
  /** 판정 처리 순번(업로드 hits.seq). 이전 로그에는 없다 */
  seq?: number;
  /** 판정에 쓴 곡 시각(ms, 오디오 오프셋 반영). 이전 로그에는 없다 */
  tSongMs?: number;
  /** 이 타격의 입력 경로(스틱 세션에 섞인 키보드 킥 구분). 이전 로그에는 없다 */
  source?: InputSourceKind;
  /** 센서 수집값. 키보드 타격은 업로드에서 null로 보낸다 */
  peakAccel?: number;
  pitch?: number;
  yaw?: number;
}

export interface LogNote {
  index: number;
  timeMs: number;
  pad: PadId;
  hihatOpen?: true;
  judgement: Judgement | null;
  deltaMs: number | null;
  /** BE 채보 노트 id. 내장 채보·이전 로그는 없다 */
  noteId?: string | null;
  /** MISS 판정 처리 순번. 그 밖은 null(타격 쪽 seq를 쓴다) */
  seq?: number | null;
}

/** 서버 업로드 상태 (설계 COACH-002 D2). 실패해도 로그는 지우지 않고 같은 playId로 재전송한다 */
export interface PlayUploadState {
  status: 'UPLOADING' | 'DONE' | 'FAILED' | 'SKIPPED';
  /** SKIPPED 사유 또는 실패 오류 코드 */
  reason: string | null;
  /** FAILED일 때 같은 본문으로 다시 보내도 되는지 */
  retryable: boolean;
  attempts: number;
  /** 처음 조립한 업로드 본문. 재전송은 이것을 그대로 보낸다. DONE이면 지운다 */
  body?: unknown;
  updatedAt: string;
}

/** 실시간 코칭이 띄운 문구 기록. coach 모듈의 로그 항목과 모양이 같다(engine은 coach를 import하지 않는다) */
export interface LiveCoachEvent {
  tMs: number;
  tag: string;
  text: string;
}

export interface PlayLog {
  playId: string;
  songId: string;
  title: string;
  difficulty: string;
  mode: 'RHYTHM' | 'FREE' | 'SHEET';
  inputSource: InputSourceKind;
  hihatPedalCoverage?: HihatPedalCoverage;
  startedAt: string;
  durationMs: number;
  timing: TimingWindows;
  calibrationId: string | null;
  /** BE 채보 버전. 내장 채보는 null (이전 로그에는 필드가 없을 수 있다) */
  chartVersionId: number | null;
  /** BE 곡 id(숫자). 내장 채보는 null */
  songNumericId: number | null;
  /** BE 채보 id. "다시 하기" URL 복원용 */
  chartId: number | null;
  /** 연주 당시 적용 중이던 프리셋 */
  presetId: string | null;
  /** 플레이 시작 시점의 연주 기록 활용 동의(설계 COACH-003 D18). 이전 로그에는 없다 → 업로드는 false */
  consent?: boolean;
  /**
   * 연습 속도 배율(0.5~1, 설계 MODE-003-practice-speed). 없으면 1.
   * 1이 아니어도 위치를 나타내는 값(notes.timeMs·hits.tSongMs·코칭 tMs·lastSongTimeMs·durationMs·bpm·offsetMs)은
   * 원래 채보의 축(곡 시각)이고, 오차·판정 폭(deltaMs·timing)과 경과 시간은 실제 시간이다
   */
  playbackRate?: number;
  /** 채보 BPM·박자(마디 단위 피드백용). 이전 로그에는 없을 수 있다 */
  bpm: number;
  beatsPerBar: number;
  /** 채보 격자 원점(1마디 1박, ms). 결과 화면 약점 마디·미니 악보가 쓴다. 이전 로그에는 없고 0으로 읽는다 */
  offsetMs?: number;
  hits: LoggedHit[];
  notes: LogNote[];
  summary: {
    score: number;
    maxScore: number;
    accuracy: number;
    maxCombo: number;
    counts: Record<Judgement, number>;
    strayHits: number;
  };
  /** 아래는 업로드용. 이전 로그에는 없다 */
  endedAt?: string;
  /** 판정에 적용한 오디오 출력 오프셋(ms) */
  audioOffsetMs?: number;
  /** 발 타격에 적용한 킥 오프셋(ms). 옛 로그에는 없다 */
  kickOffsetMs?: number;
  /** 종료 시 곡 시각, 일시정지를 뺀 카운트인 포함 경과(ms) */
  lastSongTimeMs?: number;
  elapsedActiveMs?: number;
  /** BE 채보 전체 노트 수. notes.length와 다르면 변환에서 버린 노트가 있다 */
  sourceNoteCount?: number | null;
  /** 실시간 코칭 기록. 이전 로그에는 없다(업로드 본문은 빈 배열) */
  liveCoachEvents?: LiveCoachEvent[];
  upload?: PlayUploadState;
}

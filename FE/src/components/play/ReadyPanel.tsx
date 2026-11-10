// 연주 준비 (Figma 223:3812 준비 완료 · 223:4163 준비 필요 · ReadyCheck 222:856). 곡 카드(커버 120·연습 단계 고르기) · 기기 준비 카드 · 시작 줄 · 오른쪽 미리 쳐 보기.
// props만 받는다 — 준비 조건 계산(useReadiness)·스토어 구독·이동은 페이지가 한다. 동의 카드는 없다(설계 U19).
// Enter = 시작은 페이지 전역 핸들러가 맡는다(여기서 중복 처리하지 않는다).
import type { ReactNode } from 'react';
import type { Difficulty } from '@/domain/chart';
import type { ReadinessMissing } from '@/domain/readiness';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SongCover } from '@/components/song/SongCover';
import { LevelBadge } from '@/components/song/LevelBadge';
import { SongMeta } from '@/components/song/SongMeta';
import { DrumKit } from '@/components/drum/DrumKit';
import type { RealignInfo } from '@/components/calibration/RealignPrompt';
import { DeviceCheck } from './DeviceCheck';
import { usePadHitSeq, usePadStates } from '@/components/drum/usePadStates';
import { formatDuration } from '@/components/formatTime';
import { artistLabel } from '@/domain/songCatalog';
import { formatAccuracy } from '@/engine/playLog';
import { useSettings } from '@/store/settingsStore';
import './ready.css';

export interface ReadyPanelProps {
  song: { title: string; artist: string; coverUrl: string | null; bpm: number; durationSec?: number };
  /** 메타 줄 앞머리: "리듬 게임" · "악보 연습" */
  modeLabel: string;
  /** 연습 단계(채보). 쉬움 → 어려움 순으로 넘긴다 */
  charts: { id: number; difficulty: Difficulty }[];
  selectedChartId: number;
  /** 고른 연습 단계의 최고 정확도(0~1). 없으면 "—" */
  bestAccuracy?: number;
  /** 준비 조건 결과(domain/readiness). missing이 비면 준비 완료 */
  ready: boolean;
  missing: ReadinessMissing[];
  /** 왼손·오른손 스틱 연결. keyboardOnly면 연결 줄을 키보드 입력으로 보인다 */
  connected: [boolean, boolean];
  keyboardOnly?: boolean;
  /** 페달 연결 여부. undefined면 P 점·문구를 그리지 않는다(동글이 아닌 소스·키보드 전용) */
  pedal?: boolean;
  presetName: string | null;
  /** 카운트다운 켬(1)·끔(0). 안내 문구용 */
  countInBars: number;
  onBack: () => void;
  onSelectChart: (chartId: number) => void;
  /** 드럼 세팅으로 이동(복귀 규칙은 페이지가 정한다) */
  onSetup: () => void;
  /** 있을 때만 [다시 연결]을 보인다 */
  onReconnect?: () => void;
  onStart: () => void;
  /** 스네어 재정렬이 걸려 있으면 「보정」 행에 프롬프트를 보인다(PLAY-004 D11). 준비 완료·[시작]은 막지 않는다 */
  realign?: RealignInfo | null;
  /** 두 열 아래 전체 폭에 그대로 넣는 슬롯(비슷한 곡 줄, 설계 COACH-004-similar-songs D9) */
  footer?: ReactNode;
}

export function ReadyPanel({
  song,
  modeLabel,
  charts,
  selectedChartId,
  bestAccuracy,
  ready,
  missing,
  connected,
  keyboardOnly = false,
  pedal,
  presetName,
  countInBars,
  onBack,
  onSelectChart,
  onSetup,
  onReconnect,
  onStart,
  realign,
  footer,
}: ReadyPanelProps) {
  const padStates = usePadStates();
  const hitSeq = usePadHitSeq();
  const kitSkin = useSettings((s) => s.kitSkin);
  const meta = [modeLabel, `BPM ${Math.round(song.bpm)}`];
  if (song.durationSec !== undefined) meta.push(formatDuration(song.durationSec * 1000));
  meta.push(`최고 정확도 ${bestAccuracy === undefined ? '—' : formatAccuracy(bestAccuracy)}`);

  return (
    <section className="play-rp" aria-label="연주 준비">
      <header className="play-rp-head">
        <Button variant="text" size="sm" onClick={onBack}>
          ← 곡 선택
        </Button>
        <h2 className="play-rp-title">연주 준비</h2>
      </header>
      <div className="play-rp-body">
        <div className="play-rp-main">
          <Card padding="md" className="play-rp-song">
            <SongCover coverUrl={song.coverUrl} className="play-rp-cover" />
            <div className="play-rp-song-info">
              <h3 className="play-rp-song-title">{song.title}</h3>
              <SongMeta artist={artistLabel(song.artist)} />
              <p className="play-rp-song-meta">{meta.join(' · ')}</p>
              <div className="play-rp-levels" role="group" aria-label="연습 단계">
                {charts.map((c) => (
                  <LevelBadge
                    key={c.id}
                    level={c.difficulty}
                    selected={c.id === selectedChartId}
                    onClick={() => onSelectChart(c.id)}
                  />
                ))}
              </div>
            </div>
          </Card>

          <DeviceCheck
            ready={ready}
            missing={missing}
            connected={connected}
            keyboardOnly={keyboardOnly}
            pedal={pedal}
            presetName={presetName}
            realign={realign}
            onSetup={onSetup}
            onReconnect={onReconnect}
          />

          <div className="play-rp-start">
            <Button className="play-rp-start-btn" disabled={!ready} onClick={onStart}>
              시작 (Enter)
            </Button>
            <p className={`play-rp-hint${ready ? '' : ' need'}`}>
              {ready
                ? countInBars > 0
                  ? '시작하면 5초 카운트다운과 준비 1마디 뒤 노트가 시작돼요.'
                  : '시작하면 바로 노트가 시작돼요.'
                : '기기 준비가 끝나면 시작할 수 있어요.'}
            </p>
          </div>
        </div>

        <div className="play-rp-side">
          <Card padding="md" className="play-rp-preview" title="미리 쳐 보기">
            <div className="play-rp-kit">
              <DrumKit fitWidth states={padStates} skin={kitSkin} hitSeq={hitSeq} />
            </div>
            <p className="play-rp-caption">쳐 보면 소리만 나요. 기록은 남지 않아요.</p>
          </Card>
        </div>
      </div>
      {footer}
    </section>
  );
}

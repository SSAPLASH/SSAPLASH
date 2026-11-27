// 미니게임 목록 화면 (설계 MODE-006-minigame-speed D15, MODE-006-minigame-list-ui). 고른 게임을 큰 카드(MiniHero)로 보이고,
// 그 아래 목록 표의 게임마다 고르기 카드(MiniCard)를 그린다. 저장된 최고 기록을 같이 보인다.
// 고른 게임의 기준은 주소 값 `game`이다(D4) — 따로 상태를 두지 않는다. 값이 없거나 이 빌드에 없는 게임이면 첫 게임이다.
// 그림은 부품이라 게임 id로 여기서 고른다. 게임 진행은 하지 않는다.
import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useShell } from '@/components/shell/nav/useShell';
import { buttonClassName } from '@/components/ui/action/buttonStyle';
import { ONE_SHOT_ENABLED } from '@/config/miniOneShot';
import { MINI_GAME_PARAM, miniGamePath, parseMiniGameId, type MiniGameId } from '@/domain/play/miniGame';
import { PLAY_PATH } from '@/domain/song/sheetCategory';
import { CrescendoArt } from '@/features/mini/components/crescendo/CrescendoArt';
import { DynamicsArt } from '@/features/mini/components/dynamics/DynamicsArt';
import { MiniCard } from '@/features/mini/components/MiniCard';
import { MiniHero } from '@/features/mini/components/MiniHero';
import { OneShotArt } from '@/features/mini/components/oneshot/OneShotArt';
import { SightArt } from '@/features/mini/components/sight/SightArt';
import { SpeedArt } from '@/features/mini/components/speed/SpeedArt';
import { TempoArt } from '@/features/mini/components/tempo/TempoArt';
import { MINI_CATALOG, selectedGame } from '@/features/mini/domain/miniCatalog';
import { cardRecord, heroRecords } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import './mini.css';

/** 게임 id → 그림(카드용 작은 것, 큰 카드용 큰 것). 뒤의 게임이 한 줄을 더한다 */
const ART: Record<MiniGameId, { card: ReactNode; hero: ReactNode }> = {
  speed: { card: <SpeedArt size="card" />, hero: <SpeedArt size="hero" /> },
  dynamics: { card: <DynamicsArt size="card" />, hero: <DynamicsArt size="hero" /> },
  sight: { card: <SightArt size="card" />, hero: <SightArt size="hero" /> },
  tempo: { card: <TempoArt size="card" />, hero: <TempoArt size="hero" /> },
  crescendo: { card: <CrescendoArt size="card" />, hero: <CrescendoArt size="hero" /> },
  oneshot: { card: <OneShotArt size="card" />, hero: <OneShotArt size="hero" /> },
};

/** 목록에 보일 게임. 「정적 뒤 한 방」은 이벤트 스위치가 켜진 빌드에서만 보인다 */
const GAMES = MINI_CATALOG.filter((info) => info.id !== 'oneshot' || ONE_SHOT_ENABLED);

export function MiniListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const records = useMiniRecords((s) => s.records);
  useShell({ title: '미니게임' });

  // 다른 탭에서 바뀐 기록도 열 때 한 번 다시 읽는다
  useEffect(() => {
    useMiniRecords.getState().reload();
  }, []);

  const chosen = selectedGame(GAMES, parseMiniGameId(params.get(MINI_GAME_PARAM)));
  // 고른 게임을 주소에 남긴다. 고르는 동안에는 방문 기록을 쌓지 않는다(곡 고르기의 범위와 같은 규칙)
  const select = (id: MiniGameId) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(MINI_GAME_PARAM, id);
        return next;
      },
      { replace: true },
    );
  };
  const start = (id: MiniGameId) => navigate(miniGamePath(id));

  return (
    <main className="main mini-page mini-list">
      <Link to={PLAY_PATH} className={`${buttonClassName({ variant: 'text', size: 'sm' })} mini-back`}>
        ← 리듬 게임
      </Link>
      <header className="mini-list-head">
        <h2 className="mini-headline">가볍게 한 판?</h2>
        <p className="mini-lede">한 판에 30초면 충분해요. 혼자 기록을 깨거나, 친구와 번갈아 겨뤄 보세요.</p>
      </header>
      <div className="mini-list-body">
        <MiniHero
          info={chosen}
          rows={heroRecords(records, chosen.id, chosen.variants)}
          art={ART[chosen.id].hero}
          onStart={() => start(chosen.id)}
        />
        <ul className="mini-grid" aria-label="게임 고르기">
          {GAMES.map((info) => {
            const card = cardRecord(records, info.id, info.variants);
            return (
              <li key={info.id} className="mini-grid-item">
                <MiniCard
                  info={info}
                  record={card?.record ?? null}
                  variantName={card?.variantName}
                  art={ART[info.id].card}
                  selected={info.id === chosen.id}
                  onSelect={() => select(info.id)}
                  onOpen={() => start(info.id)}
                />
              </li>
            );
          })}
        </ul>
        <p className="mini-list-note">기록은 이 기기에 계정별로 저장돼요.</p>
      </div>
    </main>
  );
}

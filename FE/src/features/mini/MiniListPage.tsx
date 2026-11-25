// 미니게임 목록 화면 (Figma 1181:37608, 설계 MODE-006-minigame-speed D15). 목록 표의 게임마다 카드를 그리고, 저장된 최고 기록을 보인다.
// 그림은 부품이라 게임 id로 여기서 고른다. 게임 진행은 하지 않는다.
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShell } from '@/components/shell/nav/useShell';
import { miniGamePath, type MiniGameId } from '@/domain/play/miniGame';
import { DynamicsArt } from '@/features/mini/components/dynamics/DynamicsArt';
import { MiniCard } from '@/features/mini/components/MiniCard';
import { SightArt } from '@/features/mini/components/sight/SightArt';
import { SpeedArt } from '@/features/mini/components/speed/SpeedArt';
import { MINI_CATALOG } from '@/features/mini/domain/miniCatalog';
import { cardRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from '@/features/mini/store/miniRecordStore';
import './mini.css';

/** 게임 id → 카드 그림. 뒤의 게임이 한 줄을 더한다 */
const CARD_ART: Record<MiniGameId, ReactNode> = {
  speed: <SpeedArt size="card" />,
  dynamics: <DynamicsArt size="card" />,
  sight: <SightArt size="card" />,
};

export function MiniListPage() {
  const navigate = useNavigate();
  const records = useMiniRecords((s) => s.records);
  useShell({ title: '미니게임' });

  // 다른 탭에서 바뀐 기록도 열 때 한 번 다시 읽는다
  useEffect(() => {
    useMiniRecords.getState().reload();
  }, []);

  return (
    <main className="main mini-page">
      <header className="mini-list-hero">
        <h2 className="mini-headline">
          <span>가볍게 한 판.</span>
          <span>기록은 진지하게.</span>
        </h2>
        <p className="mini-lede">한 판에 30초면 충분해요. 혼자 기록을 깨거나, 친구와 번갈아 겨뤄 보세요.</p>
      </header>
      <ul className="mini-grid">
        {MINI_CATALOG.map((info) => {
          const card = cardRecord(records, info.id, info.variants);
          return (
            <li key={info.id} className="mini-grid-item">
              <MiniCard
                info={info}
                record={card?.record ?? null}
                variantName={card?.variantName}
                art={CARD_ART[info.id]}
                onStart={() => navigate(miniGamePath(info.id))}
              />
            </li>
          );
        })}
      </ul>
    </main>
  );
}

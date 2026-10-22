import { Link } from 'react-router-dom';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';
import { sensorRegistry } from '@/app/sensorRegistry';
import { isProfileComplete } from '@/domain/calibration';
import { KEYBOARD_INPUT_ENABLED } from '@/app/sources';
import { KEY_MAP } from '@/domain/keyMap';
import { STICK_PADS, PAD_META, LANE_ORDER } from '@/domain/pads';

export function HomePage() {
  const sensorKind = useSettings((s) => s.sensorKind);
  const profile = useSettings((s) => s.profile);
  const connected = useLive((s) => s.connected);
  const calDone = isProfileComplete(profile, STICK_PADS);
  const needsCal = sensorKind !== 'none';

  return (
    <main className="main">
      <section className="hero">
        <h1>드럼 없이 시작하는 나의 첫 드럼</h1>
        <p>
          스틱이 오기 전까지는 키보드로 리듬 게임을, 포인터 모의 IMU로 캘리브레이션 흐름을 먼저 만져봅니다. 센서가 붙으면
          같은 화면이 그대로 스틱으로 동작합니다.
        </p>
      </section>

      <section className="steps">
        <Link to="/setup" className="card step">
          <span className="num">1단계</span>
          <h2>세팅</h2>
          <p className="dim">입력 방식, 가상 키트 배치, 판정 폭을 정하고 배치·사운드를 프리셋으로 저장합니다.</p>
          <span className="status">
            지금: {sensorKind === 'none' ? '키보드' : `${sensorRegistry.get(sensorKind)?.label ?? sensorKind} + 키보드`}
            {connected[0] || connected[1] ? ' · 연결됨' : ''}
          </span>
        </Link>
        <Link to="/calibration" className="card step">
          <span className="num">2단계</span>
          <h2>캘리브레이션</h2>
          <p className="dim">패드마다 스틱을 가져가 홀딩하면 중심 자세가 저장되고, 경계는 자동으로 잡힙니다.</p>
          <span className={`status ${calDone ? 'ok' : ''}`}>
            {!needsCal ? '키보드 입력은 캘리브레이션이 필요 없습니다' : calDone ? '완료' : '아직 안 했습니다'}
          </span>
        </Link>
        <Link to="/play" className="card step">
          <span className="num">3단계</span>
          <h2>리듬 게임</h2>
          <p className="dim">내장 채보를 따라 칩니다. Perfect · Good · Miss 판정, 콤보, 결과 리포트.</p>
          <span className="status">자유 연주는 상단 메뉴에서</span>
        </Link>
        <Link to="/sheet" className="card step">
          <span className="num">연습</span>
          <h2>악보 연습</h2>
          <p className="dim">격자 악보를 보며 치고, 끝나면 약한 패드와 마디를 짚어 주는 피드백을 받습니다. 점수는 없습니다.</p>
          <span className="status">채보 기준 판정 · 마디별 피드백</span>
        </Link>
      </section>

      {KEYBOARD_INPUT_ENABLED && (
        <section className="card" style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 10 }}>키보드 입력 (개발용)</h3>
          <div className="keyhelp">
            {LANE_ORDER.map((pad) => (
              <div key={pad}>
                <span style={{ color: PAD_META[pad].color, fontWeight: 700 }}>{PAD_META[pad].label}</span>
                <span className="row" style={{ gap: 4 }}>
                  {Object.entries(KEY_MAP)
                    .filter(([, b]) => b.pad === pad)
                    .map(([code]) => (
                      <kbd className="kbd" key={code}>
                        {code.replace('Key', '').replace('Space', 'Space')}
                      </kbd>
                    ))}
                </span>
              </div>
            ))}
          </div>
          <p className="small faint" style={{ marginTop: 10 }}>
            Shift와 함께 누르면 세게 칩니다. ` 키로 지연·판정 디버그 창을 엽니다.
          </p>
        </section>
      )}
    </main>
  );
}

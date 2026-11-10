// 기기 준비 카드 (Figma ReadyCheck 222:856). ReadyPanel(/play)의 「기기 준비」 카드를 떼어 낸 것 — 시작 확인 창의 「기기 준비 필요」 변형도 같은 줄을 쓴다.
// props만 받는다. 준비 조건 계산(useReadiness)·이동은 호출자가 한다.
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RealignPrompt, type RealignInfo } from '@/components/calibration/RealignPrompt';
import { SYSTEM_PRESET_NAME } from '@/domain/preset';
import type { ReadinessMissing } from '@/domain/readiness';
import './ready.css';

export interface DeviceCheckProps {
  /** 준비 조건 결과(domain/readiness). missing이 비면 준비 완료 */
  ready: boolean;
  missing: ReadinessMissing[];
  /** 왼손·오른손 스틱 연결. keyboardOnly면 연결 줄을 키보드 입력으로 보인다 */
  connected: [boolean, boolean];
  keyboardOnly?: boolean;
  /** 페달 연결 여부. undefined면 P 점·문구를 그리지 않는다(동글이 아닌 소스·키보드 전용) */
  pedal?: boolean;
  presetName: string | null;
  /** 스네어 재정렬이 걸려 있으면 「보정」 행에 프롬프트를 보인다(PLAY-004 D11). 준비 완료를 막지 않는다 */
  realign?: RealignInfo | null;
  /** 드럼 세팅으로 이동 */
  onSetup?: () => void;
  /** 있을 때만 [다시 연결]을 보인다 */
  onReconnect?: () => void;
  /** 카드 머리(제목·상태 문구)를 숨긴다. 창 안에 넣을 때 */
  hideHead?: boolean;
  /** 카드 아래 버튼 줄을 숨긴다. 창이 자기 버튼을 가질 때 */
  hideActions?: boolean;
  /** 프리셋 줄을 숨긴다 */
  hidePreset?: boolean;
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`play-rp-dot ${ok ? 'ok' : 'need'}`} aria-hidden="true" />;
}

function HandDot({ label, on, hand }: { label: string; on: boolean; hand: 'l' | 'r' | 'p' }) {
  return (
    <span className="play-rp-hand">
      <span className={`play-rp-hand-dot ${hand}${on ? ' on' : ''}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function stickText(connected: [boolean, boolean], keyboardOnly: boolean, pedal?: boolean): string {
  if (keyboardOnly) return '키보드 입력';
  const names = ['왼손', '오른손', ...(pedal === undefined ? [] : ['페달'])];
  const states = [connected[0], connected[1], ...(pedal === undefined ? [] : [pedal])];
  if (states.every(Boolean)) return `${names.join('·')} 연결됨`;
  return `${names.filter((_, i) => !states[i]).join('·')} 연결 안 됨`;
}

export function DeviceCheck({
  ready,
  missing,
  connected,
  keyboardOnly = false,
  pedal,
  presetName,
  realign,
  onSetup,
  onReconnect,
  hideHead = false,
  hideActions = false,
  hidePreset = false,
}: DeviceCheckProps) {
  const stickOk = !missing.includes('stick') && !missing.includes('pedal');
  const calOk = !missing.includes('firstSetup');
  const showActions = !hideActions && ((!ready && onSetup !== undefined) || onReconnect !== undefined);
  return (
    <Card padding="md" className={`play-rp-check${ready ? '' : ' need'}`} aria-label="기기 준비">
      {!hideHead && (
        <div className="play-rp-check-head">
          <h3 className="play-rp-check-title">기기 준비</h3>
          <span className={`play-rp-state ${ready ? 'ok' : 'need'}`} role="status">
            {ready ? '준비 완료' : '준비가 필요해요'}
          </span>
        </div>
      )}
      <ul className="play-rp-rows">
        <li className="play-rp-row">
          <Dot ok={stickOk} />
          <span className="play-rp-row-label">스틱 연결</span>
          <span className="play-rp-row-value">
            {!keyboardOnly && (
              <span className="play-rp-hands">
                <HandDot label="L" on={connected[0]} hand="l" />
                <HandDot label="R" on={connected[1]} hand="r" />
                {pedal !== undefined && <HandDot label="P" on={pedal} hand="p" />}
              </span>
            )}
            <span className={stickOk ? '' : 'need'}>{stickText(connected, keyboardOnly, pedal)}</span>
          </span>
        </li>
        <li className="play-rp-row">
          <Dot ok={calOk} />
          <span className="play-rp-row-label">보정</span>
          <span className="play-rp-row-value">
            {calOk && realign ? (
              <RealignPrompt hands={realign.hands} done={realign.done} variant="row" onSkip={realign.onSkip} />
            ) : (
              <span className={calOk ? '' : 'need'}>{calOk ? '완료' : '필요'}</span>
            )}
          </span>
        </li>
        {/* 프리셋은 준비 조건이 아니다(UX-64 D1): 시스템 기본이 항상 적용 가능해 이름만 보인다 */}
        {!hidePreset && (
          <li className="play-rp-row">
            <Dot ok />
            <span className="play-rp-row-label">프리셋</span>
            <span className="play-rp-row-value">
              <span>{presetName ?? SYSTEM_PRESET_NAME}</span>
            </span>
          </li>
        )}
      </ul>
      {showActions && (
        <div className="play-rp-actions">
          {!ready && onSetup && (
            <Button size="sm" onClick={onSetup}>
              드럼 세팅에서 준비하기
            </Button>
          )}
          {onReconnect && (
            <Button variant="text" size="sm" onClick={onReconnect}>
              다시 연결
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

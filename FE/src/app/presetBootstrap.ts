// 로그인 상태 ↔ 프리셋 저장소 접착 (설계 SETUP-002 프리셋 서버연동 3-4). main.tsx에서 bootstrapAuth() 앞에 한 번 부른다.
// authenticated면 서버(api/kit/presets), anonymous면 로컬(settingsStore.presets[]), 복원 중(unknown·restoring)이면 기다린다.
// 저장소를 바꾼 뒤 목록을 읽고 적용 프리셋을 맞춘다: 목록에 있으면 유지, 없으면 기본 프리셋, 기본도 없으면 시스템 기본(UX-64 D1).
// 로그인 전 로컬 프리셋은 서버로 옮기지 않는다(10/23 합의). 화면·presetStore·settingsStore는 수정하지 않는다.
import { ServerPresetSource } from '@/api/kit/presets';
import { SYSTEM_PRESET_ID, isSystemPreset, type PresetSource } from '@/domain/kit/preset';
import { useAuth, type AuthStatus } from '@/store/authStore';
import { LocalPresetSource } from '@/store/localPresetSource';
import { usePresets } from '@/store/presetStore';
import { useSettings } from '@/store/settingsStore';

/** 서버 저장소는 상태가 없으므로 하나만 만든다 */
let server: ServerPresetSource | null = null;
/** 마지막으로 저장소를 맞춘 상태. 같은 상태가 다시 와도 목록을 다시 읽지 않는다 */
let applied: AuthStatus | null = null;
/** 전환을 순서대로 처리한다. 읽는 중에 상태가 바뀌어도 늦게 온 응답이 새 저장소의 목록을 덮지 않는다 */
let chain: Promise<void> = Promise.resolve();
let unsubscribe: (() => void) | null = null;

function sourceFor(status: AuthStatus): PresetSource | null {
  if (status === 'authenticated') return (server ??= new ServerPresetSource());
  if (status === 'anonymous') return new LocalPresetSource();
  return null;
}

/** 목록을 읽은 뒤 적용 프리셋을 맞춘다. 영속된 activePresetId가 다른 저장소의 id면 목록에 없다. 시스템 기본은 항상 유효 */
function settleActive(): void {
  const { items, apply } = usePresets.getState();
  const settings = useSettings.getState();
  if (isSystemPreset(settings.activePresetId) || items.some((p) => p.id === settings.activePresetId)) return;
  const def = items.find((p) => p.isDefault);
  apply(def ? def.id : SYSTEM_PRESET_ID);
}

async function run(status: AuthStatus): Promise<void> {
  const source = sourceFor(status);
  if (!source || applied === status) return;
  applied = status;
  usePresets.getState().setSource(source);
  await usePresets.getState().refresh();
  // 읽기에 실패하면 화면이 오류를 보이고 사용자가 다시 시도한다. 적용 프리셋은 건드리지 않는다
  if (usePresets.getState().status === 'error') return;
  settleActive();
}

/** 상태에 맞는 저장소로 바꾸고 목록·적용 프리셋을 맞춘다. 돌려주는 Promise는 이 전환까지 끝났을 때 resolve된다 */
export function syncPresetSource(status: AuthStatus): Promise<void> {
  chain = chain.then(() => run(status));
  return chain;
}

/** authStore 상태 변화를 구독하고 현재 상태로 한 번 맞춘다 */
export function bootstrapPresets(): void {
  unsubscribe?.();
  unsubscribe = useAuth.subscribe((s, prev) => {
    if (s.status !== prev.status) void syncPresetSource(s.status);
  });
  void syncPresetSource(useAuth.getState().status);
}

/** 테스트 전용. 구독·순서·캐시를 지운다 */
export function resetPresetBootstrapForTest(): void {
  unsubscribe?.();
  unsubscribe = null;
  server = null;
  applied = null;
  chain = Promise.resolve();
}

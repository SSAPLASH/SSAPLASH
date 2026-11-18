// 오디오 켜기와 사운드 세트 적용. 첫 사용자 제스처에서 unlockAudio가 엔진을 켜고 설정의 세트를 불러온다.
import { audioEngine } from '@/audio/AudioEngine';
import { loadSampleSet, type SoundSet, type SoundSetId } from '@/audio/soundSets';
import { useSettings } from '@/store/settingsStore';
import { useLive } from '@/store/liveStore';

// ── 사운드 세트 ──────────────────────────────────────────────
/** 디코드가 끝난 세트 캐시. 세트를 다시 고를 때 재다운로드하지 않는다 */
const soundSetCache = new Map<SoundSetId, SoundSet>();
let appliedSetId: SoundSetId | null = null;
let loadingSetId: SoundSetId | null = null;
/** 세트를 빠르게 바꿔 응답이 뒤섞여도 마지막 선택만 반영하기 위한 번호 */
let soundSetRequest = 0;

function commitSoundSet(set: SoundSet | null, id: SoundSetId): void {
  audioEngine.setSoundSet(set);
  appliedSetId = id;
  useLive.setState({ soundSetState: 'ready', soundSetMissing: set?.missing ?? [] });
}

/**
 * 설정의 soundSetId에 맞춰 세트를 적용한다. 오디오가 아직 켜지지 않았으면(디코드할 컨텍스트가 없으면)
 * 아무것도 하지 않고, unlockAudio가 다시 부른다. 로딩 중 타격은 합성음으로 울린다.
 */
export async function applySoundSet(): Promise<void> {
  const id = useSettings.getState().soundSetId;
  if (id === 'synth') {
    soundSetRequest++;
    loadingSetId = null;
    commitSoundSet(null, id);
    return;
  }
  const cached = soundSetCache.get(id);
  if (cached) {
    soundSetRequest++;
    loadingSetId = null;
    commitSoundSet(cached, id);
    return;
  }
  const ctx = audioEngine.context;
  if (!ctx || loadingSetId === id) return;
  const req = ++soundSetRequest;
  loadingSetId = id;
  appliedSetId = null;
  audioEngine.setSoundSet(null);
  useLive.setState({ soundSetState: 'loading', soundSetMissing: [] });
  try {
    const set = await loadSampleSet(ctx, id);
    soundSetCache.set(id, set);
    if (req !== soundSetRequest) return;
    loadingSetId = null;
    commitSoundSet(set, id);
  } catch {
    if (req !== soundSetRequest) return;
    loadingSetId = null;
    useLive.setState({ soundSetState: 'error', soundSetMissing: [] });
  }
}

/** 첫 사용자 제스처에서 오디오 켜기 */
export async function unlockAudio(): Promise<void> {
  await audioEngine.ensure();
  useLive.setState({ audioReady: audioEngine.ready });
  // 첫 제스처 이후 세트 로드(이미 적용·로딩 중이면 건너뜀)
  if (appliedSetId !== useSettings.getState().soundSetId) void applySoundSet();
}

// 곡 올리기 탭 "음원 / MIDI" (설계 CHART-002 2·3-5). 탭 전환과 탭 내용 배치만 한다 — 상태는 받은 props를 그린다.
// 창(UploadDialog) 안과 첫 방문 본문에서 같이 쓴다.
import { AudioDropzone } from './AudioDropzone';
import { MidiUploadForm, type MidiUploadFormProps } from './MidiUploadForm';

export type UploadTab = 'AUDIO' | 'MIDI';

type AudioProps = Omit<Parameters<typeof AudioDropzone>[0], 'emphasis'>;

interface Props {
  tab: UploadTab;
  onTab: (tab: UploadTab) => void;
  /** 업로드 중이면 탭 전환을 막는다 */
  locked: boolean;
  audio: AudioProps;
  /** 음원 생성 중이면 그 곡 제목. 음원 탭이 안내로 바뀐다 */
  audioBusyTitle: string | null;
  midi: Omit<MidiUploadFormProps, 'emphasis'>;
  emphasis: boolean;
}

const TABS: { id: UploadTab; label: string }[] = [
  { id: 'AUDIO', label: '음원' },
  { id: 'MIDI', label: 'MIDI' },
];

export function UploadPanel({ tab, onTab, locked, audio, audioBusyTitle, midi, emphasis }: Props) {
  return (
    <div className="col">
      <div className="upload-tabs" role="tablist" aria-label="올리는 종류">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`upload-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="upload-tabpanel"
            className={tab === t.id ? 'active' : ''}
            disabled={locked && tab !== t.id}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="upload-tabpanel" aria-labelledby={`upload-tab-${tab}`}>
        {tab === 'MIDI' ? (
          <MidiUploadForm {...midi} emphasis={emphasis} />
        ) : audioBusyTitle !== null ? (
          <p className="studio-busy">「{audioBusyTitle}」 생성이 끝나면 올릴 수 있어요</p>
        ) : (
          <AudioDropzone {...audio} emphasis={emphasis} />
        )}
      </div>
    </div>
  );
}

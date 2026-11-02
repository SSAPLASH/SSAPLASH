// 곡 올리기 탭 "음원 / MIDI" (Figma Studio / UploadDialog 224:1069 · 첫 방문 210:2978 업로드 양식). 탭 Chip 두 개와 탭 내용 배치만 한다 — 상태는 받은 props를 그린다.
// 창(UploadDialog) 안과 첫 방문 본문에서 같이 쓴다. onCancel이 있으면 하단에 [취소]를 둔다.
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { AudioDropzone } from './AudioDropzone';
import { MidiUploadForm, type MidiUploadFormProps } from './MidiUploadForm';
import './studio.css';

export type UploadTab = 'AUDIO' | 'MIDI';

type AudioProps = Omit<Parameters<typeof AudioDropzone>[0], 'emphasis' | 'onCancel'>;

interface Props {
  tab: UploadTab;
  onTab: (tab: UploadTab) => void;
  /** 업로드 중이면 탭 전환을 막는다 */
  locked: boolean;
  audio: AudioProps;
  /** 음원 생성 중이면 그 곡 제목. 음원 탭이 안내로 바뀐다 */
  audioBusyTitle: string | null;
  midi: Omit<MidiUploadFormProps, 'emphasis' | 'onCancel'>;
  emphasis: boolean;
  onCancel?: () => void;
}

const TABS: { id: UploadTab; label: string }[] = [
  { id: 'AUDIO', label: '음원' },
  { id: 'MIDI', label: 'MIDI' },
];

export function UploadPanel({ tab, onTab, locked, audio, audioBusyTitle, midi, emphasis, onCancel }: Props) {
  return (
    <div className="studio-panel">
      <div className="studio-tabs" role="group" aria-label="올리는 종류">
        {TABS.map((t) => (
          <Chip key={t.id} selected={tab === t.id} className="studio-tab" disabled={locked && tab !== t.id} onClick={() => onTab(t.id)}>
            {t.label}
          </Chip>
        ))}
      </div>
      {tab === 'MIDI' ? (
        <MidiUploadForm {...midi} emphasis={emphasis} onCancel={onCancel} />
      ) : audioBusyTitle !== null ? (
        <>
          <p className="studio-busy">「{audioBusyTitle}」 생성이 끝나면 올릴 수 있어요</p>
          {onCancel && (
            <div className="studio-form-footer">
              <Button variant="secondary" size="md" className="studio-footer-btn" onClick={onCancel}>
                취소
              </Button>
            </div>
          )}
        </>
      ) : (
        <AudioDropzone {...audio} emphasis={emphasis} onCancel={onCancel} />
      )}
    </div>
  );
}

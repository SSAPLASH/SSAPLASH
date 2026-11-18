// 곡 올리기 탭 "음원 / MIDI·MusicXML" (Figma Studio / UploadDialog 224:1069. MusicXML은 293). 탭 Chip 두 개와 탭 내용 배치만 한다 — 상태는 받은 props를 그린다.
// 업로드 창(UploadDialog) 안에서 쓴다. onCancel이 있으면 하단에 [취소]를 둔다.
import { Button } from '@/components/ui/action/Button';
import { Chip } from '@/components/ui/layout/Chip';
import { AudioDropzone } from './AudioDropzone';
import { MidiUploadForm, type MidiUploadFormProps } from './MidiUploadForm';
import '@/features/studio/components/studio.css';

export type UploadTab = 'AUDIO' | 'MIDI';

type AudioProps = Omit<Parameters<typeof AudioDropzone>[0], 'onCancel'>;

interface Props {
  tab: UploadTab;
  onTab: (tab: UploadTab) => void;
  /** 업로드 중이면 탭 전환을 막는다 */
  locked: boolean;
  audio: AudioProps;
  /** 음원 생성 중이면 그 곡 제목. 음원 탭이 안내로 바뀐다 */
  audioBusyTitle: string | null;
  midi: Omit<MidiUploadFormProps, 'onCancel'>;
  /** 제목 입력의 처음 값(음원·MIDI 양식). 다시 올리기 배너 없이 제목만 채운다(악보에 곡 올리기) */
  initialTitle?: string;
  onCancel?: () => void;
}

const TABS: { id: UploadTab; label: string }[] = [
  { id: 'AUDIO', label: '음원' },
  { id: 'MIDI', label: 'MIDI·MusicXML' },
];

export function UploadPanel({ tab, onTab, locked, audio, audioBusyTitle, midi, initialTitle, onCancel }: Props) {
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
        <MidiUploadForm {...midi} initialTitle={initialTitle} onCancel={onCancel} />
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
        <AudioDropzone {...audio} initialTitle={initialTitle} onCancel={onCancel} />
      )}
    </div>
  );
}

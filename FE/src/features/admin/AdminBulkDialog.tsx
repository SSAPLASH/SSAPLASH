// 공용 곡 CSV 일괄 추가 창 (Jira 262 v0.3). 양식 받기 → CSV·파일 고르기 → 미리보기 → 업로드(차례로) → 결과.
// 판정은 domain/adminBulk, 실행은 store/adminBulkStore. 실행 중에는 닫기·Esc·배경 클릭을 막는다.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/action/Button';
import { Dialog } from '@/components/ui/overlay/Dialog';
import { IconButton } from '@/components/ui/action/IconButton';
import { BULK_TEMPLATE_FILENAME, bulkTemplateCsv, decodeCsvBytes, planBulk, type BulkAction, type BulkFile, type BulkPlan } from './adminBulk';
import type { AdminSong } from './adminSong';
import { useAdminBulk, type BulkRowStatus } from './adminBulkStore';
import '@/components/ui/layout/table.css';
import './admin.css';

interface Props {
  /** 지금 공용 곡 목록(같은 제목 판정용) */
  songs: AdminSong[];
  onClose: () => void;
  /** 업로드가 끝났을 때(목록 다시 읽기) */
  onFinished: () => void;
}

const ACTION_LABEL: Record<BulkAction, string> = { REGISTER: '등록', ACCOMPANIMENT_ONLY: '반주만', SKIP: '건너뜀', ERROR: '오류' };
const STATUS_LABEL: Record<BulkRowStatus, string> = { running: '올리는 중…', done: '완료', failed: '실패', skipped: '—' };

function downloadTemplate() {
  // 엑셀에서 한글이 깨지지 않게 BOM을 붙인다
  const blob = new Blob(['\uFEFF' + bulkTemplateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = BULK_TEMPLATE_FILENAME;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminBulkDialog({ songs, onClose, onFinished }: Props) {
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [files, setFiles] = useState<BulkFile[]>([]);
  const phase = useAdminBulk((s) => s.phase);
  const results = useAdminBulk((s) => s.results);
  const summary = useAdminBulk((s) => s.summary);
  const run = useAdminBulk((s) => s.run);
  const reset = useAdminBulk((s) => s.reset);
  const running = phase === 'running';

  /** 실행할 때의 미리보기. 실행 중·끝난 뒤에는 목록을 다시 읽어도 이 판정을 그대로 보여 준다 */
  const [frozen, setFrozen] = useState<BulkPlan | null>(null);

  // 창을 열 때 지난 결과를 지운다
  useEffect(() => {
    reset();
  }, [reset]);

  // 업로드 중 새로고침·창 닫기는 브라우저가 한 번 묻게 한다(창 안 닫기·Esc·배경 클릭은 막혀 있다)
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const live: BulkPlan | null = csv ? planBulk(csv.text, files, songs) : null;
  const plan = frozen ?? live;
  const targets = plan?.rows.filter((r) => r.action === 'REGISTER' || r.action === 'ACCOMPANIMENT_ONLY') ?? [];

  const start = async () => {
    if (!live || targets.length === 0) return;
    setFrozen(live);
    await run(live.rows);
    onFinished();
  };

  /** 끝난 뒤 지금 목록으로 다시 판정한다. 완료된 줄은 반주만·건너뜀이 되고 실패한 줄만 남는다 */
  const recheck = () => {
    reset();
    setFrozen(null);
  };

  return (
    <Dialog className="admin-dialog admin-bulk-dialog" labelledBy="admin-bulk-title" closeOnBackdrop={!running} closeOnEscape={!running} onClose={onClose}>
      <div className="admin-dialog-head">
        <h2 id="admin-bulk-title">공용 곡 일괄 추가</h2>
        <IconButton size="sm" label="닫기" onClick={onClose} disabled={running}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </IconButton>
      </div>

      <div className="admin-form">
        <p className="admin-file-help">
          1) 양식을 받아 한 줄에 한 곡씩 채워요(AI가 준 곡별 첫 박 표도 그대로 쓸 수 있어요). 2) CSV와, 표에 적은 MIDI·반주 파일을 함께 골라요. 3) 미리보기를 확인하고 업로드해요.
          같은 제목의 공용 곡이 있으면 반주만 올려요. 양식에서 #으로 시작하는 안내·예시 줄은 읽지 않아요.
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={downloadTemplate} disabled={running}>
            양식 받기
          </Button>
        </div>
        <label className="admin-file">
          <span className="admin-file-label">CSV 파일</span>
          <input
            type="file"
            aria-label="CSV 파일"
            accept=".csv,text/csv"
            disabled={running}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setFrozen(null);
              setCsv(f ? { name: f.name, text: decodeCsvBytes(new Uint8Array(await f.arrayBuffer())) } : null);
            }}
          />
        </label>
        <label className="admin-file">
          <span className="admin-file-label">MIDI·반주 파일 (여러 개)</span>
          <input
            type="file"
            aria-label="MIDI·반주 파일"
            multiple
            accept=".mid,.midi,.wav,.mp3,audio/midi,audio/x-midi,audio/wav,audio/mpeg"
            disabled={running}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              // 같은 입력을 다시 열어도 change가 나도록 비운다
              e.target.value = '';
              // 다시 고르면 이어 붙인다. 같은 이름(대소문자 무시)은 새로 고른 파일로 바꾼다
              setFiles((prev) => {
                const byName = new Map(prev.map((f) => [f.name.toLowerCase(), f]));
                for (const f of picked) byName.set(f.name.toLowerCase(), f);
                return [...byName.values()];
              });
            }}
          />
          <span className="admin-file-help">{files.length > 0 ? `${files.length}개 골랐어요` : '표에 적은 파일 이름 그대로 골라요. 여러 번 나눠 골라도 이어 붙어요. 반주는 WAV·MP3, 50 MiB 이하'}</span>
        </label>
        {files.length > 0 && (
          <div className="admin-picked">
            <p className="admin-note">{files.map((f) => f.name).join(' · ')}</p>
            <Button variant="secondary" size="sm" onClick={() => setFiles([])} disabled={running}>
              고른 파일 비우기
            </Button>
          </div>
        )}

        {plan?.error && (
          <p className="notice error" role="alert">
            {plan.error}
          </p>
        )}
        {plan && !plan.error && (
          <div className="admin-table-wrap">
            <table className="ui-table admin-table" aria-label="일괄 추가 미리보기">
              <thead>
                <tr>
                  <th scope="col">줄</th>
                  <th scope="col">제목</th>
                  <th scope="col">할 일</th>
                  <th scope="col">결과</th>
                  <th scope="col">안내</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => {
                  const res = results[r.line];
                  return (
                    <tr key={r.line}>
                      <td>{r.line}</td>
                      <td>{r.title || '—'}</td>
                      <td className={r.action === 'ERROR' ? 'admin-bad' : r.action === 'SKIP' ? 'admin-no' : 'admin-yes'}>{ACTION_LABEL[r.action]}</td>
                      <td className={res?.status === 'failed' ? 'admin-bad' : undefined}>{res ? STATUS_LABEL[res.status] : ''}</td>
                      <td className="admin-note">{res?.message ?? r.message ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {phase === 'done' && (
          <p className="notice" role="status">
            {`완료 ${summary.done} · 실패 ${summary.failed} · 건너뜀 ${summary.skipped}`}
            {summary.failed > 0 ? ' — [남은 줄 다시 확인]을 누르면 실패한 줄만 다시 올릴 수 있어요.' : ''}
          </p>
        )}
        {running && <p className="admin-file-help">업로드 중이에요. 끝날 때까지 창을 닫지 마세요.</p>}

        <div className="admin-footer">
          <Button variant="secondary" size="md" className="admin-footer-btn" onClick={onClose} disabled={running}>
            닫기
          </Button>
          {phase === 'done' ? (
            <Button variant="primary" size="md" className="admin-footer-btn" onClick={recheck}>
              남은 줄 다시 확인
            </Button>
          ) : (
            <Button variant="primary" size="md" className="admin-footer-btn" onClick={() => void start()} disabled={running || targets.length === 0}>
              {running ? '업로드 중…' : `업로드 (${targets.length}곡)`}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

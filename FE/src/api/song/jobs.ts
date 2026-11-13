// 채보 작업 상태 조회. 서버의 스냅샷 ID와 revision은 안전한 정수여야 한다.
import { toSafeId } from '@/domain/song/songCatalog';
import { apiFetch } from '@/api/http';

export interface JobSnapshot {
  jobId: number;
  songId: number;
  status: string;
  progress: unknown;
  revision: number;
  error: { code: string; message: string } | null;
}

export async function getJob(id: number, signal?: AbortSignal): Promise<JobSnapshot> {
  const body = await apiFetch<Record<string, unknown>>(`/api/v1/jobs/${id}`, { signal });
  const jobId = toSafeId(body.jobId, 'jobId');
  const songId = toSafeId(body.songId, 'songId');
  const revision = toSafeId(body.revision, 'revision');
  if (jobId <= 0 || songId <= 0 || revision < 0) throw new Error('작업 스냅샷이 올바르지 않습니다.');
  const error = body.error && typeof body.error === 'object' && !Array.isArray(body.error) ? body.error as Record<string, unknown> : null;
  return {
    jobId, songId, revision,
    status: typeof body.status === 'string' ? body.status : '',
    progress: body.progress,
    error: error && typeof error.code === 'string' && typeof error.message === 'string' ? { code: error.code, message: error.message } : null,
  };
}

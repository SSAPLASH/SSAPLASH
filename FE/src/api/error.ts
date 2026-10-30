// BE 오류 응답(RFC 9457 problem+json, BE README "API 규약")을 ApiError로 바꾼다. http·auth가 같이 쓴다.

export interface ApiFieldError {
  field: string;
  message: string;
}

/**
 * BE 호출 실패. `code`로 분기하고 `detail`은 그대로 보여 줘도 되는 한국어 문장이다.
 * problem+json이 아닌 응답은 code 'HTTP_ERROR', 네트워크 실패는 status 0·code 'NETWORK'.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly errors: ApiFieldError[];
  readonly instance: string | null;
  /** 응답 `Retry-After` 헤더(초 단위 정수)를 ms로. 없거나 해석 못 하면 null */
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    code: string,
    detail: string,
    options: { errors?: ApiFieldError[]; instance?: string | null; retryAfterMs?: number | null; cause?: unknown } = {},
  ) {
    super(detail, { cause: options.cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.errors = options.errors ?? [];
    this.instance = options.instance ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

function isFieldError(v: unknown): v is ApiFieldError {
  return typeof v === 'object' && v !== null && typeof (v as ApiFieldError).field === 'string' && typeof (v as ApiFieldError).message === 'string';
}

/** `Retry-After`의 초 단위 정수만 해석한다(HTTP 날짜 형식은 쓰지 않는다). 음수·비정수는 null */
function parseRetryAfterMs(v: string | null): number | null {
  if (v === null || !/^\d+$/.test(v.trim())) return null;
  return Number(v.trim()) * 1000;
}

/** 2xx가 아닌 응답을 ApiError로. JSON 본문이면 code·detail·errors·instance를 읽고, 아니면 HTTP_ERROR */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      const body = (await res.json()) as Record<string, unknown>;
      return new ApiError(
        res.status,
        typeof body.code === 'string' ? body.code : 'HTTP_ERROR',
        typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`,
        {
          errors: Array.isArray(body.errors) ? body.errors.filter(isFieldError) : [],
          instance: typeof body.instance === 'string' ? body.instance : null,
          retryAfterMs,
        },
      );
    } catch {
      // 본문이 JSON이 아니면 아래 일반 오류로
    }
  }
  return new ApiError(res.status, 'HTTP_ERROR', `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`, { retryAfterMs });
}

/** fetch 자체가 실패(서버 다운·DNS·CORS)했을 때 */
export function networkError(cause: unknown): ApiError {
  return new ApiError(0, 'NETWORK', '서버에 연결할 수 없습니다.', { cause });
}

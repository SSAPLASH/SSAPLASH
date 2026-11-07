// Blob을 파일명으로 내려받는다 (설계 REC-002 3-2). 데이터 생성은 모르고, 링크 요소 클릭만 한다.

/** 임시 URL을 만들어 `download` 링크를 클릭하고, 다음 틱에 URL을 해제한다 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

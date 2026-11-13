// 브라우저에서 이미지 읽기 → 가운데 정사각형 자르기 → 512×512 JPEG Blob (설계 CHART-001 D3).
// 크기 계산은 domain/song/songCover의 순수 함수가 하고, 여기는 캔버스를 얇게 감싼다(jsdom 테스트 대상 아님).
import { COVER_OUTPUT, centerSquareCrop } from '@/features/studio/domain/songCover';

interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function readSource(file: File): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    return { image: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 고른 이미지를 가운데 정사각형으로 잘라 512 JPEG로 만든다. 읽을 수 없으면 throw */
export async function makeCoverBlob(file: File): Promise<Blob> {
  const src = await readSource(file);
  try {
    const crop = centerSquareCrop(src.width, src.height);
    if (!crop) throw new Error('이미지 크기를 알 수 없습니다.');
    const canvas = document.createElement('canvas');
    canvas.width = COVER_OUTPUT.size;
    canvas.height = COVER_OUTPUT.size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('캔버스를 쓸 수 없습니다.');
    // JPEG는 투명을 못 쓰므로 흰 바탕 위에 그린다
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src.image, crop.sx, crop.sy, crop.size, crop.size, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, COVER_OUTPUT.mime, COVER_OUTPUT.quality));
    if (!blob) throw new Error('이미지를 변환하지 못했습니다.');
    return blob;
  } finally {
    src.release();
  }
}

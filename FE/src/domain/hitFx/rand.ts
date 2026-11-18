// seq 기반 결정적 난수. Math.random을 쓰지 않아 같은 입력은 같은 파티클이 된다.

/** seed·i에서 0~1 값 */
export function rand01(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** seed에서 차례로 값을 내는 난수기 */
export function createRand(seed: number): () => number {
  let i = 0;
  return () => rand01(seed, i++);
}

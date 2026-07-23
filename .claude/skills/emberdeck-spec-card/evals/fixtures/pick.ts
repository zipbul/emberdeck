export interface PickStep { sku: string; location: string }

const LOCATION_BY_PREFIX: Record<string, string> = { A: 'A-01', B: 'B-03', C: 'C-02' };

export function computePickRoute(skus: string[]): PickStep[] {
  const unique = [...new Set(skus)].sort();
  return unique.map((sku) => {
    const location = LOCATION_BY_PREFIX[sku[0]?.toUpperCase() ?? ''];
    if (location === undefined) throw new Error(`재고 위치 데이터 미비: ${sku}`);
    return { sku, location };
  });
}

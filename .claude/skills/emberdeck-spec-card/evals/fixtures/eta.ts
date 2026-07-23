export interface EtaResult { minutes: number }

const KM_PER_DEGREE = 111;
const KM_PER_MINUTE = 0.5;
const SERVICE_RANGE_KM = 500;

export function estimateEta(from: string, to: string): EtaResult {
  const [fromLat, fromLng] = from.split(',').map(Number);
  const [toLat, toLng] = to.split(',').map(Number);
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
    throw new Error(`좌표 형식 오류: "${from}" → "${to}"`);
  }
  const km = Math.hypot(toLat - fromLat, toLng - fromLng) * KM_PER_DEGREE;
  if (km > SERVICE_RANGE_KM) {
    throw new Error(`서비스 범위 밖: 직선 ${Math.round(km)}km > ${SERVICE_RANGE_KM}km`);
  }
  return { minutes: Math.ceil(km / KM_PER_MINUTE) };
}

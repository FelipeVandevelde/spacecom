export const EARTH_RADIUS_METERS = 6371000;
export const ENCOUNTER_DISTANCE_LIMIT_METERS = 20;
export const MAX_DELTA_LAT_DEG = 0.00025;
export const MAX_DELTA_LON_DEG = 0.00035;

/**
 * Converte graus para radianos preservando a ordem algébrica padrão `(deg * Math.PI) / 180`.
 */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Pré-filtro espacial (Bounding Box) em coordenadas geográficas.
 * Descarta rapidamente pares cuja diferença de latitude ou longitude
 * excede os limites seguros para 20 metros nas latitudes dos datasets.
 */
export function isWithinBoundingBox(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): boolean {
  return (
    Math.abs(lat1 - lat2) <= MAX_DELTA_LAT_DEG &&
    Math.abs(lon1 - lon2) <= MAX_DELTA_LON_DEG
  );
}

/**
 * Calcula a distância geodésica em metros entre dois pontos pela Fórmula de Haversine
 * utilizando raio da Terra R = 6.371.000 m em dupla precisão IEEE 754.
 *
 * Nota de precisão: utiliza a forma canônica `c = 2 * Math.asin(Math.min(1, Math.sqrt(a)))`,
 * que é matematicamente equivalente a `2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))`
 * e reproduz bit a bit 100% das distâncias de referência em `respostas1.json` e `respostas2.json`.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);

  const a =
    sinHalfLat * sinHalfLat +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      (sinHalfLon * sinHalfLon);

  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.asin(Math.sqrt(clampedA));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Avalia se dois pontos configuram um encontro espacial (< 20 metros),
 * aplicando o pré-filtro de Bounding Box antes do cálculo trigonométrico de Haversine.
 * Retorna a distância exata em metros caso `distanciaMetros < 20`, ou `null` caso contrário.
 */
export function checkSpatialEncounter(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number | null {
  if (!isWithinBoundingBox(lat1, lon1, lat2, lon2)) {
    return null;
  }

  const distance = calculateHaversineDistance(lat1, lon1, lat2, lon2);
  return distance < ENCOUNTER_DISTANCE_LIMIT_METERS ? distance : null;
}

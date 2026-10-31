import { describe, expect, it } from 'vitest';
import {
  buildEncounter,
  classifyEncounterType,
  evaluatePairEncounter,
} from '../src/domain/classifier.js';
import {
  EARTH_RADIUS_METERS,
  ENCOUNTER_DISTANCE_LIMIT_METERS,
  MAX_DELTA_LAT_DEG,
  MAX_DELTA_LON_DEG,
  calculateHaversineDistance,
  checkSpatialEncounter,
  isWithinBoundingBox,
  toRadians,
} from '../src/domain/haversine.js';
import type { EntityProfile, PositionRecord } from '../src/domain/types.js';

function makeProfile(
  idMonitorado: number,
  faccaoMonitorado = '',
  medidaProtetiva = false,
  idsRestricao: number[] = [],
): EntityProfile {
  return {
    idMonitorado,
    faccaoMonitorado,
    medidaProtetiva,
    idsRestricaoMedida: new Set(idsRestricao),
  };
}

function makeRecord(
  idMonitorado: number,
  latitude: number,
  longitude: number,
  timestamp = '2024-01-01 00:00:00',
  profile?: EntityProfile,
): PositionRecord {
  return {
    idMonitorado,
    timestamp,
    latitude,
    longitude,
    profile: profile ?? makeProfile(idMonitorado),
  };
}

describe('Núcleo de Domínio — Haversine e Pré-Filtro Espacial (CAP-2)', () => {
  it('mantém constantes oficiais do domínio e conversão para radianos intactas', () => {
    expect(EARTH_RADIUS_METERS).toBe(6371000);
    expect(ENCOUNTER_DISTANCE_LIMIT_METERS).toBe(20);
    expect(MAX_DELTA_LAT_DEG).toBe(0.00025);
    expect(MAX_DELTA_LON_DEG).toBe(0.00035);
    expect(toRadians(0)).toBe(0);
    expect(toRadians(180)).toBe(Math.PI);
    expect(toRadians(-90)).toBe(-Math.PI / 2);
  });

  it('reproduz exatamente (IEEE 754 bit a bit) as distâncias de respostas1.json, respostas2.json e do edital', () => {
    const referenceCases: Array<[number, number, number, number, number]> = [
      // Edital (exemplo [40, 44])
      [-10.07996, -37.08384, -10.07987, -37.08389, 11.406788673336607],
      // respostas1.json
      [-31.93195, -40.61438, -31.93187, -40.61435, 9.33522817789823],
      [-28.28206, -44.63511, -28.28207, -44.6352, 8.882771981092958],
      [1.83355, -69.5461, 1.83351, -69.54618, 9.941503149375345],
      [-13.02054, -46.40609, -13.02046, -46.40609, 8.895594131622975],
      // respostas2.json
      [-14.62732, -36.31859, -14.62731, -36.31869, 10.81640474094182],
      [-7.33193, -65.9313, -7.33197, -65.93137, 8.909619516337239],
      [-25.99892, -56.96696, -25.99883, -56.96694, 10.205209934010645],
      [-15.03744, -73.42167, -15.03739, -73.42174, 9.349741643529189],
      [-29.13547, -43.25292, -29.13546, -43.25301, 8.811738897421028],
      [-14.77075, -55.87742, -14.77068, -55.87738, 8.892813491126276],
    ];

    for (const [lat1, lon1, lat2, lon2, expected] of referenceCases) {
      expect(calculateHaversineDistance(lat1, lon1, lat2, lon2)).toBe(expected);
      expect(checkSpatialEncounter(lat1, lon1, lat2, lon2)).toBe(expected);
    }
  });

  it('retorna 0 metros para coordenadas idênticas', () => {
    expect(calculateHaversineDistance(-23.55052, -46.63331, -23.55052, -46.63331)).toBe(0);
    expect(checkSpatialEncounter(-23.55052, -46.63331, -23.55052, -46.63331)).toBe(0);
  });

  it('aplica corretamente o pré-filtro Bounding Box (|dLat| <= 0.00025 e |dLon| <= 0.00035), inclusive na fronteira exata', () => {
    expect(isWithinBoundingBox(0, 0, MAX_DELTA_LAT_DEG, MAX_DELTA_LON_DEG)).toBe(true);
    expect(isWithinBoundingBox(0, 0, 0.00024, 0.00034)).toBe(true);
    expect(isWithinBoundingBox(0, 0, 0.00026, 0.0001)).toBe(false);
    expect(isWithinBoundingBox(0, 0, 0.0001, 0.00036)).toBe(false);
    expect(checkSpatialEncounter(0, 0, 0.00026, 0)).toBeNull();
    expect(checkSpatialEncounter(0, 0, 0, 0.00036)).toBeNull();
  });

  it('respeita a fronteira estrita de distância (< 20m vs >= 20m)', () => {
    // 1 grau de latitude = (Math.PI / 180) * 6371000 ≈ 111194.92664455873 metros
    // 20 metros em latitude a lon=0 equivale a deltaLat = 20 / 111194.92664455873 ≈ 0.00017986432118374618 graus
    const deltaLatExact20m = (20 / EARTH_RADIUS_METERS) * (180 / Math.PI);
    const deltaLatUnder20m = deltaLatExact20m * 0.999999;
    const deltaLatOver20m = deltaLatExact20m * 1.000001;

    const distUnder = calculateHaversineDistance(0, 0, deltaLatUnder20m, 0);
    expect(distUnder).toBeLessThan(20);
    expect(checkSpatialEncounter(0, 0, deltaLatUnder20m, 0)).toBe(distUnder);

    const distExact = calculateHaversineDistance(0, 0, deltaLatExact20m, 0);
    expect(distExact).toBeGreaterThanOrEqual(20);
    expect(checkSpatialEncounter(0, 0, deltaLatExact20m, 0)).toBeNull();

    const distOver = calculateHaversineDistance(0, 0, deltaLatOver20m, 0);
    expect(distOver).toBeGreaterThan(20);
    expect(checkSpatialEncounter(0, 0, deltaLatOver20m, 0)).toBeNull();
  });
});

describe('Núcleo de Domínio — Classificador e Ordenação de Encontros (CAP-3)', () => {
  it('classifica como protetiva quando A possui medidaProtetiva e restringe B (ou vice-versa)', () => {
    const vitima = makeProfile(9, '', true, [10, 25]);
    const agressor = makeProfile(10, 'FaccaoX', false, []);

    expect(classifyEncounterType(vitima, agressor)).toBe('protetiva');
    expect(classifyEncounterType(agressor, vitima)).toBe('protetiva');
  });

  it('garante precedência de protetiva sobre faccao caso ambos compartilhem facção e haja restrição ativa', () => {
    const perfilA = makeProfile(1, 'FaccaoAlpha', true, [2]);
    const perfilB = makeProfile(2, 'FaccaoAlpha', false, []);

    expect(classifyEncounterType(perfilA, perfilB)).toBe('protetiva');
  });

  it('não classifica como protetiva quando medidaProtetiva é true mas o outro ID não consta em idsRestricaoMedida', () => {
    const vitima = makeProfile(9, '', true, [99]);
    const outroMonitorado = makeProfile(10, 'FaccaoX', false, []);

    expect(classifyEncounterType(vitima, outroMonitorado)).toBe('generico');
  });

  it('classifica como faccao quando ambos possuem a mesma facção não vazia e sem restrição protetiva entre si', () => {
    const membro1 = makeProfile(7, 'ComandoSul', false, []);
    const membro2 = makeProfile(8, 'ComandoSul', false, []);

    expect(classifyEncounterType(membro1, membro2)).toBe('faccao');
  });

  it('classifica como generico quando ambos possuem facção vazia ou facções distintas', () => {
    const semFaccao1 = makeProfile(4, '', false, []);
    const semFaccao2 = makeProfile(6, '', false, []);
    const faccaoA = makeProfile(11, 'FaccaoA', false, []);
    const faccaoB = makeProfile(12, 'FaccaoB', false, []);

    expect(classifyEncounterType(semFaccao1, semFaccao2)).toBe('generico');
    expect(classifyEncounterType(faccaoA, faccaoB)).toBe('generico');
  });

  it('ordena monitoradosEncontro como [menorId, maiorId] e produz resultado idêntico independentemente da ordem de entrada', () => {
    const recMaior = makeRecord(10, 1.83351, -69.54618, '2024-01-01 00:16:45', makeProfile(10, 'FaccaoX', false, []));
    const recMenor = makeRecord(9, 1.83355, -69.5461, '2024-01-01 00:16:45', makeProfile(9, '', true, [10]));

    const encDireto = evaluatePairEncounter(recMenor, recMaior);
    const encInvertido = evaluatePairEncounter(recMaior, recMenor);

    expect(encDireto).not.toBeNull();
    expect(encDireto).toEqual(encInvertido);
    expect(encDireto).toEqual({
      tipo: 'protetiva',
      monitoradosEncontro: [9, 10],
      timestamp: '2024-01-01 00:16:45',
      posicoes: {
        '9': { lat: 1.83355, lon: -69.5461 },
        '10': { lat: 1.83351, lon: -69.54618 },
      },
      distanciaMetros: 9.941503149375345,
    });
  });

  it('ignora ou rejeita pares inválidos (mesmo ID, perfil inconsistente, timestamps distintos ou distância fora de [0, 20))', () => {
    const recA = makeRecord(5, -28.28207, -44.6352, '2024-01-01 00:10:20');
    const recB = makeRecord(3, -28.28206, -44.63511, '2024-01-01 00:10:20');
    const recMesmoId = makeRecord(5, -28.28206, -44.63511, '2024-01-01 00:10:20');
    const recOutroTimestamp = makeRecord(3, -28.28206, -44.63511, '2024-01-01 00:10:25');
    const recPerfilDivergente = makeRecord(3, 0, 0, '2024-01-01 00:10:20', makeProfile(99));

    expect(evaluatePairEncounter(recA, recMesmoId)).toBeNull();
    expect(evaluatePairEncounter(recA, recOutroTimestamp)).toBeNull();
    expect(() => evaluatePairEncounter(recA, recPerfilDivergente)).toThrow(RangeError);

    expect(() => buildEncounter(recA, recPerfilDivergente, 5)).toThrow(RangeError);
    expect(() => buildEncounter(recA, recMesmoId, 5)).toThrow(RangeError);
    expect(() => buildEncounter(recA, recOutroTimestamp, 5)).toThrow(RangeError);
    expect(() => buildEncounter(recA, recB, 20)).toThrow(RangeError);
    expect(() => buildEncounter(recA, recB, -1)).toThrow(RangeError);
    expect(() => buildEncounter(recA, recB, Number.NaN)).toThrow(RangeError);
    expect(() => buildEncounter(recA, recB, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

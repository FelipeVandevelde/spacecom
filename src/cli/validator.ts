import type { Encounter } from '../domain/types.js';

export const OFFICIAL_GROUND_TRUTH_DATASET_1: readonly Encounter[] = [
  {
    tipo: 'generico',
    monitoradosEncontro: [4, 6],
    timestamp: '2024-01-01 00:05:15',
    posicoes: {
      '4': {
        lat: -31.93195,
        lon: -40.61438,
      },
      '6': {
        lat: -31.93187,
        lon: -40.61435,
      },
    },
    distanciaMetros: 9.33522817789823,
  },
  {
    tipo: 'generico',
    monitoradosEncontro: [3, 5],
    timestamp: '2024-01-01 00:10:20',
    posicoes: {
      '3': {
        lat: -28.28206,
        lon: -44.63511,
      },
      '5': {
        lat: -28.28207,
        lon: -44.6352,
      },
    },
    distanciaMetros: 8.882771981092958,
  },
  {
    tipo: 'protetiva',
    monitoradosEncontro: [9, 10],
    timestamp: '2024-01-01 00:16:45',
    posicoes: {
      '9': {
        lat: 1.83355,
        lon: -69.5461,
      },
      '10': {
        lat: 1.83351,
        lon: -69.54618,
      },
    },
    distanciaMetros: 9.941503149375345,
  },
  {
    tipo: 'faccao',
    monitoradosEncontro: [7, 8],
    timestamp: '2024-01-01 00:36:00',
    posicoes: {
      '7': {
        lat: -13.02054,
        lon: -46.40609,
      },
      '8': {
        lat: -13.02046,
        lon: -46.40609,
      },
    },
    distanciaMetros: 8.895594131622975,
  },
];

export const OFFICIAL_GROUND_TRUTH_DATASET_2: readonly Encounter[] = [
  {
    tipo: 'faccao',
    monitoradosEncontro: [10, 11],
    timestamp: '2024-01-01 00:02:05',
    posicoes: {
      '10': {
        lat: -14.62732,
        lon: -36.31859,
      },
      '11': {
        lat: -14.62731,
        lon: -36.31869,
      },
    },
    distanciaMetros: 10.81640474094182,
  },
  {
    tipo: 'protetiva',
    monitoradosEncontro: [12, 13],
    timestamp: '2024-01-01 00:29:50',
    posicoes: {
      '12': {
        lat: -7.33193,
        lon: -65.9313,
      },
      '13': {
        lat: -7.33197,
        lon: -65.93137,
      },
    },
    distanciaMetros: 8.909619516337239,
  },
  {
    tipo: 'generico',
    monitoradosEncontro: [3, 19],
    timestamp: '2024-01-01 00:35:55',
    posicoes: {
      '3': {
        lat: -25.99892,
        lon: -56.96696,
      },
      '19': {
        lat: -25.99883,
        lon: -56.96694,
      },
    },
    distanciaMetros: 10.205209934010645,
  },
  {
    tipo: 'generico',
    monitoradosEncontro: [6, 7],
    timestamp: '2024-01-01 00:43:35',
    posicoes: {
      '6': {
        lat: -15.03744,
        lon: -73.42167,
      },
      '7': {
        lat: -15.03739,
        lon: -73.42174,
      },
    },
    distanciaMetros: 9.349741643529189,
  },
  {
    tipo: 'generico',
    monitoradosEncontro: [4, 5],
    timestamp: '2024-01-01 01:26:30',
    posicoes: {
      '4': {
        lat: -29.13547,
        lon: -43.25292,
      },
      '5': {
        lat: -29.13546,
        lon: -43.25301,
      },
    },
    distanciaMetros: 8.811738897421028,
  },
  {
    tipo: 'faccao',
    monitoradosEncontro: [8, 9],
    timestamp: '2024-01-01 01:43:00',
    posicoes: {
      '8': {
        lat: -14.77075,
        lon: -55.87742,
      },
      '9': {
        lat: -14.77068,
        lon: -55.87738,
      },
    },
    distanciaMetros: 8.892813491126276,
  },
];

export interface DatasetValidationResult {
  readonly datasetId: number;
  readonly expectedCount: number;
  readonly actualCount: number;
  readonly ec: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly ei: number;
  readonly score: number;
  readonly exactOrderMatch: boolean;
  readonly passed: boolean;
}

export interface GroundTruthSummary {
  readonly somaEc: number;
  readonly somaEi: number;
  readonly score: number;
  readonly passed: boolean;
  readonly results: readonly DatasetValidationResult[];
}

export function getOfficialGroundTruth(
  datasetId: number,
): readonly Encounter[] | undefined {
  if (datasetId === 1) {
    return OFFICIAL_GROUND_TRUTH_DATASET_1;
  }
  if (datasetId === 2) {
    return OFFICIAL_GROUND_TRUTH_DATASET_2;
  }
  return undefined;
}

/**
 * Compara estruturalmente dois objetos `Encounter` exigindo igualdade exata em todos os campos.
 */
export function areEncountersEqual(a: Encounter, b: Encounter): boolean {
  if (
    a.tipo !== b.tipo ||
    a.timestamp !== b.timestamp ||
    a.monitoradosEncontro.length !== 2 ||
    b.monitoradosEncontro.length !== 2 ||
    a.monitoradosEncontro[0] !== b.monitoradosEncontro[0] ||
    a.monitoradosEncontro[1] !== b.monitoradosEncontro[1] ||
    a.distanciaMetros !== b.distanciaMetros
  ) {
    return false;
  }

  const keysA = Object.keys(a.posicoes);
  const keysB = Object.keys(b.posicoes);
  if (keysA.length !== 2 || keysB.length !== 2) {
    return false;
  }

  for (const id of a.monitoradosEncontro) {
    const key = String(id);
    const posA = a.posicoes[key];
    const posB = b.posicoes[key];
    if (
      posA === undefined ||
      posB === undefined ||
      posA.lat !== posB.lat ||
      posA.lon !== posB.lon
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Audita os encontros gerados para um dataset contra seu gabarito oficial (`dataset1` ou `dataset2`)
 * ou contra um gabarito explícito fornecido.
 */
export function validateDatasetEncounters(
  datasetId: number,
  actual: readonly Encounter[],
  expectedOverride?: readonly Encounter[],
): DatasetValidationResult {
  const expected = expectedOverride ?? getOfficialGroundTruth(datasetId);
  if (expected === undefined) {
    throw new RangeError(
      `Gabarito oficial não disponível para datasetId=${datasetId} (apenas datasets 1 e 2 possuem gabarito oficial).`,
    );
  }

  const matchedActualIndices = new Set<number>();
  let ec = 0;

  for (const exp of expected) {
    for (let i = 0; i < actual.length; i++) {
      if (matchedActualIndices.has(i)) {
        continue;
      }
      const act = actual[i];
      if (act !== undefined && areEncountersEqual(act, exp)) {
        matchedActualIndices.add(i);
        ec++;
        break;
      }
    }
  }

  const falsePositives = actual.length - ec;
  const falseNegatives = expected.length - ec;
  const ei = falsePositives + falseNegatives;
  const score = ec - ei;
  const exactOrderMatch =
    actual.length === expected.length &&
    actual.every((item, idx) => {
      const expItem = expected[idx];
      return expItem !== undefined && areEncountersEqual(item, expItem);
    });

  return {
    datasetId,
    expectedCount: expected.length,
    actualCount: actual.length,
    ec,
    falsePositives,
    falseNegatives,
    ei,
    score,
    exactOrderMatch,
    passed: ec === expected.length && ei === 0 && exactOrderMatch,
  };
}

/**
 * Consolida os resultados de validação dos datasets de teste, calculando `soma_ec`, `soma_ei` e `Score`.
 */
export function summarizeGroundTruthValidations(
  results: readonly DatasetValidationResult[],
): GroundTruthSummary {
  let somaEc = 0;
  let somaEi = 0;
  let allPassed = true;

  for (const res of results) {
    somaEc += res.ec;
    somaEi += res.ei;
    if (!res.passed) {
      allPassed = false;
    }
  }

  return {
    somaEc,
    somaEi,
    score: somaEc - somaEi,
    passed: allPassed,
    results,
  };
}

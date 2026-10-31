import * as fs from 'node:fs';
import {
  ENCOUNTER_DISTANCE_LIMIT_METERS,
  calculateHaversineDistance,
} from '../domain/haversine.js';
import type { Encounter, EncounterType } from '../domain/types.js';

const VALID_ENCOUNTER_TYPES = new Set<EncounterType>([
  'protetiva',
  'faccao',
  'generico',
]);
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const EXPECTED_ENCOUNTER_KEYS = [
  'tipo',
  'monitoradosEncontro',
  'timestamp',
  'posicoes',
  'distanciaMetros',
] as const;

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

export interface StructuralAuditResult {
  readonly count: number;
  readonly byType: Readonly<Record<EncounterType, number>>;
  readonly minDistanceMeters: number | null;
  readonly maxDistanceMeters: number | null;
  readonly firstTimestamp: string | null;
  readonly lastTimestamp: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isValidTimestampString(timestamp: string): boolean {
  if (!TIMESTAMP_PATTERN.test(timestamp)) {
    return false;
  }

  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(5, 7));
  const day = Number(timestamp.slice(8, 10));
  const hour = Number(timestamp.slice(11, 13));
  const minute = Number(timestamp.slice(14, 16));
  const second = Number(timestamp.slice(17, 19));

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Audita a integridade estrutural, semântica e matemática (Haversine < 20m, unicidade por timestamp,
 * ordenação de IDs e monotonia temporal) de um array de encontros.
 * Lança `TypeError`, `SyntaxError` ou `RangeError` na primeira violação detectada.
 */
export function auditEncounterList(
  items: unknown,
  contextLabel = 'output',
): StructuralAuditResult {
  if (!Array.isArray(items)) {
    throw new TypeError(
      `[${contextLabel}] Estrutura inválida: esperado um array de encontros.`,
    );
  }

  const byType: Record<EncounterType, number> = {
    protetiva: 0,
    faccao: 0,
    generico: 0,
  };
  let minDistanceMeters: number | null = null;
  let maxDistanceMeters: number | null = null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  const seenPairsInWindow = new Set<string>();

  for (let idx = 0; idx < items.length; idx++) {
    const raw = items[idx];
    const itemCtx = `${contextLabel}[${idx}]`;

    if (!isPlainObject(raw)) {
      throw new TypeError(
        `[${itemCtx}] Item inválido: esperado objeto plano de encontro.`,
      );
    }

    const keys = Object.keys(raw);
    if (
      keys.length !== EXPECTED_ENCOUNTER_KEYS.length ||
      !EXPECTED_ENCOUNTER_KEYS.every((k) => Object.hasOwn(raw, k))
    ) {
      throw new SyntaxError(
        `[${itemCtx}] Chaves do objeto inválidas (${keys.join(', ')}): esperado exatamente ${EXPECTED_ENCOUNTER_KEYS.join(', ')}.`,
      );
    }

    const tipo = raw['tipo'];
    if (
      typeof tipo !== 'string' ||
      !VALID_ENCOUNTER_TYPES.has(tipo as EncounterType)
    ) {
      throw new SyntaxError(
        `[${itemCtx}] Campo "tipo" inválido (${String(tipo)}): esperado "protetiva", "faccao" ou "generico".`,
      );
    }

    const monitorados = raw['monitoradosEncontro'];
    if (!Array.isArray(monitorados) || monitorados.length !== 2) {
      throw new SyntaxError(
        `[${itemCtx}] Campo "monitoradosEncontro" inválido: esperado tupla de 2 IDs.`,
      );
    }

    const idA = monitorados[0];
    const idB = monitorados[1];
    if (
      typeof idA !== 'number' ||
      typeof idB !== 'number' ||
      !Number.isInteger(idA) ||
      !Number.isInteger(idB) ||
      idA < 1 ||
      idB < 1 ||
      idA >= idB
    ) {
      throw new RangeError(
        `[${itemCtx}] Campo "monitoradosEncontro" inválido ([${String(idA)}, ${String(idB)}]): esperado inteiros positivos estritamente ordenados [menorId, maiorId].`,
      );
    }

    const timestamp = raw['timestamp'];
    if (
      typeof timestamp !== 'string' ||
      !isValidTimestampString(timestamp)
    ) {
      throw new SyntaxError(
        `[${itemCtx}] Campo "timestamp" inválido ("${String(timestamp)}"): esperado data/hora válida no formato "YYYY-MM-DD HH:MM:SS" sem aspas.`,
      );
    }

    if (lastTimestamp !== null) {
      if (timestamp < lastTimestamp) {
        throw new RangeError(
          `[${itemCtx}] Quebra de monotonia temporal: "${timestamp}" aparece após "${lastTimestamp}".`,
        );
      }
      if (timestamp !== lastTimestamp) {
        seenPairsInWindow.clear();
      }
    }

    const pairKey = `${idA}:${idB}`;
    if (seenPairsInWindow.has(pairKey)) {
      throw new RangeError(
        `[${itemCtx}] Encontro duplicado para o par [${idA}, ${idB}] no mesmo timestamp "${timestamp}".`,
      );
    }
    seenPairsInWindow.add(pairKey);

    const posicoes = raw['posicoes'];
    if (!isPlainObject(posicoes)) {
      throw new TypeError(
        `[${itemCtx}] Campo "posicoes" inválido: esperado objeto plano.`,
      );
    }

    const posKeys = Object.keys(posicoes);
    const keyA = String(idA);
    const keyB = String(idB);
    if (
      posKeys.length !== 2 ||
      !Object.hasOwn(posicoes, keyA) ||
      !Object.hasOwn(posicoes, keyB)
    ) {
      throw new SyntaxError(
        `[${itemCtx}] Chaves de "posicoes" (${posKeys.join(', ')}) não correspondem a monitoradosEncontro [${keyA}, ${keyB}].`,
      );
    }

    const posA = posicoes[keyA];
    const posB = posicoes[keyB];
    if (!isPlainObject(posA) || !isPlainObject(posB)) {
      throw new TypeError(
        `[${itemCtx}] Coordenadas em "posicoes" devem ser objetos planos { lat, lon }.`,
      );
    }

    for (const [label, posObj] of [
      [keyA, posA],
      [keyB, posB],
    ] as const) {
      const coordKeys = Object.keys(posObj);
      if (
        coordKeys.length !== 2 ||
        !Object.hasOwn(posObj, 'lat') ||
        !Object.hasOwn(posObj, 'lon')
      ) {
        throw new SyntaxError(
          `[${itemCtx}] Coordenada de "${label}" possui chaves inválidas (${coordKeys.join(', ')}): esperado apenas "lat" e "lon".`,
        );
      }
    }

    const latA = posA['lat'];
    const lonA = posA['lon'];
    const latB = posB['lat'];
    const lonB = posB['lon'];
    if (
      typeof latA !== 'number' ||
      typeof lonA !== 'number' ||
      typeof latB !== 'number' ||
      typeof lonB !== 'number' ||
      !Number.isFinite(latA) ||
      !Number.isFinite(lonA) ||
      !Number.isFinite(latB) ||
      !Number.isFinite(lonB) ||
      latA < -90 ||
      latA > 90 ||
      latB < -90 ||
      latB > 90 ||
      lonA < -180 ||
      lonA > 180 ||
      lonB < -180 ||
      lonB > 180
    ) {
      throw new RangeError(
        `[${itemCtx}] Coordenadas geográficas fora de domínio em "posicoes".`,
      );
    }

    const distanciaMetros = raw['distanciaMetros'];
    if (
      typeof distanciaMetros !== 'number' ||
      !Number.isFinite(distanciaMetros) ||
      distanciaMetros < 0 ||
      distanciaMetros >= ENCOUNTER_DISTANCE_LIMIT_METERS
    ) {
      throw new RangeError(
        `[${itemCtx}] Campo "distanciaMetros" inválido (${String(distanciaMetros)}): esperado número finito >= 0 e estritamente < ${ENCOUNTER_DISTANCE_LIMIT_METERS}.`,
      );
    }

    const expectedDistance = calculateHaversineDistance(latA, lonA, latB, lonB);
    if (distanciaMetros !== expectedDistance) {
      throw new RangeError(
        `[${itemCtx}] Divergência matemática em "distanciaMetros": gravado ${distanciaMetros}, Haversine=${expectedDistance}.`,
      );
    }

    byType[tipo as EncounterType]++;
    if (minDistanceMeters === null || distanciaMetros < minDistanceMeters) {
      minDistanceMeters = distanciaMetros;
    }
    if (maxDistanceMeters === null || distanciaMetros > maxDistanceMeters) {
      maxDistanceMeters = distanciaMetros;
    }
    if (firstTimestamp === null) {
      firstTimestamp = timestamp;
    }
    lastTimestamp = timestamp;
  }

  return {
    count: items.length,
    byType,
    minDistanceMeters,
    maxDistanceMeters,
    firstTimestamp,
    lastTimestamp,
  };
}

/**
 * Lê um arquivo JSON de resposta em disco, audita sua formatação, schema e invariantes matemáticos
 * e, quando `datasetId` possui gabarito oficial (datasets 1 e 2), verifica igualdade exata.
 */
export async function auditOutputFile(
  filePath: string,
  datasetId?: number,
): Promise<StructuralAuditResult> {
  const rawText = await fs.promises.readFile(filePath, 'utf8');
  if (rawText.trim().length === 0) {
    throw new SyntaxError(`[${filePath}] Arquivo JSON de saída está vazio.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err: unknown) {
    throw new SyntaxError(
      `[${filePath}] JSON malformado: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const audit = auditEncounterList(parsed, filePath);

  if (
    datasetId !== undefined &&
    getOfficialGroundTruth(datasetId) !== undefined
  ) {
    const validation = validateDatasetEncounters(
      datasetId,
      parsed as readonly Encounter[],
    );
    if (!validation.passed) {
      throw new Error(
        `[${filePath}] Falha na validação de gabarito do dataset ${datasetId}: esperado ${validation.expectedCount}, obtido ${validation.actualCount} (ec=${validation.ec}, ei=${validation.ei}, exactOrderMatch=${validation.exactOrderMatch}).`,
      );
    }
  }

  return audit;
}

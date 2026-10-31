import {
  ENCOUNTER_DISTANCE_LIMIT_METERS,
  checkSpatialEncounter,
} from './haversine.js';
import type {
  Encounter,
  EncounterType,
  EntityProfile,
  PositionRecord,
} from './types.js';

/**
 * Classifica o tipo de encontro entre dois perfis seguindo a hierarquia estrita:
 * 1. `protetiva`: um dos envolvidos possui `medidaProtetiva === true` e o ID do outro consta em seu `idsRestricaoMedida`.
 * 2. `faccao`: ambos possuem o mesmo `faccaoMonitorado` não vazio.
 * 3. `generico`: qualquer outro encontro válido (< 20m).
 */
export function classifyEncounterType(
  profileA: EntityProfile,
  profileB: EntityProfile,
): EncounterType {
  const isProtetivaA =
    profileA.medidaProtetiva &&
    profileA.idsRestricaoMedida.has(profileB.idMonitorado);
  const isProtetivaB =
    profileB.medidaProtetiva &&
    profileB.idsRestricaoMedida.has(profileA.idMonitorado);

  if (isProtetivaA || isProtetivaB) {
    return 'protetiva';
  }

  if (
    profileA.faccaoMonitorado !== '' &&
    profileA.faccaoMonitorado === profileB.faccaoMonitorado
  ) {
    return 'faccao';
  }

  return 'generico';
}

function assertConsistentProfileIds(
  recordA: PositionRecord,
  recordB: PositionRecord,
): void {
  if (
    recordA.idMonitorado !== recordA.profile.idMonitorado ||
    recordB.idMonitorado !== recordB.profile.idMonitorado
  ) {
    throw new RangeError(
      'Inconsistência entre o idMonitorado do registro e o idMonitorado do perfil.',
    );
  }
}

function createOrderedEncounter(
  first: PositionRecord,
  second: PositionRecord,
  distanciaMetros: number,
): Encounter {
  const tipo = classifyEncounterType(first.profile, second.profile);

  return {
    tipo,
    monitoradosEncontro: [first.idMonitorado, second.idMonitorado],
    timestamp: first.timestamp,
    posicoes: {
      [String(first.idMonitorado)]: {
        lat: first.latitude,
        lon: first.longitude,
      },
      [String(second.idMonitorado)]: {
        lat: second.latitude,
        lon: second.longitude,
      },
    },
    distanciaMetros,
  };
}

/**
 * Constrói o objeto de saída `Encounter` garantindo ordenação determinística `[minId, maxId]`
 * em `monitoradosEncontro` e nas chaves de `posicoes`.
 */
export function buildEncounter(
  recordA: PositionRecord,
  recordB: PositionRecord,
  distanciaMetros: number,
): Encounter {
  assertConsistentProfileIds(recordA, recordB);

  if (recordA.idMonitorado === recordB.idMonitorado) {
    throw new RangeError(
      'Não é possível registrar encontro de um indivíduo consigo mesmo.',
    );
  }

  if (recordA.timestamp !== recordB.timestamp) {
    throw new RangeError(
      'Registros de um encontro devem pertencer exatamente ao mesmo timestamp.',
    );
  }

  if (
    !Number.isFinite(distanciaMetros) ||
    distanciaMetros < 0 ||
    distanciaMetros >= ENCOUNTER_DISTANCE_LIMIT_METERS
  ) {
    throw new RangeError(
      `Distância inválida para encontro (${distanciaMetros}m): deve ser finita, >= 0 e < ${ENCOUNTER_DISTANCE_LIMIT_METERS}m.`,
    );
  }

  const [first, second] =
    recordA.idMonitorado < recordB.idMonitorado
      ? [recordA, recordB]
      : [recordB, recordA];

  return createOrderedEncounter(first, second, distanciaMetros);
}

/**
 * Avalia dois registros de posicionamento de mesmo timestamp: ordena por `[minId, maxId]`,
 * aplica o pré-filtro espacial + Haversine (< 20m) e, se houver encontro, retorna o `Encounter` classificado.
 */
export function evaluatePairEncounter(
  recordA: PositionRecord,
  recordB: PositionRecord,
): Encounter | null {
  assertConsistentProfileIds(recordA, recordB);

  if (
    recordA.idMonitorado === recordB.idMonitorado ||
    recordA.timestamp !== recordB.timestamp
  ) {
    return null;
  }

  const [first, second] =
    recordA.idMonitorado < recordB.idMonitorado
      ? [recordA, recordB]
      : [recordB, recordA];

  const distance = checkSpatialEncounter(
    first.latitude,
    first.longitude,
    second.latitude,
    second.longitude,
  );

  if (distance === null) {
    return null;
  }

  return createOrderedEncounter(first, second, distance);
}

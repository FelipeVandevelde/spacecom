import { evaluatePairEncounter } from '../domain/classifier.js';
import type { Encounter, PositionRecord } from '../domain/types.js';

/**
 * Avalia todos os pares de registros pertencentes à mesma janela de `timestamp`,
 * aplicando pré-filtro espacial Bounding Box, cálculo de Haversine (< 20m) e
 * classificação hierárquica (`protetiva > faccao > generico`).
 * Garante unicidade de par `[menorId, maiorId]` dentro do mesmo `timestamp`.
 */
export function detectWindowEncounters(
  windowRecords: readonly PositionRecord[],
  outEncounters: Encounter[] = [],
): Encounter[] {
  const count = windowRecords.length;
  if (count < 2) {
    return outEncounters;
  }

  const windowStartIndex = outEncounters.length;

  for (let i = 0; i < count - 1; i++) {
    const recordA = windowRecords[i]!;

    for (let j = i + 1; j < count; j++) {
      const recordB = windowRecords[j]!;
      const encounter = evaluatePairEncounter(recordA, recordB);

      if (encounter === null) {
        continue;
      }

      const [minId, maxId] = encounter.monitoradosEncontro;
      let duplicatePair = false;
      for (let k = windowStartIndex; k < outEncounters.length; k++) {
        const existing = outEncounters[k]!;
        if (
          existing.monitoradosEncontro[0] === minId &&
          existing.monitoradosEncontro[1] === maxId
        ) {
          duplicatePair = true;
          break;
        }
      }

      if (!duplicatePair) {
        const flatTimestamp = Buffer.from(
          encounter.timestamp,
          'utf8',
        ).toString('utf8');
        outEncounters.push({
          ...encounter,
          timestamp: flatTimestamp,
        });
      }
    }
  }

  return outEncounters;
}

/**
 * Acumulador stateful de janela temporal para leitura contínua em stream.
 * Agrupa posicionamentos contíguos de mesmo `timestamp` e dispara a detecção
 * de encontros assim que o `timestamp` muda ou no encerramento do stream (`flush`).
 */
export class WindowDetector {
  private currentTimestamp: string | null = null;
  private readonly windowBuffer: PositionRecord[] = [];
  private readonly encounters: Encounter[] = [];

  public push(record: PositionRecord): void {
    if (this.currentTimestamp === null) {
      const flatTs = Buffer.from(record.timestamp, 'utf8').toString('utf8');
      this.currentTimestamp = flatTs;
      this.windowBuffer.push({ ...record, timestamp: flatTs });
      return;
    }

    if (record.timestamp === this.currentTimestamp) {
      this.windowBuffer.push({
        ...record,
        timestamp: this.currentTimestamp,
      });
      return;
    }

    detectWindowEncounters(this.windowBuffer, this.encounters);
    this.windowBuffer.length = 0;
    const flatTs = Buffer.from(record.timestamp, 'utf8').toString('utf8');
    this.currentTimestamp = flatTs;
    this.windowBuffer.push({ ...record, timestamp: flatTs });
  }

  public flush(): Encounter[] {
    if (this.windowBuffer.length > 0) {
      detectWindowEncounters(this.windowBuffer, this.encounters);
      this.windowBuffer.length = 0;
      this.currentTimestamp = null;
    }
    return this.encounters.slice();
  }

  public getEncounters(): readonly Encounter[] {
    return this.encounters;
  }
}

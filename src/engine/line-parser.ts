import type { PositionRecord } from '../domain/types.js';
import {
  EntityCache,
  parsePositiveIntToken,
  stripWrappingQuotes,
} from './entity-cache.js';

export const CSV_HEADER =
  'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida';

function normalizeLine(rawLine: string): string {
  const start =
    rawLine.length > 0 && rawLine.charCodeAt(0) === 0xfeff ? 1 : 0;
  const end =
    rawLine.length > start && rawLine.charCodeAt(rawLine.length - 1) === 13
      ? rawLine.length - 1
      : rawLine.length;

  return start === 0 && end === rawLine.length
    ? rawLine
    : rawLine.slice(start, end);
}

/**
 * Verifica se a linha corresponde ao cabeçalho oficial do dataset CSV.
 */
export function isHeaderLine(rawLine: string): boolean {
  return normalizeLine(rawLine) === CSV_HEADER;
}

/**
 * Extrai um `PositionRecord` a partir de uma linha CSV delimitada por `;`
 * utilizando apenas `indexOf(';')` e `slice()`, sem `split()` ou expressões regulares.
 */
export function parseLine(
  rawLine: string,
  cache: EntityCache,
): PositionRecord {
  const line = normalizeLine(rawLine);

  const s1 = line.indexOf(';');
  if (s1 <= 0) {
    throw new SyntaxError(
      `Linha CSV inválida (coluna idMonitorado ausente ou delimitador ';' não encontrado): "${line}".`,
    );
  }

  const s2 = line.indexOf(';', s1 + 1);
  if (s2 === -1) {
    throw new SyntaxError(
      `Linha CSV inválida (coluna faccaoMonitorado incompleta): "${line}".`,
    );
  }

  const s3 = line.indexOf(';', s2 + 1);
  if (s3 === -1) {
    throw new SyntaxError(
      `Linha CSV inválida (coluna timestamp incompleta): "${line}".`,
    );
  }

  const s4 = line.indexOf(';', s3 + 1);
  if (s4 === -1) {
    throw new SyntaxError(
      `Linha CSV inválida (coluna latitude incompleta): "${line}".`,
    );
  }

  const s5 = line.indexOf(';', s4 + 1);
  if (s5 === -1) {
    throw new SyntaxError(
      `Linha CSV inválida (coluna longitude incompleta): "${line}".`,
    );
  }

  const s6 = line.indexOf(';', s5 + 1);
  if (s6 === -1 || line.indexOf(';', s6 + 1) !== -1) {
    throw new SyntaxError(
      `Linha CSV inválida (esperadas exatamente 7 colunas separadas por ';'): "${line}".`,
    );
  }

  const idMonitorado = parsePositiveIntToken(
    line.slice(0, s1),
    'idMonitorado inválido na linha CSV',
  );

  const timestamp = stripWrappingQuotes(line.slice(s2 + 1, s3));
  if (timestamp.trim().length === 0) {
    throw new SyntaxError(`timestamp vazio na linha CSV: "${line}".`);
  }

  const latSlice = line.slice(s3 + 1, s4);
  const lonSlice = line.slice(s4 + 1, s5);
  if (latSlice.trim().length === 0 || lonSlice.trim().length === 0) {
    throw new SyntaxError(
      `Coordenadas vazias na linha CSV: lat="${latSlice}", lon="${lonSlice}".`,
    );
  }

  const latitude = Number(latSlice);
  const longitude = Number(lonSlice);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new SyntaxError(
      `Coordenadas não numéricas na linha CSV: lat="${latSlice}", lon="${lonSlice}".`,
    );
  }

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new RangeError(
      `Coordenadas geográficas fora do intervalo válido na linha CSV: lat=${latSlice}, lon=${lonSlice}.`,
    );
  }

  let profile = cache.get(idMonitorado);
  if (profile === undefined) {
    const rawFaccao = line.slice(s1 + 1, s2);
    const rawMedidaProtetiva = line.slice(s5 + 1, s6);
    const rawIdsRestricao = line.slice(s6 + 1);
    profile = cache.getOrCreate(
      idMonitorado,
      rawFaccao,
      rawMedidaProtetiva,
      rawIdsRestricao,
    );
  }

  return {
    idMonitorado,
    timestamp,
    latitude,
    longitude,
    profile,
  };
}

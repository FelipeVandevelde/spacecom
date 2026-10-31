import type { EntityProfile } from '../domain/types.js';

export const EMPTY_RESTRICTION_SET: ReadonlySet<number> = new Set<number>();

/**
 * Remove aspas duplas envolventes (`"..."`) de um campo textual caso presentes.
 * Lança `SyntaxError` caso as aspas estejam desbalanceadas.
 */
export function stripWrappingQuotes(value: string): string {
  if (value.length === 0) {
    return value;
  }

  const startsWithQuote = value.charCodeAt(0) === 34;
  const endsWithQuote = value.charCodeAt(value.length - 1) === 34;

  if (startsWithQuote && endsWithQuote) {
    if (value.length < 2) {
      throw new SyntaxError(
        `Campo com aspas duplas desbalanceadas: "${value}".`,
      );
    }
    return value.slice(1, -1);
  }

  if (startsWithQuote || endsWithQuote) {
    throw new SyntaxError(`Campo com aspas duplas desbalanceadas: "${value}".`);
  }

  return value;
}

/**
 * Converte um token estritamente composto por dígitos ASCII (`0-9`) em inteiro positivo.
 */
export function parsePositiveIntToken(token: string, context: string): number {
  if (token.length === 0) {
    throw new SyntaxError(`${context}: identificador vazio encontrado.`);
  }

  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i);
    if (code < 48 || code > 57) {
      throw new SyntaxError(
        `${context}: "${token}" (esperado inteiro positivo em base 10).`,
      );
    }
  }

  const id = Number(token);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new SyntaxError(
      `${context}: "${token}" (esperado inteiro positivo).`,
    );
  }

  return id;
}

/**
 * Converte a coluna `idsRestricaoMedida` (ex.: `"10"`, `"1,2,3"` ou `""`) em `ReadonlySet<number>`
 * percorrendo os separadores via `indexOf(',')` sem alocar arrays intermediários com `split()`.
 */
export function parseRestrictionIds(rawIdsRestricao: string): ReadonlySet<number> {
  const unquoted = stripWrappingQuotes(rawIdsRestricao);
  if (unquoted.length === 0) {
    return EMPTY_RESTRICTION_SET;
  }

  const ids = new Set<number>();
  let start = 0;

  while (start <= unquoted.length) {
    const commaIndex = unquoted.indexOf(',', start);
    const token =
      commaIndex === -1
        ? unquoted.slice(start)
        : unquoted.slice(start, commaIndex);

    const id = parsePositiveIntToken(
      token,
      `Identificador de restrição inválido em "${rawIdsRestricao}"`,
    );

    ids.add(id);

    if (commaIndex === -1) {
      break;
    }
    start = commaIndex + 1;
  }

  return ids;
}

/**
 * Cache em memória O(1) de atributos cadastrais estáticos por `idMonitorado`.
 * Evita reprocessar `faccaoMonitorado`, `medidaProtetiva` e `idsRestricaoMedida`
 * a cada janela de posicionamento do mesmo indivíduo.
 */
export class EntityCache {
  private readonly profiles = new Map<number, EntityProfile>();

  public get(idMonitorado: number): EntityProfile | undefined {
    return this.profiles.get(idMonitorado);
  }

  public get size(): number {
    return this.profiles.size;
  }

  public clear(): void {
    this.profiles.clear();
  }

  public getOrCreate(
    idMonitorado: number,
    rawFaccao: string,
    rawMedidaProtetiva: string,
    rawIdsRestricao: string,
  ): EntityProfile {
    if (!Number.isInteger(idMonitorado) || idMonitorado <= 0) {
      throw new RangeError(
        `idMonitorado inválido (${idMonitorado}): esperado inteiro positivo.`,
      );
    }

    const existing = this.profiles.get(idMonitorado);
    if (existing !== undefined) {
      return existing;
    }

    let medidaProtetiva: boolean;
    if (rawMedidaProtetiva === 'true') {
      medidaProtetiva = true;
    } else if (rawMedidaProtetiva === 'false') {
      medidaProtetiva = false;
    } else {
      throw new SyntaxError(
        `Valor inválido para medidaProtetiva ("${rawMedidaProtetiva}") no idMonitorado ${idMonitorado}: esperado "true" ou "false".`,
      );
    }

    const unquotedFaccao = stripWrappingQuotes(rawFaccao);
    const faccaoMonitorado =
      unquotedFaccao.length === 0
        ? ''
        : Buffer.from(unquotedFaccao, 'utf8').toString('utf8');
    const idsRestricaoMedida = parseRestrictionIds(rawIdsRestricao);

    const profile: EntityProfile = {
      idMonitorado,
      faccaoMonitorado,
      medidaProtetiva,
      idsRestricaoMedida,
    };

    this.profiles.set(idMonitorado, profile);
    return profile;
  }
}

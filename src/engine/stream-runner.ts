import * as fs from 'node:fs';
import type { Encounter } from '../domain/types.js';
import { EntityCache } from './entity-cache.js';
import { isHeaderLine, parseLine } from './line-parser.js';
import { WindowDetector } from './window-detector.js';

export const DEFAULT_CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB

export interface StreamRunnerOptions {
  readonly start?: number;
  readonly end?: number;
  readonly highWaterMark?: number;
  readonly cache?: EntityCache;
}

function validateOptions(options: StreamRunnerOptions): void {
  const { start, end, highWaterMark } = options;

  if (start !== undefined && (!Number.isInteger(start) || start < 0)) {
    throw new RangeError(
      `Opção start inválida (${start}): esperado inteiro >= 0.`,
    );
  }

  if (end !== undefined && (!Number.isInteger(end) || end < 0)) {
    throw new RangeError(`Opção end inválida (${end}): esperado inteiro >= 0.`);
  }

  if (start !== undefined && end !== undefined && start > end) {
    throw new RangeError(
      `Intervalo de bytes inválido ([${start}, ${end}]): start não pode ser maior que end.`,
    );
  }

  if (
    highWaterMark !== undefined &&
    (!Number.isInteger(highWaterMark) || highWaterMark <= 0)
  ) {
    throw new RangeError(
      `Opção highWaterMark inválida (${highWaterMark}): esperado inteiro positivo.`,
    );
  }
}

/**
 * Executa a leitura em stream por blocos de `Buffer` (padrão 4 MB) de um dataset CSV
 * no intervalo inclusivo de bytes `[start, end]`, agrupando registros por janela de
 * `timestamp` e retornando todos os encontros detectados.
 */
export async function runStream(
  filePath: string,
  options: StreamRunnerOptions = {},
): Promise<Encounter[]> {
  validateOptions(options);

  const stat = await fs.promises.stat(filePath);
  if (stat.size === 0) {
    return [];
  }

  const cache = options.cache ?? new EntityCache();
  const detector = new WindowDetector();
  const highWaterMark = options.highWaterMark ?? DEFAULT_CHUNK_SIZE_BYTES;

  return new Promise<Encounter[]>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      start: options.start,
      end: options.end,
      highWaterMark,
    });

    let leftover: Buffer = Buffer.alloc(0);
    let firstNonEmptyLineSeen = false;
    let settled = false;

    const processRawLine = (rawLine: string): void => {
      if (
        rawLine.length === 0 ||
        (rawLine.length === 1 && rawLine.charCodeAt(0) === 13)
      ) {
        return;
      }

      if (!firstNonEmptyLineSeen) {
        firstNonEmptyLineSeen = true;
        if (isHeaderLine(rawLine)) {
          return;
        }
      }

      const record = parseLine(rawLine, cache);
      detector.push(record);
    };

    stream.on('data', (rawChunk: Buffer | string) => {
      if (settled) {
        return;
      }

      try {
        let chunk =
          typeof rawChunk === 'string'
            ? Buffer.from(rawChunk, 'utf8')
            : rawChunk;

        if (leftover.length > 0) {
          const firstNl = chunk.indexOf(0x0a);
          if (firstNl === -1) {
            leftover = Buffer.concat([leftover, chunk]);
            return;
          }

          const combinedLine = Buffer.concat([
            leftover,
            chunk.subarray(0, firstNl),
          ]).toString('utf8');
          leftover = Buffer.alloc(0);
          processRawLine(combinedLine);

          chunk = chunk.subarray(firstNl + 1);
          if (chunk.length === 0) {
            return;
          }
        }

        const lastNl = chunk.lastIndexOf(0x0a);
        if (lastNl === -1) {
          leftover = Buffer.from(chunk);
          return;
        }

        if (lastNl > 0) {
          const block = chunk.toString('utf8', 0, lastNl);
          let lineStart = 0;

          while (lineStart <= block.length) {
            const nlIndex = block.indexOf('\n', lineStart);
            if (nlIndex === -1) {
              processRawLine(block.slice(lineStart));
              break;
            }
            processRawLine(block.slice(lineStart, nlIndex));
            lineStart = nlIndex + 1;
          }
        }

        if (lastNl + 1 < chunk.length) {
          leftover = Buffer.from(chunk.subarray(lastNl + 1));
        }
      } catch (err) {
        settled = true;
        stream.destroy();
        reject(err);
      }
    });

    stream.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    stream.on('end', () => {
      if (settled) {
        return;
      }

      try {
        if (leftover.length > 0) {
          processRawLine(leftover.toString('utf8'));
          leftover = Buffer.alloc(0);
        }

        const encounters = detector.flush();
        settled = true;
        resolve(encounters);
      } catch (err) {
        settled = true;
        reject(err);
      }
    });
  });
}

import * as fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { Encounter } from '../domain/types.js';
import {
  parsePositiveIntToken,
  stripWrappingQuotes,
} from './entity-cache.js';
import { isHeaderLine } from './line-parser.js';
import { runStream } from './stream-runner.js';
import type {
  WorkerResponseMessage,
  WorkerSerializedError,
  WorkerTaskPayload,
} from './worker.js';

export const PARALLEL_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB
const BOUNDARY_SCAN_CHUNK_BYTES = 64 * 1024; // 64 KB
const LINE_BACKTRACK_BYTES = 1024;

const TS_WORKER_HOOK_DATA_URL = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier, context);
      } catch {
        return nextResolve(specifier.slice(0, -3) + '.ts', context);
      }
    }
    return nextResolve(specifier, context);
  }
});
`)}`;

export interface TimestampSplitInfo {
  readonly dataStartOffset: number;
  readonly splitOffset: number | null;
  readonly fileSize: number;
}

export interface ParallelRunnerOptions {
  readonly highWaterMark?: number;
}

function reconstructWorkerError(serialized: WorkerSerializedError): Error {
  let err: Error;
  switch (serialized.name) {
    case 'SyntaxError':
      err = new SyntaxError(serialized.message);
      break;
    case 'RangeError':
      err = new RangeError(serialized.message);
      break;
    case 'TypeError':
      err = new TypeError(serialized.message);
      break;
    default:
      err = new Error(serialized.message);
      err.name = serialized.name;
      break;
  }
  if (serialized.stack !== undefined) {
    err.stack = serialized.stack;
  }
  return err;
}

function isBlankCsvLine(rawLine: string): boolean {
  const start =
    rawLine.length > 0 && rawLine.charCodeAt(0) === 0xfeff ? 1 : 0;
  const end =
    rawLine.length > start && rawLine.charCodeAt(rawLine.length - 1) === 13
      ? rawLine.length - 1
      : rawLine.length;
  return end <= start;
}

function extractTimestampFromLine(rawLine: string): string {
  const start =
    rawLine.length > 0 && rawLine.charCodeAt(0) === 0xfeff ? 1 : 0;
  const end =
    rawLine.length > start && rawLine.charCodeAt(rawLine.length - 1) === 13
      ? rawLine.length - 1
      : rawLine.length;
  const line =
    start === 0 && end === rawLine.length ? rawLine : rawLine.slice(start, end);

  const s1 = line.indexOf(';');
  if (s1 <= 0) {
    throw new SyntaxError(
      `Linha CSV inválida ao buscar fronteira de timestamp: "${line}".`,
    );
  }

  parsePositiveIntToken(
    line.slice(0, s1),
    'idMonitorado inválido ao buscar fronteira de timestamp',
  );

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

  const timestamp = stripWrappingQuotes(line.slice(s2 + 1, s3));
  if (timestamp.trim().length === 0) {
    throw new SyntaxError(`timestamp vazio na linha CSV: "${line}".`);
  }

  return timestamp;
}

async function scanForTimestampTransition(
  handle: fs.promises.FileHandle,
  startOffset: number,
  endLimitOffset: number,
  skipFirstPartialLine: boolean,
  pickLastTransition = false,
): Promise<number | null> {
  let fileOffset = startOffset;
  let leftover: Buffer = Buffer.alloc(0);
  let leftoverStartOffset = startOffset;
  let skippingPartial = skipFirstPartialLine;
  let currentTimestamp: string | null = null;
  let lastTransitionOffset: number | null = null;
  const readBuffer = Buffer.allocUnsafe(BOUNDARY_SCAN_CHUNK_BYTES);

  while (fileOffset < endLimitOffset) {
    const bytesToRead = Math.min(
      BOUNDARY_SCAN_CHUNK_BYTES,
      endLimitOffset - fileOffset,
    );
    const { bytesRead } = await handle.read(
      readBuffer,
      0,
      bytesToRead,
      fileOffset,
    );
    if (bytesRead === 0) {
      break;
    }

    const chunk = readBuffer.subarray(0, bytesRead);
    const combined =
      leftover.length > 0
        ? Buffer.concat([leftover, chunk])
        : Buffer.from(chunk);
    const combinedBaseOffset =
      leftover.length > 0 ? leftoverStartOffset : fileOffset;

    fileOffset += bytesRead;

    let cursor = 0;
    while (cursor < combined.length) {
      const nlIndex = combined.indexOf(0x0a, cursor);
      if (nlIndex === -1) {
        break;
      }

      const lineStartByteOffset = combinedBaseOffset + cursor;
      const rawLine = combined.toString('utf8', cursor, nlIndex);
      cursor = nlIndex + 1;

      if (skippingPartial) {
        skippingPartial = false;
        continue;
      }

      if (isBlankCsvLine(rawLine) || isHeaderLine(rawLine)) {
        continue;
      }

      const ts = extractTimestampFromLine(rawLine);
      if (currentTimestamp === null) {
        currentTimestamp = ts;
      } else if (ts !== currentTimestamp) {
        if (!pickLastTransition) {
          return lineStartByteOffset;
        }
        currentTimestamp = ts;
        lastTransitionOffset = lineStartByteOffset;
      }
    }

    leftover = combined.subarray(cursor);
    leftoverStartOffset = combinedBaseOffset + cursor;
  }

  if (!skippingPartial && leftover.length > 0) {
    const rawLine = leftover.toString('utf8');
    if (!isBlankCsvLine(rawLine) && !isHeaderLine(rawLine)) {
      const ts = extractTimestampFromLine(rawLine);
      if (currentTimestamp !== null && ts !== currentTimestamp) {
        if (!pickLastTransition) {
          return leftoverStartOffset;
        }
        lastTransitionOffset = leftoverStartOffset;
      }
    }
  }

  return lastTransitionOffset;
}

/**
 * Localiza o offset de início dos dados (após linhas em branco iniciais e o cabeçalho CSV,
 * se presente) e o byte exato onde começa a próxima janela de `timestamp` próxima a `fileSize / 2`,
 * garantindo que um mesmo `timestamp` jamais seja dividido entre as 2 Worker Threads.
 */
export async function findTimestampSplitOffset(
  filePath: string,
): Promise<TimestampSplitInfo> {
  const handle = await fs.promises.open(filePath, 'r');

  try {
    const stat = await handle.stat();
    const fileSize = stat.size;
    if (fileSize === 0) {
      return { dataStartOffset: 0, splitOffset: null, fileSize: 0 };
    }

    const headerProbeSize = Math.min(BOUNDARY_SCAN_CHUNK_BYTES, fileSize);
    const headerBuffer = Buffer.allocUnsafe(headerProbeSize);
    const { bytesRead } = await handle.read(
      headerBuffer,
      0,
      headerProbeSize,
      0,
    );
    const probeSlice = headerBuffer.subarray(0, bytesRead);

    let dataStartOffset = 0;
    let cursor = 0;
    let foundFirstNonEmpty = false;

    while (cursor < probeSlice.length) {
      const nlIndex = probeSlice.indexOf(0x0a, cursor);
      const lineEnd = nlIndex === -1 ? probeSlice.length : nlIndex;
      const rawLine = probeSlice.toString('utf8', cursor, lineEnd);

      if (isBlankCsvLine(rawLine)) {
        if (nlIndex === -1) {
          cursor = probeSlice.length;
          break;
        }
        cursor = nlIndex + 1;
        continue;
      }

      foundFirstNonEmpty = true;
      if (isHeaderLine(rawLine)) {
        dataStartOffset = nlIndex === -1 ? fileSize : nlIndex + 1;
      } else {
        dataStartOffset = cursor;
      }
      break;
    }

    if (!foundFirstNonEmpty) {
      dataStartOffset = cursor >= fileSize ? fileSize : cursor;
    }

    if (dataStartOffset >= fileSize) {
      return { dataStartOffset, splitOffset: null, fileSize };
    }

    const midOffset =
      dataStartOffset + Math.floor((fileSize - dataStartOffset) / 2);

    const probeStart = Math.max(
      dataStartOffset,
      midOffset - LINE_BACKTRACK_BYTES,
    );
    const skipFirstPartialLine = probeStart > dataStartOffset;

    let splitOffset = await scanForTimestampTransition(
      handle,
      probeStart,
      fileSize,
      skipFirstPartialLine,
      false,
    );

    if (splitOffset === null && probeStart > dataStartOffset) {
      splitOffset = await scanForTimestampTransition(
        handle,
        dataStartOffset,
        fileSize,
        false,
        true,
      );
    }

    return {
      dataStartOffset,
      splitOffset,
      fileSize,
    };
  } finally {
    await handle.close();
  }
}

function spawnPartitionWorker(payload: WorkerTaskPayload): {
  promise: Promise<Encounter[]>;
  terminate: () => Promise<number>;
} {
  const isTsRuntime = import.meta.url.endsWith('.ts');
  const workerUrl = new URL(
    isTsRuntime ? './worker.ts' : './worker.js',
    import.meta.url,
  );

  const worker = new Worker(workerUrl, {
    workerData: payload,
    execArgv: isTsRuntime ? ['--import', TS_WORKER_HOOK_DATA_URL] : undefined,
  });

  const promise = new Promise<Encounter[]>((resolve, reject) => {
    let settled = false;

    worker.on('message', (msg: WorkerResponseMessage) => {
      if (settled) {
        return;
      }
      settled = true;
      if (msg.ok) {
        resolve(msg.encounters);
      } else {
        reject(reconstructWorkerError(msg.error));
      }
    });

    worker.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    worker.on('exit', (code: number) => {
      if (!settled) {
        settled = true;
        if (code !== 0) {
          reject(
            new Error(
              `Worker thread finalizou inesperadamente com código de saída ${code}.`,
            ),
          );
        } else {
          resolve([]);
        }
      }
    });
  });

  return {
    promise,
    terminate: () => worker.terminate(),
  };
}

/**
 * Executa o processamento paralelo de um dataset CSV dividindo-o em 2 Worker Threads
 * alinhadas à fronteira de `timestamp` próxima a `fileSize / 2`.
 */
export async function runParallel(
  filePath: string,
  options: ParallelRunnerOptions = {},
): Promise<Encounter[]> {
  const { highWaterMark } = options;
  if (
    highWaterMark !== undefined &&
    (!Number.isInteger(highWaterMark) || highWaterMark <= 0)
  ) {
    throw new RangeError(
      `Opção highWaterMark inválida (${highWaterMark}): esperado inteiro positivo.`,
    );
  }

  const { dataStartOffset, splitOffset, fileSize } =
    await findTimestampSplitOffset(filePath);

  if (fileSize === 0 || dataStartOffset >= fileSize) {
    return [];
  }

  if (splitOffset === null || splitOffset <= dataStartOffset) {
    return runStream(filePath, {
      start: dataStartOffset,
      end: fileSize - 1,
      highWaterMark,
    });
  }

  const worker1 = spawnPartitionWorker({
    filePath,
    start: dataStartOffset,
    end: splitOffset - 1,
    highWaterMark,
  });

  const worker2 = spawnPartitionWorker({
    filePath,
    start: splitOffset,
    end: fileSize - 1,
    highWaterMark,
  });

  try {
    const [encountersW1, encountersW2] = await Promise.all([
      worker1.promise,
      worker2.promise,
    ]);
    return [...encountersW1, ...encountersW2];
  } finally {
    await Promise.allSettled([worker1.terminate(), worker2.terminate()]);
  }
}

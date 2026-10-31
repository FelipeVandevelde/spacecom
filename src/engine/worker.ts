import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { Encounter } from '../domain/types.js';
import { runStream } from './stream-runner.js';

export interface WorkerTaskPayload {
  readonly filePath: string;
  readonly start: number;
  readonly end: number;
  readonly highWaterMark?: number;
}

export interface WorkerSerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export type WorkerResponseMessage =
  | { readonly ok: true; readonly encounters: Encounter[] }
  | { readonly ok: false; readonly error: WorkerSerializedError };

function validateWorkerPayload(payload: unknown): WorkerTaskPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new TypeError(
      'Payload inválido para Worker: esperado objeto WorkerTaskPayload.',
    );
  }

  const candidate = payload as Record<string, unknown>;
  const { filePath, start, end, highWaterMark } = candidate;

  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new TypeError(
      'Payload inválido para Worker: filePath deve ser uma string não vazia.',
    );
  }

  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0) {
    throw new RangeError(
      `Payload inválido para Worker: start (${String(start)}) deve ser inteiro >= 0.`,
    );
  }

  if (typeof end !== 'number' || !Number.isInteger(end) || end < start) {
    throw new RangeError(
      `Payload inválido para Worker: end (${String(end)}) deve ser inteiro >= start (${start}).`,
    );
  }

  if (
    highWaterMark !== undefined &&
    (typeof highWaterMark !== 'number' ||
      !Number.isInteger(highWaterMark) ||
      highWaterMark <= 0)
  ) {
    throw new RangeError(
      `Payload inválido para Worker: highWaterMark (${String(highWaterMark)}) deve ser inteiro positivo.`,
    );
  }

  return {
    filePath,
    start,
    end,
    highWaterMark: highWaterMark as number | undefined,
  };
}

/**
 * Executa a tarefa de leitura e detecção de encontros em uma partição de bytes `[start, end]`.
 */
export async function executeWorkerTask(
  payload: unknown,
): Promise<Encounter[]> {
  const validPayload = validateWorkerPayload(payload);
  return runStream(validPayload.filePath, {
    start: validPayload.start,
    end: validPayload.end,
    highWaterMark: validPayload.highWaterMark,
  });
}

if (!isMainThread && parentPort !== null) {
  const port = parentPort;
  void executeWorkerTask(workerData).then(
    (encounters) => {
      const msg: WorkerResponseMessage = { ok: true, encounters };
      port.postMessage(msg);
      port.close();
    },
    (error: unknown) => {
      const errObj =
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { name: 'Error', message: String(error) };
      const msg: WorkerResponseMessage = { ok: false, error: errObj };
      port.postMessage(msg);
      port.close();
    },
  );
}

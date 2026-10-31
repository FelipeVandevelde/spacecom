import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type { Encounter } from '../domain/types.js';
import { parsePositiveIntToken } from '../engine/entity-cache.js';
import {
  PARALLEL_THRESHOLD_BYTES,
  runParallel,
} from '../engine/parallel-runner.js';
import { runStream } from '../engine/stream-runner.js';
import {
  type DatasetValidationResult,
  type GroundTruthSummary,
  getOfficialGroundTruth,
  summarizeGroundTruthValidations,
  validateDatasetEncounters,
} from './validator.js';

export type ExecutionMode = 'single-thread' | 'multi-thread';

export interface ProcessDatasetOptions {
  readonly datasetId?: number;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly parallelThresholdBytes?: number;
  readonly highWaterMark?: number;
}

export interface DatasetExecutionResult {
  readonly datasetId?: number;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly fileSizeBytes: number;
  readonly mode: ExecutionMode;
  readonly encounters: readonly Encounter[];
  readonly encountersCount: number;
  readonly durationMs: number;
  readonly validation?: DatasetValidationResult;
}

export interface CliOptions {
  readonly inputDir?: string;
  readonly outputDir?: string;
  readonly datasetIds?: readonly number[];
  readonly parallelThresholdBytes?: number;
  readonly highWaterMark?: number;
  readonly silent?: boolean;
  readonly logger?: (message: string) => void;
}

export interface CliBenchmarkReport {
  readonly datasets: readonly DatasetExecutionResult[];
  readonly totalEncounters: number;
  readonly totalDurationMs: number;
  readonly averageDurationMs: number;
  readonly groundTruthSummary: GroundTruthSummary;
}

export const DEFAULT_DATASET_IDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const DEFAULT_INPUT_DIR = path.resolve('docs/datasets/inputs');
export const DEFAULT_OUTPUT_DIR = path.resolve('docs/datasets/output');

function validateDatasetIdsList(datasetIds: readonly number[]): void {
  if (datasetIds.length === 0) {
    throw new RangeError('A lista de datasetIds não pode ser vazia.');
  }

  const seen = new Set<number>();
  for (const id of datasetIds) {
    if (!Number.isInteger(id) || id < 1 || id > 7) {
      throw new RangeError(
        `ID de dataset inválido (${id}): esperado inteiro entre 1 e 7.`,
      );
    }
    if (seen.has(id)) {
      throw new RangeError(
        `ID de dataset duplicado (${id}): cada dataset deve ser listado no máximo uma vez.`,
      );
    }
    seen.add(id);
  }
}

/**
 * Processa um único dataset CSV, selecionando automaticamente entre `runStream` (`< 100 MB`)
 * e `runParallel` (`>= 100 MB`, 2 Worker Threads), valida contra o gabarito oficial quando
 * aplicável (datasets 1 e 2) e grava o arquivo JSON de saída.
 */
export async function processDatasetFile(
  options: ProcessDatasetOptions,
): Promise<DatasetExecutionResult> {
  const {
    datasetId,
    inputPath,
    outputPath,
    parallelThresholdBytes = PARALLEL_THRESHOLD_BYTES,
    highWaterMark,
  } = options;

  if (
    !Number.isFinite(parallelThresholdBytes) ||
    parallelThresholdBytes <= 0
  ) {
    throw new RangeError(
      `parallelThresholdBytes inválido (${parallelThresholdBytes}): esperado número positivo.`,
    );
  }

  const stat = await fs.promises.stat(inputPath);
  const fileSizeBytes = stat.size;
  const mode: ExecutionMode =
    fileSizeBytes >= parallelThresholdBytes ? 'multi-thread' : 'single-thread';

  const startTime = performance.now();
  const encounters =
    mode === 'multi-thread'
      ? await runParallel(inputPath, { highWaterMark })
      : await runStream(inputPath, { highWaterMark });
  const durationMs = performance.now() - startTime;

  let validation: DatasetValidationResult | undefined;
  if (
    datasetId !== undefined &&
    getOfficialGroundTruth(datasetId) !== undefined
  ) {
    validation = validateDatasetEncounters(datasetId, encounters);
    if (!validation.passed) {
      throw new Error(
        `Falha na validação do dataset ${datasetId}: esperado ${validation.expectedCount} encontros, obtido ${validation.actualCount} (ec=${validation.ec}, ei=${validation.ei}, score=${validation.score}, exactOrderMatch=${validation.exactOrderMatch}).`,
      );
    }
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(
    outputPath,
    JSON.stringify(encounters, null, 2),
    'utf8',
  );

  return {
    datasetId,
    inputPath,
    outputPath,
    fileSizeBytes,
    mode,
    encounters,
    encountersCount: encounters.length,
    durationMs,
    validation,
  };
}

/**
 * Interpreta argumentos de linha de comando opcionais (ex.: `--datasets=1,2`).
 */
export function parseCliArgs(argv: readonly string[]): {
  datasetIds?: number[];
} {
  let datasetIds: number[] | undefined;

  for (const arg of argv) {
    if (!arg.startsWith('--datasets=')) {
      throw new SyntaxError(
        `Argumento de CLI desconhecido ("${arg}"): apenas --datasets=1,2,...,7 é suportado.`,
      );
    }

    const rawList = arg.slice('--datasets='.length).trim();
    if (rawList.length === 0) {
      throw new SyntaxError('Argumento --datasets= não pode ser vazio.');
    }

    const ids = rawList.split(',').map((token) => {
      const trimmed = token.trim();
      let num: number;
      try {
        num = parsePositiveIntToken(
          trimmed,
          'ID de dataset inválido em --datasets',
        );
      } catch {
        throw new RangeError(
          `ID de dataset inválido em --datasets ("${trimmed}"): esperado inteiro entre 1 e 7.`,
        );
      }
      if (num < 1 || num > 7) {
        throw new RangeError(
          `ID de dataset inválido em --datasets ("${trimmed}"): esperado inteiro entre 1 e 7.`,
        );
      }
      return num;
    });

    validateDatasetIdsList(ids);
    datasetIds = ids;
  }

  return datasetIds !== undefined ? { datasetIds } : {};
}

/**
 * Executa o pipeline completo de detecção de encontros sobre a lista de datasets (padrão 1 a 7),
 * gerando `respostas{N}.json`, validando os gabaritos oficiais e exibindo a tabela de benchmark.
 */
export async function runCli(
  options: CliOptions = {},
): Promise<CliBenchmarkReport> {
  const inputDir = options.inputDir ?? DEFAULT_INPUT_DIR;
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const datasetIds = options.datasetIds ?? DEFAULT_DATASET_IDS;
  const parallelThresholdBytes =
    options.parallelThresholdBytes ?? PARALLEL_THRESHOLD_BYTES;
  const highWaterMark = options.highWaterMark;
  const log = options.silent ? () => {} : (options.logger ?? console.log);

  validateDatasetIdsList(datasetIds);

  log(
    '================================================================================',
  );
  log(' SPACECOM 2027 — Motor de Detecção de Encontros (Benchmark CLI)');
  log(
    '================================================================================',
  );

  const results: DatasetExecutionResult[] = [];
  const validations: DatasetValidationResult[] = [];
  let totalEncounters = 0;
  let totalDurationMs = 0;

  for (const id of datasetIds) {
    const inputPath = path.join(inputDir, `dataset${id}.txt`);
    const outputPath = path.join(outputDir, `respostas${id}.json`);

    const result = await processDatasetFile({
      datasetId: id,
      inputPath,
      outputPath,
      parallelThresholdBytes,
      highWaterMark,
    });

    results.push(result);
    totalEncounters += result.encountersCount;
    totalDurationMs += result.durationMs;

    if (result.validation !== undefined) {
      validations.push(result.validation);
    }

    const sizeMb = (result.fileSizeBytes / (1024 * 1024)).toFixed(2);
    const modeLabel =
      result.mode === 'multi-thread'
        ? 'Multi-Thread (2 Workers)'
        : 'Single-Thread';
    const valLabel =
      result.validation !== undefined
        ? ` | Gabarito: OK (ec=${result.validation.ec}, ei=${result.validation.ei})`
        : '';

    log(
      `[dataset${id}.txt] ${sizeMb.padStart(6)} MB | ${modeLabel.padEnd(24)} | Encontros: ${String(result.encountersCount).padStart(6)} | Tempo: ${result.durationMs.toFixed(2).padStart(8)} ms${valLabel}`,
    );
  }

  const averageDurationMs = totalDurationMs / results.length;
  const groundTruthSummary = summarizeGroundTruthValidations(validations);

  log(
    '--------------------------------------------------------------------------------',
  );
  log(`Total de Encontros Detectados : ${totalEncounters}`);
  if (validations.length > 0) {
    log(
      `Auditoria Gabaritos (1 e 2)   : ${groundTruthSummary.passed ? 'APROVADO' : 'FALHOU'} (soma_ec=${groundTruthSummary.somaEc}, soma_ei=${groundTruthSummary.somaEi}, Score=${groundTruthSummary.score})`,
    );
  }
  log(
    `Soma Total de Execução        : ${totalDurationMs.toFixed(2)} ms (${(totalDurationMs / 1000).toFixed(3)} s)`,
  );
  log(`Tempo Médio por Dataset       : ${averageDurationMs.toFixed(2)} ms`);
  log(
    '================================================================================',
  );

  return {
    datasets: results,
    totalEncounters,
    totalDurationMs,
    averageDurationMs,
    groundTruthSummary,
  };
}

function isCliEntryPoint(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) {
    return false;
  }
  try {
    return (
      path.resolve(entryArg) === path.resolve(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isCliEntryPoint()) {
  const parsedArgs = parseCliArgs(process.argv.slice(2));
  runCli({ datasetIds: parsedArgs.datasetIds }).catch((err: unknown) => {
    console.error(
      'Erro fatal durante a execução da CLI:',
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
  });
}

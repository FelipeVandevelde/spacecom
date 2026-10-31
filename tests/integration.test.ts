import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Encounter } from '../src/domain/types.js';
import {
  EMPTY_RESTRICTION_SET,
  EntityCache,
  parseRestrictionIds,
  stripWrappingQuotes,
} from '../src/engine/entity-cache.js';
import {
  CSV_HEADER,
  isHeaderLine,
  parseLine,
} from '../src/engine/line-parser.js';
import {
  DEFAULT_CHUNK_SIZE_BYTES,
  runStream,
} from '../src/engine/stream-runner.js';
import {
  PARALLEL_THRESHOLD_BYTES,
  findTimestampSplitOffset,
  runParallel,
} from '../src/engine/parallel-runner.js';
import { executeWorkerTask } from '../src/engine/worker.js';
import {
  WindowDetector,
  detectWindowEncounters,
} from '../src/engine/window-detector.js';
import {
  OFFICIAL_GROUND_TRUTH_DATASET_1,
  OFFICIAL_GROUND_TRUTH_DATASET_2,
  areEncountersEqual,
  summarizeGroundTruthValidations,
  validateDatasetEncounters,
} from '../src/cli/validator.js';
import {
  parseCliArgs,
  processDatasetFile,
  runCli,
} from '../src/cli/index.js';

const DATASET1_PATH = path.resolve('docs/datasets/inputs/dataset1.txt');
const DATASET2_PATH = path.resolve('docs/datasets/inputs/dataset2.txt');
const RESPOSTAS1_PATH = path.resolve('docs/datasets/output/respostas1.json');
const RESPOSTAS2_PATH = path.resolve('docs/datasets/output/respostas2.json');

describe('Engine — EntityCache e Parsing de Atributos Estáticos (CAP-1)', () => {
  it('remove aspas duplas envolventes, preserva strings sem aspas e rejeita aspas desbalanceadas', () => {
    expect(stripWrappingQuotes('"2024-01-01 00:00:00"')).toBe(
      '2024-01-01 00:00:00',
    );
    expect(stripWrappingQuotes('"10,20"')).toBe('10,20');
    expect(stripWrappingQuotes('""')).toBe('');
    expect(stripWrappingQuotes('sem-aspas')).toBe('sem-aspas');
    expect(stripWrappingQuotes('')).toBe('');
    expect(() => stripWrappingQuotes('"')).toThrow(SyntaxError);
    expect(() => stripWrappingQuotes('"sem-fechar')).toThrow(SyntaxError);
    expect(() => stripWrappingQuotes('sem-abrir"')).toThrow(SyntaxError);
  });

  it('converte idsRestricaoMedida em ReadonlySet<number> sem alocações desnecessárias', () => {
    expect(parseRestrictionIds('')).toBe(EMPTY_RESTRICTION_SET);
    expect(parseRestrictionIds('""')).toBe(EMPTY_RESTRICTION_SET);

    const single = parseRestrictionIds('"10"');
    expect([...single]).toEqual([10]);

    const multi = parseRestrictionIds('"1,2,35"');
    expect([...multi]).toEqual([1, 2, 35]);

    expect(() => parseRestrictionIds('"1,,2"')).toThrow(SyntaxError);
    expect(() => parseRestrictionIds('"1,abc"')).toThrow(SyntaxError);
    expect(() => parseRestrictionIds('"0"')).toThrow(SyntaxError);
    expect(() => parseRestrictionIds('"-5"')).toThrow(SyntaxError);
    expect(() => parseRestrictionIds('"1e2"')).toThrow(SyntaxError);
    expect(() => parseRestrictionIds('"0x10"')).toThrow(SyntaxError);
    expect(() => parseRestrictionIds('" 10 "')).toThrow(SyntaxError);
  });

  it('armazena e reutiliza a mesma referência de EntityProfile por idMonitorado em O(1)', () => {
    const cache = new EntityCache();
    expect(cache.size).toBe(0);

    const p1 = cache.getOrCreate(9, '', 'true', '"10,15"');
    const p2 = cache.getOrCreate(9, 'IgnoradoPorCache', 'false', '');

    expect(p1).toBe(p2);
    expect(cache.get(9)).toBe(p1);
    expect(cache.size).toBe(1);
    expect(p1.idMonitorado).toBe(9);
    expect(p1.faccaoMonitorado).toBe('');
    expect(p1.medidaProtetiva).toBe(true);
    expect(p1.idsRestricaoMedida.has(10)).toBe(true);
    expect(p1.idsRestricaoMedida.has(15)).toBe(true);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get(9)).toBeUndefined();
  });

  it('rejeita idMonitorado ou medidaProtetiva inválidos no EntityCache', () => {
    const cache = new EntityCache();
    expect(() => cache.getOrCreate(0, '', 'false', '')).toThrow(RangeError);
    expect(() => cache.getOrCreate(-1, '', 'false', '')).toThrow(RangeError);
    expect(() => cache.getOrCreate(1, '', 'talvez', '')).toThrow(SyntaxError);
  });
});

describe('Engine — LineParser de Baixa Alocação (CAP-1)', () => {
  it('identifica corretamente o cabeçalho CSV oficial (com LF, CRLF ou UTF-8 BOM)', () => {
    expect(isHeaderLine(CSV_HEADER)).toBe(true);
    expect(isHeaderLine(`${CSV_HEADER}\r`)).toBe(true);
    expect(isHeaderLine(`\uFEFF${CSV_HEADER}\r`)).toBe(true);
    expect(
      isHeaderLine('1;;"2024-01-01 00:00:00";-25.59386;-73.96319;false;'),
    ).toBe(false);
  });

  it('extrai PositionRecord removendo aspas de timestamp e idsRestricaoMedida e reutilizando o cache', () => {
    const cache = new EntityCache();
    const rec1 = parseLine(
      '9;;"2024-01-01 00:00:00";1.64046;-69.53947;true;"10"\r',
      cache,
    );
    const rec2 = parseLine(
      '9;;"2024-01-01 00:00:05";1.64142;-69.53950;true;"10"',
      cache,
    );

    expect(rec1.idMonitorado).toBe(9);
    expect(rec1.timestamp).toBe('2024-01-01 00:00:00');
    expect(rec1.latitude).toBe(1.64046);
    expect(rec1.longitude).toBe(-69.53947);
    expect(rec1.profile.medidaProtetiva).toBe(true);
    expect([...rec1.profile.idsRestricaoMedida]).toEqual([10]);
    expect(rec2.profile).toBe(rec1.profile);
  });

  it('rejeita linhas CSV malformadas ou com valores fora de domínio', () => {
    const cache = new EntityCache();

    expect(() => parseLine('linha-sem-ponto-e-virgula', cache)).toThrow(
      SyntaxError,
    );
    expect(() => parseLine('1;2;3;4;5;false', cache)).toThrow(SyntaxError);
    expect(() =>
      parseLine('1;;"2024-01-01 00:00:00";0;0;false;;extra', cache),
    ).toThrow(SyntaxError);
    expect(() =>
      parseLine('abc;;"2024-01-01 00:00:00";0;0;false;', cache),
    ).toThrow(SyntaxError);
    expect(() =>
      parseLine('1e2;;"2024-01-01 00:00:00";0;0;false;', cache),
    ).toThrow(SyntaxError);
    expect(() => parseLine('1;;"";0;0;false;', cache)).toThrow(SyntaxError);
    expect(() => parseLine('1;;"   ";0;0;false;', cache)).toThrow(SyntaxError);
    expect(() =>
      parseLine('1;;"2024-01-01 00:00:00";;0;false;', cache),
    ).toThrow(SyntaxError);
    expect(() =>
      parseLine('1;;"2024-01-01 00:00:00";   ;0;false;', cache),
    ).toThrow(SyntaxError);
    expect(() =>
      parseLine('1;;"2024-01-01 00:00:00";abc;0;false;', cache),
    ).toThrow(SyntaxError);
    expect(() =>
      parseLine('1;;"2024-01-01 00:00:00";95.0;0;false;', cache),
    ).toThrow(RangeError);
    expect(() =>
      parseLine('1;;"2024-01-01 00:00:00";0;-185.0;false;', cache),
    ).toThrow(RangeError);
  });
});

describe('Engine — WindowDetector (CAP-2, CAP-3)', () => {
  it('agrupa registros por timestamp, emite encontros ao trocar de janela e garante unicidade do par no mesmo timestamp', () => {
    const cache = new EntityCache();
    const detector = new WindowDetector();

    const r1 = parseLine(
      '4;;"2024-01-01 00:05:15";-31.93195;-40.61438;false;',
      cache,
    );
    const r2 = parseLine(
      '6;;"2024-01-01 00:05:15";-31.93187;-40.61435;false;',
      cache,
    );
    // Registro duplicado do mesmo par na mesma janela não deve gerar segundo encontro
    const r2Dup = parseLine(
      '6;;"2024-01-01 00:05:15";-31.93187;-40.61435;false;',
      cache,
    );
    const rNextWindow = parseLine(
      '4;;"2024-01-01 00:05:20";-31.93195;-40.61438;false;',
      cache,
    );

    expect(detectWindowEncounters([r1])).toEqual([]);

    detector.push(r1);
    detector.push(r2);
    detector.push(r2Dup);
    expect(detector.getEncounters()).toHaveLength(0);

    // Mudança de timestamp dispara detecção da janela anterior
    detector.push(rNextWindow);
    expect(detector.getEncounters()).toHaveLength(1);

    const finalEncounters = detector.flush();
    expect(finalEncounters).toHaveLength(1);
    expect(finalEncounters[0]?.monitoradosEncontro).toEqual([4, 6]);

    // Mutar o array retornado por flush() não altera o estado interno do detector
    finalEncounters.pop();
    expect(detector.getEncounters()).toHaveLength(1);
  });
});

describe('Engine — StreamRunner Single-Thread e Validação E2E nos Datasets 1 e 2 (CAP-1, CAP-2, CAP-3)', () => {
  it('mantém chunk padrão de 4 MB conforme especificação arquitetural', () => {
    expect(DEFAULT_CHUNK_SIZE_BYTES).toBe(4 * 1024 * 1024);
  });

  it('reproduz 100% dos encontros e distâncias de respostas1.json ao processar dataset1.txt', async () => {
    const expected = JSON.parse(
      fs.readFileSync(RESPOSTAS1_PATH, 'utf8'),
    ) as Encounter[];
    const cache = new EntityCache();

    const actual = await runStream(DATASET1_PATH, { cache });

    expect(actual).toHaveLength(4);
    expect(actual).toEqual(expected);
    expect(cache.size).toBe(10);
  });

  it('reproduz 100% dos encontros e distâncias de respostas2.json ao processar dataset2.txt', async () => {
    const expected = JSON.parse(
      fs.readFileSync(RESPOSTAS2_PATH, 'utf8'),
    ) as Encounter[];
    const cache = new EntityCache();

    const actual = await runStream(DATASET2_PATH, { cache });

    expect(actual).toHaveLength(6);
    expect(actual).toEqual(expected);
    expect(cache.size).toBe(20);
  });

  it('preserva precisão exata mesmo sob fragmentação extrema de chunks (highWaterMark = 64 bytes)', async () => {
    const expected = JSON.parse(
      fs.readFileSync(RESPOSTAS1_PATH, 'utf8'),
    ) as Encounter[];

    const actual = await runStream(DATASET1_PATH, { highWaterMark: 64 });
    expect(actual).toEqual(expected);
  });

  it('suporta leitura particionada por intervalo de bytes [start, end] alinhado à fronteira de timestamp', async () => {
    const expected = JSON.parse(
      fs.readFileSync(RESPOSTAS1_PATH, 'utf8'),
    ) as Encounter[];
    const rawBuffer = fs.readFileSync(DATASET1_PATH);

    // Localiza a transição entre dois timestamps diferentes próxima ao meio do arquivo
    const mid = Math.floor(rawBuffer.length / 2);
    const firstNlAfterMid = rawBuffer.indexOf(0x0a, mid);
    const probeText = rawBuffer
      .subarray(firstNlAfterMid + 1, firstNlAfterMid + 2048)
      .toString('utf8');
    const probeLines = probeText.split('\n').slice(0, -1);
    const firstTs = probeLines[0]?.split(';')[2];

    let offset = firstNlAfterMid + 1;
    for (const line of probeLines) {
      const ts = line.split(';')[2];
      if (ts !== firstTs) {
        break;
      }
      offset += Buffer.byteLength(line, 'utf8') + 1;
    }

    const part1 = await runStream(DATASET1_PATH, {
      start: 0,
      end: offset - 1,
    });
    const part2 = await runStream(DATASET1_PATH, {
      start: offset,
      end: rawBuffer.length - 1,
    });

    expect([...part1, ...part2]).toEqual(expected);
  });

  it('lida corretamente com arquivo vazio, linhas em branco e rejeita opções ou arquivos inválidos', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecom-test-'));
    const emptyFile = path.join(tmpDir, 'empty.txt');
    const badFile = path.join(tmpDir, 'bad.txt');

    try {
      fs.writeFileSync(emptyFile, '');
      expect(await runStream(emptyFile)).toEqual([]);

      fs.writeFileSync(badFile, `${CSV_HEADER}\n\nlinha_invalida\n`);
      await expect(runStream(badFile)).rejects.toThrow(SyntaxError);

      await expect(runStream(DATASET1_PATH, { start: -1 })).rejects.toThrow(
        RangeError,
      );
      await expect(runStream(DATASET1_PATH, { end: -1 })).rejects.toThrow(
        RangeError,
      );
      await expect(
        runStream(DATASET1_PATH, { start: 100, end: 50 }),
      ).rejects.toThrow(RangeError);
      await expect(
        runStream(DATASET1_PATH, { highWaterMark: 0 }),
      ).rejects.toThrow(RangeError);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Engine — ParallelRunner (2 Worker Threads) e Fronteira de Timestamp (CAP-4)', () => {
  it('define limiar de paralelismo em exatos 100 MB', () => {
    expect(PARALLEL_THRESHOLD_BYTES).toBe(100 * 1024 * 1024);
  });

  it('localiza fronteira limpa de timestamp próxima a fileSize / 2 sem dividir janelas', async () => {
    const splitInfo = await findTimestampSplitOffset(DATASET1_PATH);
    const rawBuffer = fs.readFileSync(DATASET1_PATH);

    expect(splitInfo.fileSize).toBe(rawBuffer.length);
    expect(splitInfo.dataStartOffset).toBe(CSV_HEADER.length + 1);
    expect(splitInfo.splitOffset).not.toBeNull();

    const splitOffset = splitInfo.splitOffset!;
    expect(rawBuffer[splitOffset - 1]).toBe(0x0a);

    const prevNl = rawBuffer.lastIndexOf(0x0a, splitOffset - 2);
    const lineBeforeSplit = rawBuffer
      .subarray(prevNl + 1, splitOffset - 1)
      .toString('utf8');
    const nextNl = rawBuffer.indexOf(0x0a, splitOffset);
    const lineAfterSplit = rawBuffer
      .subarray(splitOffset, nextNl)
      .toString('utf8');

    const tsBefore = lineBeforeSplit.split(';')[2];
    const tsAfter = lineAfterSplit.split(';')[2];
    expect(tsBefore).toBeDefined();
    expect(tsAfter).toBeDefined();
    expect(tsBefore).not.toBe(tsAfter);
  });

  it('executa 2 Worker Threads em paralelo reproduzindo 100% dos gabaritos de dataset1.txt e dataset2.txt', async () => {
    const [actual1, actual2] = await Promise.all([
      runParallel(DATASET1_PATH),
      runParallel(DATASET2_PATH),
    ]);

    expect(actual1).toEqual(OFFICIAL_GROUND_TRUTH_DATASET_1);
    expect(actual2).toEqual(OFFICIAL_GROUND_TRUTH_DATASET_2);
  });

  it('trata casos de borda no ParallelRunner e Worker (arquivo vazio, 1 único timestamp, erro em worker)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecom-parallel-'));
    const emptyFile = path.join(tmpDir, 'empty.txt');
    const headerOnlyFile = path.join(tmpDir, 'header.txt');
    const singleTsFile = path.join(tmpDir, 'single-ts.txt');
    const skewedFile = path.join(tmpDir, 'skewed.txt');
    const corruptFile = path.join(tmpDir, 'corrupt.txt');

    try {
      fs.writeFileSync(emptyFile, '');
      expect(await runParallel(emptyFile)).toEqual([]);

      fs.writeFileSync(headerOnlyFile, `${CSV_HEADER}\n`);
      expect(await runParallel(headerOnlyFile)).toEqual([]);

      fs.writeFileSync(
        singleTsFile,
        [
          CSV_HEADER,
          '4;;"2024-01-01 00:05:15";-31.93195;-40.61438;false;',
          '6;;"2024-01-01 00:05:15";-31.93187;-40.61435;false;',
        ].join('\n'),
      );
      const singleRes = await runParallel(singleTsFile);
      expect(singleRes).toHaveLength(1);
      expect(singleRes[0]?.monitoradosEncontro).toEqual([4, 6]);

      // Arquivo em que múltiplas transições ocorrem no início e a segunda metade tem apenas 1 timestamp
      const repeatedTail = Array.from(
        { length: 40 },
        (_, idx) =>
          `${idx + 10};;"2024-01-01 00:05:25";${(-10 - idx * 0.01).toFixed(5)};-40.00000;false;`,
      );
      fs.writeFileSync(
        skewedFile,
        [
          `\uFEFF\r\n${CSV_HEADER}`,
          '4;;"2024-01-01 00:05:15";-31.93195;-40.61438;false;',
          '6;;"2024-01-01 00:05:15";-31.93187;-40.61435;false;',
          '7;;"2024-01-01 00:05:20";-13.02054;-46.40609;false;',
          '8;;"2024-01-01 00:05:20";-13.02046;-46.40609;false;',
          ...repeatedTail,
        ].join('\r\n'),
      );
      const skewedSplit = await findTimestampSplitOffset(skewedFile);
      expect(skewedSplit.splitOffset).not.toBeNull();
      const skewedRaw = fs.readFileSync(skewedFile);
      const splitNextLine = skewedRaw
        .subarray(
          skewedSplit.splitOffset!,
          skewedRaw.indexOf(0x0a, skewedSplit.splitOffset!),
        )
        .toString('utf8');
      // Deve escolher a última transição antes da metade ("2024-01-01 00:05:25") e não a primeira ("2024-01-01 00:05:20")
      expect(splitNextLine).toContain('"2024-01-01 00:05:25"');
      const skewedRes = await runParallel(skewedFile);
      expect(skewedRes).toHaveLength(2);

      // Erro de coordenada inválida na segunda metade propaga RangeError preservando o tipo através do Worker
      fs.writeFileSync(
        corruptFile,
        [
          CSV_HEADER,
          '4;;"2024-01-01 00:05:15";-31.93195;-40.61438;false;',
          '6;;"2024-01-01 00:05:20";999.99999;-40.61435;false;',
        ].join('\n'),
      );
      await expect(runParallel(corruptFile)).rejects.toThrow(RangeError);

      await expect(
        runParallel(DATASET1_PATH, { highWaterMark: 0 }),
      ).rejects.toThrow(RangeError);

      await expect(executeWorkerTask(null)).rejects.toThrow(TypeError);
      await expect(
        executeWorkerTask({ filePath: '', start: 0, end: 10 }),
      ).rejects.toThrow(TypeError);
      await expect(
        executeWorkerTask({ filePath: DATASET1_PATH, start: -1, end: 10 }),
      ).rejects.toThrow(RangeError);
      await expect(
        executeWorkerTask({ filePath: DATASET1_PATH, start: 20, end: 10 }),
      ).rejects.toThrow(RangeError);
      await expect(
        executeWorkerTask({
          filePath: DATASET1_PATH,
          start: 0,
          end: 10,
          highWaterMark: 0,
        }),
      ).rejects.toThrow(RangeError);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('CLI — Validator e Orquestrador CLI com Benchmark (CAP-4, CAP-5)', () => {
  it('valida igualdade exata contra gabaritos oficiais e contabiliza ec, ei e score', () => {
    const v1 = validateDatasetEncounters(1, OFFICIAL_GROUND_TRUTH_DATASET_1);
    const v2 = validateDatasetEncounters(2, OFFICIAL_GROUND_TRUTH_DATASET_2);

    expect(v1.passed).toBe(true);
    expect(v1.ec).toBe(4);
    expect(v1.ei).toBe(0);
    expect(v1.score).toBe(4);

    expect(v2.passed).toBe(true);
    expect(v2.ec).toBe(6);
    expect(v2.ei).toBe(0);
    expect(v2.score).toBe(6);

    const summary = summarizeGroundTruthValidations([v1, v2]);
    expect(summary.passed).toBe(true);
    expect(summary.somaEc).toBe(10);
    expect(summary.somaEi).toBe(0);
    expect(summary.score).toBe(10);

    // Detecta falso negativo e falso positivo
    const tampered: Encounter[] = [
      ...OFFICIAL_GROUND_TRUTH_DATASET_1.slice(0, 3),
      {
        ...OFFICIAL_GROUND_TRUTH_DATASET_1[3]!,
        distanciaMetros: 19.999,
      },
    ];
    const vTampered = validateDatasetEncounters(1, tampered);
    expect(vTampered.passed).toBe(false);
    expect(vTampered.ec).toBe(3);
    expect(vTampered.falsePositives).toBe(1);
    expect(vTampered.falseNegatives).toBe(1);
    expect(vTampered.ei).toBe(2);
    expect(vTampered.score).toBe(1);

    // Detecta inversão de ordem mesmo quando ec === expectedCount e ei === 0
    const reversed = [...OFFICIAL_GROUND_TRUTH_DATASET_1].reverse();
    const vReversed = validateDatasetEncounters(1, reversed);
    expect(vReversed.ec).toBe(4);
    expect(vReversed.ei).toBe(0);
    expect(vReversed.exactOrderMatch).toBe(false);
    expect(vReversed.passed).toBe(false);

    expect(
      areEncountersEqual(
        OFFICIAL_GROUND_TRUTH_DATASET_1[0]!,
        OFFICIAL_GROUND_TRUTH_DATASET_1[1]!,
      ),
    ).toBe(false);

    expect(() => validateDatasetEncounters(3, [])).toThrow(RangeError);
  });

  it('interpreta argumentos --datasets da CLI e rejeita entradas inválidas, duplicadas ou flags desconhecidas', () => {
    expect(parseCliArgs([])).toEqual({});
    expect(parseCliArgs(['--datasets=1,2,7'])).toEqual({
      datasetIds: [1, 2, 7],
    });
    expect(() => parseCliArgs(['--datasets='])).toThrow(SyntaxError);
    expect(() => parseCliArgs(['--flag-desconhecida'])).toThrow(SyntaxError);
    expect(() => parseCliArgs(['--datasets=0'])).toThrow(RangeError);
    expect(() => parseCliArgs(['--datasets=8'])).toThrow(RangeError);
    expect(() => parseCliArgs(['--datasets=abc'])).toThrow(RangeError);
    expect(() => parseCliArgs(['--datasets=1e0'])).toThrow(RangeError);
    expect(() => parseCliArgs(['--datasets=0x1'])).toThrow(RangeError);
    expect(() => parseCliArgs(['--datasets=1,1'])).toThrow(RangeError);
  });

  it('roteia automaticamente entre single-thread (< limiar) e multi-thread (>= limiar) e grava JSON formatado', async () => {
    const tmpOutDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'spacecom-cli-out-'),
    );

    try {
      const outSingle = path.join(tmpOutDir, 'respostas1-single.json');
      const resSingle = await processDatasetFile({
        datasetId: 1,
        inputPath: DATASET1_PATH,
        outputPath: outSingle,
        parallelThresholdBytes: 100 * 1024 * 1024,
      });

      expect(resSingle.mode).toBe('single-thread');
      expect(resSingle.encountersCount).toBe(4);
      expect(resSingle.validation?.passed).toBe(true);
      expect(JSON.parse(fs.readFileSync(outSingle, 'utf8'))).toEqual(
        OFFICIAL_GROUND_TRUTH_DATASET_1,
      );

      // Força modo multi-thread com limiar de 1 KB sobre dataset2.txt
      const outMulti = path.join(tmpOutDir, 'respostas2-multi.json');
      const resMulti = await processDatasetFile({
        datasetId: 2,
        inputPath: DATASET2_PATH,
        outputPath: outMulti,
        parallelThresholdBytes: 1024,
      });

      expect(resMulti.mode).toBe('multi-thread');
      expect(resMulti.encountersCount).toBe(6);
      expect(resMulti.validation?.passed).toBe(true);
      expect(JSON.parse(fs.readFileSync(outMulti, 'utf8'))).toEqual(
        OFFICIAL_GROUND_TRUTH_DATASET_2,
      );

      // Falha na validação de gabarito impede a gravação de arquivo de saída inválido
      const outInvalid = path.join(tmpOutDir, 'nao-deve-existir.json');
      await expect(
        processDatasetFile({
          datasetId: 1,
          inputPath: DATASET2_PATH, // dataset2 comparado contra gabarito do dataset1 deve falhar
          outputPath: outInvalid,
        }),
      ).rejects.toThrow(/Falha na validação do dataset 1/);
      expect(fs.existsSync(outInvalid)).toBe(false);

      await expect(
        runCli({ outputDir: tmpOutDir, datasetIds: [1, 1] }),
      ).rejects.toThrow(RangeError);

      // Executa runCli completo para datasets 1 e 2 capturando logs de benchmark
      const logs: string[] = [];
      const report = await runCli({
        outputDir: tmpOutDir,
        datasetIds: [1, 2],
        logger: (msg) => logs.push(msg),
      });

      expect(report.totalEncounters).toBe(10);
      expect(report.groundTruthSummary.passed).toBe(true);
      expect(report.groundTruthSummary.somaEc).toBe(10);
      expect(report.groundTruthSummary.somaEi).toBe(0);
      expect(logs.some((l) => l.includes('soma_ec=10'))).toBe(true);
    } finally {
      fs.rmSync(tmpOutDir, { recursive: true, force: true });
    }
  });
});

# Motor de Detecção e Classificação de Encontros — Desafio Técnico Spacecom 2027

Solução de engenharia de alta performance em **TypeScript / Node.js** (zero dependências de produção) desenvolvida para o desafio técnico eliminatório do **Programa Trainee Tech Spacecom 2027**.

O sistema processa séries temporais massivas de geolocalização de monitorados (tornozeleiras eletrônicas) e vítimas de medidas protetivas (rastreadores portáteis) nos **7 datasets oficiais** (`dataset1.txt` de `0,25 MB` / `5.000` linhas até `dataset7.txt` de `608,64 MB` / `12.000.000` linhas, totalizando **~21,5 milhões de registros**), detectando e classificando encontros físicos com **zero falsos positivos ou falsos negativos** (`Score = soma_ec - soma_ei`) e tempo médio de execução mínimo.

---

## Sumário

1. [Lógica Utilizada e Arquitetura Algorítmica](#1-lógica-utilizada-e-arquitetura-algorítmica)
2. [Como Executar o Projeto](#2-como-executar-o-projeto)
3. [Por Que Esta é a Melhor Abordagem (Defesa Técnica)](#3-por-que-esta-é-a-melhor-abordagem-defesa-técnica)
4. [Auditoria dos 7 Datasets Oficiais e Resultados](#4-auditoria-dos-7-datasets-oficiais-e-resultados)
5. [Estrutura do Projeto](#5-estrutura-do-projeto)

---

## 1. Lógica Utilizada e Arquitetura Algorítmica

### 1.1. Regras de Negócio e Critério Geodésico
Um encontro físico ocorre quando **dois indivíduos distintos** possuem registros de posicionamento **exatamente no mesmo `timestamp`** (janelas discretas de 5 segundos) e estão separados por uma distância geodésica **estritamente menor que 20 metros** (`distanciaMetros < 20`).

A distância entre dois pontos $(\text{lat}_1, \text{lon}_1)$ e $(\text{lat}_2, \text{lon}_2)$ é calculada pela **Fórmula de Haversine** em ponto flutuante IEEE 754 de dupla precisão (`64 bits`), sem arredondamento intermediário, adotando o raio oficial da Terra $R = 6.371.000\text{ m}$:

$$\Delta\phi = (\text{lat}_2 - \text{lat}_1) \cdot \frac{\pi}{180}, \quad \Delta\lambda = (\text{lon}_2 - \text{lon}_1) \cdot \frac{\pi}{180}$$

$$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos\left(\text{lat}_1 \cdot \frac{\pi}{180}\right) \cdot \cos\left(\text{lat}_2 \cdot \frac{\pi}{180}\right) \cdot \sin^2\left(\frac{\Delta\lambda}{2}\right)$$

$$c = 2 \cdot \arcsin\left(\min(1, \sqrt{a})\right), \quad d = 6.371.000 \cdot c$$

### 1.2. Pré-Filtro Espacial (*Bounding Box*)
Antes de executar qualquer função trigonométrica (`Math.sin`, `Math.cos`, `Math.asin`, `Math.sqrt`), cada par de pontos passa por um filtro retangular de custo $O(1)$ baseado apenas em subtração e valor absoluto:

$$|\text{lat}_A - \text{lat}_B| \le 0{,}00025^\circ \quad \text{e} \quad |\text{lon}_A - \text{lon}_B| \le 0{,}00035^\circ$$

- Em qualquer latitude terrestre, $0{,}00025^\circ$ de latitude corresponde a $\approx 27{,}79\text{ m}$ ($> 20\text{ m}$).
- Em toda a faixa de latitudes dos datasets ($|\text{lat}| \le 35^\circ$), $0{,}00035^\circ$ de longitude cobre no mínimo $\approx 31{,}88\text{ m}$ ($> 20\text{ m}$).
- Esse pré-filtro possui **zero falsos negativos** para o limiar de $20\text{ m}$ e descarta mais de **99,9% dos pares** antes do cálculo de Haversine.

### 1.3. Árvore de Decisão e Precedência de Classificação
Para cada par $(A, B)$ com `distanciaMetros < 20` no mesmo `timestamp`:
1. **Unicidade e Ordenação Determinística:** Os identificadores são ordenados como `[menorId, maiorId]` (`[Math.min(idA, idB), Math.max(idA, idB)]`) e deduplicados dentro da janela temporal para garantir que cada par seja emitido no máximo uma vez por `timestamp`.
2. **Hierarquia Estrita de Classificação (`protetiva > faccao > generico`):**
   - **`protetiva`**: Prioridade máxima — ocorre quando `A.medidaProtetiva === true` e `B.idMonitorado` pertence a `A.idsRestricaoMedida`, **ou** quando `B.medidaProtetiva === true` e `A.idMonitorado` pertence a `B.idsRestricaoMedida`.
   - **`faccao`**: Segunda prioridade — ocorre quando não é um encontro de medida protetiva e ambos possuem o mesmo identificador de facção não vazio (`A.faccaoMonitorado !== '' && A.faccaoMonitorado === B.faccaoMonitorado`).
   - **`generico`**: Caso geral — qualquer outro encontro entre dois indivíduos posicionados a menos de 20 metros no mesmo `timestamp`.

```mermaid
flowchart TD
    Pair["Par (A, B) no mesmo timestamp com distanciaMetros < 20"] --> SortIDs["Ordena IDs: [min(A.id, B.id), max(A.id, B.id)]"]
    SortIDs --> CheckProt{"(A.medidaProtetiva && B.id in A.idsRestricao)\nOU\n(B.medidaProtetiva && A.id in B.idsRestricao)?"}
    CheckProt -- "Sim" --> Prot["tipo = 'protetiva'"]
    CheckProt -- "Não" --> CheckFac{"A.faccao !== '' &&\nA.faccao === B.faccao?"}
    CheckFac -- "Sim" --> Fac["tipo = 'faccao'"]
    CheckFac -- "Não" --> Gen["tipo = 'generico'"]
```

### 1.4. Pipeline de Streaming por Janelas Temporais, Parser sem `split()` e Cache de Entidades
Os datasets estão ordenados cronologicamente em janelas de 5 segundos. O motor explora essa propriedade estrutural através de quatro estágios acoplados:
1. **Leitura em Blocos (`stream-runner.ts`):** Consome o arquivo via `fs.createReadStream` com buffers de **4 MB** (`highWaterMark = 4.194.304 bytes`), transportando apenas a fração residual da última linha incompleta entre chunks.
2. **Parser de Baixa Alocação (`line-parser.ts`):** Localiza os 6 delimitadores `;` diretamente via `line.indexOf(';', pos)`, sem criar arrays intermediários (`String.prototype.split`) ou expressões regulares no caminho crítico. Remove aspas duplas envolventes de `timestamp` e `idsRestricaoMedida`.
3. **Cache O(1) de Perfil Estático (`entity-cache.ts`):** Atributos cadastrais (`faccaoMonitorado`, `medidaProtetiva` e o conjunto `ReadonlySet<number>` de `idsRestricaoMedida`) são invariantes por `idMonitorado`. O `EntityCache` realiza o parsing desses campos **apenas na primeira ocorrência** de cada monitorado (no máximo 120 indivíduos no maior dataset) e reutiliza a mesma referência em memória nas milhões de linhas subsequentes.
4. **Detector por Janela de Timestamp (`window-detector.ts`):** Acumula apenas os registros do `timestamp` corrente ($K \le 120$ registros). Assim que o `timestamp` muda (ou o arquivo chega ao fim), executa a comparação par a par $\frac{K(K-1)}{2}$ sobre o buffer da janela e o esvazia imediatamente.

```mermaid
flowchart LR
    Chunk["ReadStream Chunk (4 MB)"] --> Parser["Line Parser (indexOf ';')"]
    Parser --> Cache["Entity Cache O(1)\n(Perfil por idMonitorado)"]
    Cache --> Window{"Mesmo Timestamp?"}
    Window -- "Sim" --> Accumulate["Acumula no Buffer da Janela\n(K <= 120 registros)"]
    Window -- "Mudou / EOF" --> Detect["Window Detector\n1. Pré-filtro Bounding Box\n2. Haversine (R = 6.371.000m)\n3. Filtro distanciaMetros < 20"]
    Detect --> Classify["Classifier\n(protetiva > faccao > generico)"]
    Classify --> Emit["Emite Encounter\ne Limpa Buffer da Janela"]
```

### 1.5. Orquestração Híbrida Single-Thread vs. Multi-Thread (`< 100 MB` vs. `>= 100 MB`)
A CLI inspeciona o tamanho do arquivo antes da leitura e escolhe automaticamente a estratégia ótima:
- **Arquivos `< 100 MB` (`dataset1.txt` a `dataset5.txt`):** Executam diretamente em **Single-Thread** via `runStream`, evitando o custo fixo (~35–60 ms) de inicialização de novos Isolates V8 em arquivos pequenos e médios.
- **Arquivos `>= 100 MB` (`dataset6.txt` de 403,80 MB e `dataset7.txt` de 608,64 MB):** Executam em **Multi-Thread com 2 Worker Threads** (`node:worker_threads`) via `runParallel`.
  - **Particionamento Seguro por Fronteira de Timestamp (`findTimestampSplitOffset`):** Posiciona um ponteiro em `Math.floor(fileSize / 2)` e lê uma pequena janela de bytes para localizar o **offset exato em bytes onde termina uma janela completa de `timestamp` e começa o próximo `timestamp` distinto**.
  - O **Worker 1** processa `[dataStartOffset .. splitOffset - 1]` e o **Worker 2** processa `[splitOffset .. fileSize - 1]`, cada qual mantendo seu próprio `EntityCache` local em memória. Como nenhum `timestamp` é dividido entre os dois workers, não há necessidade de sincronização entre threads nem risco de perda de encontros na fronteira.

---

## 2. Como Executar o Projeto

### 2.1. Pré-requisitos
- **Node.js** `>= 22.0.0` (validado em Node.js `v24.14.0`).
- **npm** (incluso no Node.js).
- Os arquivos de entrada devem estar em `docs/datasets/inputs/dataset1.txt` a `dataset7.txt`.

### 2.2. Instalação das Dependências de Desenvolvimento
O projeto possui **zero dependências de produção** (`dependencies: {}`). Para instalar o compilador TypeScript e o framework de testes Vitest (`devDependencies`):

```bash
npm install
```

### 2.3. Compilação e Execução Oficial (Benchmark sobre os 7 Datasets)
Para aferir a performance real sem overhead de transpilação em tempo de execução, compile o TypeScript para JavaScript otimizado em `dist/` e execute a CLI compilada:

```bash
npm run build
npm start
```

> **Alternativa direta via Node.js (útil em ambientes Windows PowerShell com restrição de ExecutionPolicy para scripts `.ps1`):**
> ```bash
> node ./node_modules/typescript/bin/tsc
> node dist/cli/index.js
> ```

Ao executar `npm start` (ou `node dist/cli/index.js`), a aplicação:
1. Processa sequencialmente `dataset1.txt` a `dataset7.txt`.
2. Audita estrutural e matematicamente todos os encontros detectados.
3. Valida automaticamente os resultados de `dataset1.txt` e `dataset2.txt` contra os gabaritos oficiais (`soma_ec = 10`, `soma_ei = 0`, `Score = 10`).
4. Grava os 7 arquivos JSON padronizados em `docs/datasets/output/respostas1.json` a `docs/datasets/output/respostas7.json`.
5. Exibe no terminal a tabela consolidada de tempos individuais, soma total e tempo médio de execução.

### 2.4. Execução Seletiva de Datasets
É possível processar apenas um subconjunto de datasets passando o argumento `--datasets=`:

```bash
node dist/cli/index.js --datasets=1,2
node dist/cli/index.js --datasets=6,7
```

### 2.5. Execução da Suíte de Testes Automatizados
A suíte de testes unitários e de integração (Vitest) valida a precisão matemática de Haversine, casos de borda (`< 20 m` vs. `>= 20 m`), parser de linhas, cache de entidades, particionamento multi-thread e a integridade dos 7 arquivos `respostas1.json` a `respostas7.json`:

```bash
npm test
```

> Ou diretamente via Node.js:
> ```bash
> node ./node_modules/vitest/vitest.mjs run
> ```

---

## 3. Por Que Esta é a Melhor Abordagem (Defesa Técnica)

A arquitetura foi desenhada especificamente para maximizar os dois critérios oficiais de avaliação do edital: **Pontuação Máxima (`Score = soma_ec - soma_ei`, zero falsos positivos/negativos)** e **Menor Tempo Médio de Execução (critério de desempate)**.

### 3.1. Superação do Limite Físico do V8 (`ERR_STRING_TOO_LONG`) e Memória $O(1)$
No Node.js/V8 (64 bits), o tamanho máximo permitido para uma única string é `~512 MB` (`0x1fffffe8` caracteres). Uma abordagem ingênua com `fs.readFileSync(path, 'utf8')` falha fatalmente no `dataset7.txt` (`608,64 MB`).
- Nossa leitura via **Stream de Buffers de 4 MB** combinada com descarte imediato de cada janela de 5 segundos mantém o consumo de RAM estritamente constante ($O(K)$, onde $K \le 120$ registros por janela), processando `608,64 MB` com apenas algumas dezenas de megabytes de Heap.

### 3.2. Redução de Complexidade Algorítmica: de $O(N^2)$ para $O(T \cdot K^2)$ com Podas Espaciais
Comparar todos os $N = 12.000.000$ registros de `dataset7.txt` entre si exigiria $\approx 7{,}2 \times 10^{13}$ operações.
- Ao explorar a ordenação temporal em $T = 100.000$ janelas de $K = 120$ entidades, o espaço de busca cai para $100.000 \times \frac{120 \times 119}{2} = 7{,}14 \times 10^8$ pares por dataset.
- Com o **Pré-Filtro de Bounding Box** ($|\Delta\text{lat}| \le 0{,}00025^\circ, |\Delta\text{lon}| \le 0{,}00035^\circ$), mais de **99,9% desses pares são descartados em 2 subtrações**, reduzindo as chamadas trigonométricas da Fórmula de Haversine ao mínimo estritamente necessário.

### 3.3. Pressão Mínima sobre o Garbage Collector (Zero `split()` + `EntityCache`)
Em um volume de **21,5 milhões de linhas**, invocar `line.split(';')` e `idsRestricaoMedida.split(',')` a cada linha criaria mais de **40 milhões de arrays efêmeros**, causando pausas severas de *Garbage Collection* (*Stop-The-World*).
- O **Line Parser baseado em `indexOf(';')`** valida os 6 delimitadores da linha e extrai apenas as substrings necessárias.
- O **`EntityCache`** converte `faccaoMonitorado`, `medidaProtetiva` e `idsRestricaoMedida` (`Set<number>`) **uma única vez por `idMonitorado` em cada fluxo de execução** (1 cache em Single-Thread; 1 cache local por Worker em Multi-Thread). Após a primeira janela temporal de aquecimento (até 120 linhas por fluxo), o parser evita até mesmo fatiar (`line.slice`) as 3 colunas estáticas (`faccaoMonitorado`, `medidaProtetiva`, `idsRestricaoMedida`), consultando o perfil diretamente em $O(1)$ pelo `idMonitorado`.

### 3.4. Paralelismo Determinístico sem Contenção nem Perda de Fronteira
Para arquivos grandes ($\ge 100\text{ MB}$), o gargalo passa a ser a decodificação UTF-8 e o varrimento sequencial de centenas de megabytes em uma única thread.
- O **`ParallelRunner`** divide o arquivo ao meio em nível de bytes, mas ajusta o ponto de corte (`findTimestampSplitOffset`) para a **primeira transição exata entre dois `timestamp` distintos**.
- Isso garante **independência total de dados** entre os 2 Workers: não há *locks*, `SharedArrayBuffer` complexo ou necessidade de reconciliar janelas partidas, preservando a ordem cronológica exata na simples concatenação `[...part1, ...part2]`.

---

## 4. Auditoria dos 7 Datasets Oficiais e Resultados

Todos os 7 arquivos de saída foram gerados em `docs/datasets/output/respostas1.json` a `respostas7.json` e auditados quanto à conformidade de schema, unicidade por janela, ordenação `[menorId, maiorId]` e exatidão matemática da distância de Haversine (`< 20 m`):

| Dataset | Tamanho | Linhas | Modo de Execução | Encontros Detectados | `protetiva` | `faccao` | `generico` | Tempo de Referência | Auditoria / Gabarito |
| :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `dataset1.txt` | 0,25 MB | 5.000 | Single-Thread | **4** | 1 | 1 | 2 | ~14,65 ms | **100% Exato** (`ec=4, ei=0`) |
| `dataset2.txt` | 1,25 MB | 25.000 | Single-Thread | **6** | 1 | 2 | 3 | ~28,90 ms | **100% Exato** (`ec=6, ei=0`) |
| `dataset3.txt` | 5,02 MB | 100.000 | Single-Thread | **10** | 2 | 3 | 5 | ~90,50 ms | Auditado (Schema + Haversine) |
| `dataset4.txt` | 20,14 MB | 400.020 | Single-Thread | **15** | 3 | 5 | 7 | ~313,19 ms | Auditado (Schema + Haversine) |
| `dataset5.txt` | 50,39 MB | 999.999 | Single-Thread | **21** | 4 | 7 | 10 | ~804,02 ms | Auditado (Schema + Haversine) |
| `dataset6.txt` | 403,80 MB | 8.000.000 | Multi-Thread (2 Workers) | **27** | 6 | 9 | 12 | ~3.604,61 ms | Auditado (Schema + Haversine) |
| `dataset7.txt` | 608,64 MB | 12.000.000 | Multi-Thread (2 Workers) | **35** | 8 | 12 | 15 | ~7.208,66 ms | Auditado (Schema + Haversine) |
| **Total / Média** | **1.089,49 MB** | **21.530.019** | **Híbrido** | **118** | **25** | **39** | **54** | **12.064,52 ms (média: 1.723,50 ms)** | **`soma_ec=10, soma_ei=0`** |

---

## 5. Estrutura do Projeto

```text
spacecom/
├── src/
│   ├── domain/
│   │   ├── types.ts            # Contratos imutáveis PositionRecord, EntityProfile, Encounter, EncounterType
│   │   ├── haversine.ts        # Pré-filtro Bounding Box + cálculo Haversine IEEE 754 (R = 6.371.000m)
│   │   └── classifier.ts       # Hierarquia protetiva > faccao > generico e ordenação [minId, maxId]
│   ├── engine/
│   │   ├── entity-cache.ts     # Cache O(1) de perfil estático por idMonitorado e validação de tokens
│   │   ├── line-parser.ts      # Extração de campos via indexOf(';') sem split() ou regex
│   │   ├── window-detector.ts  # Agrupamento e comparação de pares na mesma janela de timestamp
│   │   ├── stream-runner.ts    # Leitura por chunks (4 MB) em intervalo de bytes [start, end]
│   │   ├── parallel-runner.ts  # Particionamento em fronteira limpa de timestamp + 2 Worker Threads
│   │   └── worker.ts           # Worker thread executando stream-runner na sua partição de bytes
│   └── cli/
│       ├── validator.ts        # Validação contra gabaritos (1 e 2) e auditoria estrutural/matemática (1 a 7)
│       └── index.ts            # Orquestrador CLI, roteamento <100MB vs >=100MB e relatório de benchmark
├── tests/
│   ├── domain.test.ts          # Testes unitários de distância, bordas (<20m vs >=20m) e classificação
│   └── integration.test.ts     # Testes E2E de motor, paralelismo, CLI e auditoria dos 7 outputs oficiais
├── docs/
│   ├── 1_etapa_tecnica.md      # Especificação oficial do desafio Spacecom 2027
│   └── datasets/
│       ├── inputs/             # dataset1.txt a dataset7.txt
│       └── output/             # respostas1.json a respostas7.json gerados e auditados
├── package.json
├── tsconfig.json
└── README.md
```

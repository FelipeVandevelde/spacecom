# Programa Trainee Tech Spacecom 2027

## Desafio técnico: Detecção de Encontros

Na Spacecom, desenvolvemos soluções tecnológicas voltadas para segurança
pública. Para este primeiro desafio, você lidará com um cenário de
monitoramento e detecção de encontros entre indivíduos utilizando nossas
tecnologias de rastreamento.

A seguir, estão detalhados o escopo, as regras de negócio e os critérios
de entrega.

> **Importante:** O cenário abordado reflete um problema estrutural real
> da engenharia da Spacecom, mas todos os dados fornecidos para o
> desafio são totalmente fictícios.

------------------------------------------------------------------------

## O Desafio: Detecção de Encontros

Seu objetivo é desenvolver um algoritmo capaz de processar dados de
geolocalização e detectar encontros físicos entre duas entidades:

-   **Monitorados/agressores:** indivíduos utilizando tornozeleiras
    eletrônicas.
-   **Vítimas:** pessoas com medidas protetivas utilizando rastreadores
    portáteis.

### Tipos de encontros a serem detectados

-   **Encontros genéricos:** encontro entre quaisquer dois monitorados.
-   **Encontros de facções:** encontro entre dois monitorados que
    pertencem à mesma facção.
-   **Encontros de medidas protetivas:** encontro entre um agressor e
    sua respectiva vítima.

## Regras de Negócio e Requisitos Técnicos

-   **Tecnologia obrigatória:** JavaScript ou TypeScript, utilizando
    Node.js ou frameworks similares.
-   **Utilização de IA:** é permitido utilizar ferramentas de
    inteligência artificial. Porém, será avaliada principalmente a forma
    como essas ferramentas são utilizadas, bem como a capacidade de
    defender a solução apresentada no desafio e em etapas futuras do
    processo. O mais importante é saber o que está construindo.
-   **Distância limite:** o raio para configurar um encontro é de **20
    metros** (distância estritamente menor que 20 metros).
-   **Cálculo de distância:** utilizar a **Fórmula de Haversine**,
    considerando o raio da Terra como **6.371.000 metros**.
-   **Análise de timestamps:** os posicionamentos são gerados a cada 5
    segundos (por exemplo, `2026-10-01 00:00:00` e
    `2026-10-01 00:00:05`). Devem ser comparados apenas os
    posicionamentos que possuem exatamente o mesmo timestamp.
-   **Unicidade:** cada encontro deve ser registrado apenas uma vez por
    par de envolvidos naquele timestamp. A ordem dos IDs no array do
    resultado não impacta a solução.

## Datasets de Input

Serão disponibilizados **7 datasets** em formato `.txt`.

Os dois primeiros contêm as respostas corretas para validação da lógica.
Os cinco restantes são os datasets oficiais utilizados para avaliar e
pontuar a solução. Os datasets de teste possuem os respectivos arquivos
JSON de resposta.

**Formato do input:** 
Os arquivos de entrada utilizam separação por ponto e vírgula (`;`), no
estilo CSV, com o seguinte cabeçalho:

``` text
idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida
```
- `idMonitorado`:               Identificador da pessoa monitorada,
                                      podendo ser usuário de tornozeleira
                                      ou vítima de medida protetiva.
- `faccaoMonitorado`:                 Identificador da facção do
                                      monitorado. Pode estar vazio;
                                      apenas usuários de tornozeleira
                                      possuem esse campo preenchido.

- `timestamp`: Data do posicionamento no formato
                                      `YYYY-MM-DD HH:MM:SS`.
-   `latitude`:                     Latitude do posicionamento, em
                                      formato `float` com 5 casas
                                      decimais.
-   `longitude`:                        Longitude do posicionamento, em
                                      formato `float` com 5 casas
                                      decimais.
-   `medidaProtetiva`:                   Booleano que indica se a pessoa
                                      monitorada possui medida protetiva.
-   `idsRestricaoMedida`:                Array de IDs dos monitorados
                                      agressores, caso a pessoa possua
                                      medida protetiva, no formato
                                      `"1,2,3,...n"`.
---

## Formato do Output

Para cada dataset processado, a aplicação deve gerar um arquivo JSON
contendo um array com os encontros detectados, seguindo estritamente
esta estrutura:

``` json
[
  {
    "tipo": "faccao",
    "monitoradosEncontro": [40, 44],
    "timestamp": "2024-01-01 00:01:50",
    "posicoes": {
      "40": {
        "lat": -10.07996,
        "lon": -37.08384
      },
      "44": {
        "lat": -10.07987,
        "lon": -37.08389
      }
    },
    "distanciaMetros": 11.406788673336607
  }
]
```

Valores aceitos para o campo `tipo`:

-   `generico`
-   `faccao`
-   `protetiva`

## Pontuação e Avaliação

A pontuação final do desafio será calculada com base na seguinte
fórmula:

**Score = soma_ec - soma_ei**

Em que:

-   `soma_ec` é a somatória dos encontros corretamente detectados.
-   `soma_ei` é a somatória dos encontros incorretos ou falsos positivos
    em todos os arquivos de output.

### Critério de desempate

Será considerada a soma do tempo médio de execução do algoritmo para
cada dataset. Soluções mais eficientes e performáticas terão vantagem.

## O que deve ser entregue

A resposta deve ser enviada diretamente ao e-mail recebido, contendo:

1.  **Código-fonte completo** da solução.
2.  **Arquivo `README.md`**, descrevendo:
    -   a lógica utilizada;
    -   como executar o projeto;
    -   por que essa é considerada a melhor abordagem para o problema.
3.  **Arquivos de output (JSON)** gerados pelo algoritmo para os
    datasets resolvidos.

### Atenção ao envio

Provedores de e-mail costumam bloquear anexos com extensões `.js` ou
`.ts`. Para garantir o recebimento da entrega, envie todos os arquivos
compactados em `.zip` ou forneça um link seguro para download (Google
Drive, GitHub, OneDrive etc.).

## 7. Início do Desafio e Prazo

-   **Liberação dos datasets:** 30/10/2026, às 18:00:00.
-   **Prazo máximo para envio da solução:** 03/11/2026, às 23:59:59.
-   E-mails recebidos após esse horário não serão considerados.
-   Caso seja enviado mais de um e-mail dentro do prazo, será avaliada
    apenas a última versão recebida.
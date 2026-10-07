# Estakalc — Plano de desenvolvimento (rascunho v0.1)

Software web para dimensionamento de fundações profundas (estacas + blocos de coroamento), com interação solo-estaca (Winkler), otimização de custo e detalhamento.

> Regra do projeto: nenhum valor/coeficiente entra no código sem fonte rastreável (livro/página/norma). Onde a fonte não foi confirmada, está marcado **[VERIFICAR]**.

---

## 1. Inventário das fontes (pasta `Fontes/`)

| Fonte | Conteúdo útil | Texto extraível? |
|---|---|---|
| Velloso & Lopes – *Fundações: volume completo* (2 cópias idênticas) | Cap. 15 *Estacas sob esforços transversais*: Winkler, kh/nh, Terzaghi, curvas p-y (API), Matlock-Reese, Davisson-Robinson, efeito de grupo; métodos de capacidade de carga (Aoki-Velloso, Décourt-Quaresma, etc.) | Sim, mas OCR ruim (fórmulas corrompidas) |
| Campos – *Elementos de fundações em concreto* | Blocos sobre estacas (cap. 12 carga centrada, cap. 13 excêntrica), método das bielas, detalhamento 1 a 6 estacas | Sim |
| Alonso – *Dimensionamento de fundações profundas* | Dimensionamento estrutural de estaca (compressão/flexão), cálculo de estaqueamento (Schiel, Nökkentved), módulo de reação | Sim, OCR muito ruim |
| Marangon – *Geotecnia de fundações* (UFJF) | Parâmetros geotécnicos, investigação, capacidade de carga | Sim |
| Lima (UFG, 2015) – estacas sob esforços transversais | Winkler por **diferenças finitas** (equação, condições de contorno), Hetenyi, Matlock-Reese, Broms, validação | Sim |
| Milhomem (CEULP, 2021) – estacas sob cargas horizontais | Memorial de cálculo completo (caso de referência) | Sim |
| Christan (UTFPR, 2012) – interação solo-estaca horizontal | Dissertação, modelos de interação | Sim |
| Saraiva Jr. (UFU, 2022) – hélice contínua | Previsão de capacidade/recalque, comparação de métodos | Sim |
| Moreira – *Análise matricial de estruturas*; Câmara (viga FE); Marinho (EF diversos) | Método da rigidez, elemento de viga, molas | Sim |
| `Capacidade Carga Estacas-SPT 12.xls` | Planilha Aoki-Velloso, Décourt-Quaresma, Teixeira (com tabelas K, α, F1, F2, C) → **benchmark de validação** | Sim (xlrd) |
| *Fundações Profundas* (cap. 4, NBR 6122/1996) | Definições e tipos | Sim |
| Berberian; Cintra & Aoki (2 arquivos); Guia prático; Retrospectiva e técnicas modernas; Velloso vol. 1 | — | **Não** (PDF escaneado, sem texto). Precisam de OCR (não há Tesseract instalado) |

Observações: (a) as NBR 6122 e NBR 6118 **atuais não estão na pasta** — só a NBR 6122/1996 citada em livro; (b) o OCR corrompido significa que toda fórmula/tabela extraída dos livros deve ser conferida visualmente na página do PDF antes de entrar no código.

## 2. Pesquisa na internet — o que foi e não foi encontrado

- **software de referência**: nenhuma página oficial/documentação encontrada na busca. Não vou assumir funcionalidades dele. Se você tiver manual/prints, ajudam muito a definir paridade de recursos.
- Winkler/p-y para estacas horizontais: confirmado como abordagem usual (viga em meio elástico; métodos linear/Matlock-Reese para solos não coesivos, constante/Vesic para coesivos). Detalhes numéricos virão dos livros na pasta.
- NBR 6122:2022: a busca confirmou só trechos soltos (ex.: diâmetro mínimo da armadura principal de 10 mm; compensação de corrosão em estacas de concreto armado tracionadas). **Limites de tensão do concreto, armaduras mínimas e tolerâncias de execução por tipo de estaca: [VERIFICAR] — preciso do texto da norma.**

## 3. Modelo de cálculo proposto

### 3.1 Cadeia de cálculo
```
Sondagem SPT ──► Perfil geotécnico (camadas, NA)
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
Capacidade de carga         Parâmetros de reação horizontal
(Aoki-Velloso, Décourt-     (nh/kh por camada a partir de N_SPT)
 Quaresma, Teixeira)                │
        │                           ▼
        │        Modelo do grupo: bloco rígido (6 GDL) + estacas
        │        como vigas-coluna sobre molas Winkler
        │        ◄── combinações de carga por pilar
        │        ◄── coordenadas/inclinação reais das estacas (desvios)
        │                           │
        ▼                           ▼
 Verif. geotécnica        Esforços N, V, M ao longo de cada estaca
 (carga máx/mín/tração)   + deslocamentos da cabeça
        └───────────┬───────────────┘
                    ▼
     Dimensionamento estrutural da estaca (N+M, cisalhamento)
                    ▼
     Otimização de custo (diâmetro × comprimento × armadura)
                    ▼
     Dimensionamento/detalhamento do bloco (bielas e tirantes)
                    ▼
     Memorial + desenhos
```

### 3.2 Núcleo da interação solo-estaca (Winkler)
- Equação: EI·d⁴y/dz⁴ + kh·B·y = 0, com `p = kh·y` e `kh = nh·z/B` (ou constante), conforme Velloso & Lopes cap. 15 e Lima (2015).
- Solução numérica por **elementos finitos de viga (matriz de rigidez) com molas laterais** por camada — mais geral que diferenças finitas (permite camadas, EI variável, estaca inclinada, grupo completo). Diferenças finitas (Lima 2015) e Matlock-Reese/Hetenyi (soluções fechadas) entram como **validação**.
- Grupo: bloco rígido com 6 GDL; rigidez do grupo = soma das rigidezas de cabeça de cada estaca transformadas para o referencial global → desloca o bloco → esforços em cada estaca. Isso trata naturalmente estacas fora de posição (basta informar x, y reais e inclinação).
- Evolução em fases: linear → kh reduzido por nível de deslocamento/ciclagem (V&L discutem reduções de 1/2 a 1/3 e de 50–60 % para drenado) → curvas p-y (API: argila mole, argila rija, areia) → EI fissurado (não linear) → efeito de grupo (V&L citam redução para espaçamento de 3B, Davisson 1970).

### 3.3 Parâmetros do solo a partir do SPT
- Capacidade: Aoki-Velloso (K, α, F1, F2), Décourt-Quaresma (C, Np, Nl), Teixeira — tabelas já presentes na planilha fornecida; **cruzar com os livros antes de usar**.
- Reação horizontal: V&L (cap. 15) dá `kh ≈ E/B` e correlação E' ≈ 2N (MN/m²) (Lopes et al., 1994) + tabelas de Terzaghi (areias) e de argilas moles. **A leitura do OCR dessas equações está duvidosa — conferir na página original.** O usuário poderá sobrescrever nh por camada (decisão técnica dele).

### 3.4 Dimensionamento estrutural e otimização
- Seção circular em flexo-compressão (diagrama N–M, NBR 6118) para cada seção ao longo da estaca; cisalhamento; verificação de tração.
- Espaço de busca discreto: diâmetros comerciais × comprimento × (nº de barras, bitola, estribos). Para cada candidato roda-se o modelo, checa-se geotecnia + estrutura + deslocamento, e calcula-se custo = concreto + aço + perfuração/execução (+ itens do usuário). Saída: melhor solução e **fronteira de Pareto** para o usuário escolher.
- Importante: o diâmetro muda a rigidez e portanto os esforços — o modelo é reexecutado por candidato (rápido, é um problema pequeno).

### 3.5 Blocos de coroamento
- Método das bielas e tirantes (Campos cap. 12/13; Blévot) para 1 a 6+ estacas; carga excêntrica e momentos; estacas deslocadas (geometria arbitrária → verificar se o modelo de bielas padrão ainda vale ou usar modelo genérico). **[VERIFICAR com você a abrangência.]**

## 4. Arquitetura sugerida
- Motor de cálculo em **TypeScript** rodando no navegador (recálculo instantâneo ao mexer em parâmetros, sem servidor, fácil de publicar). Álgebra linear pequena (sistemas de dezenas a centenas de GDL) — viável sem biblioteca pesada.
- UI web (React + Vite): entrada de sondagem, perfil, cargas/combinações, planta do bloco com estacas arrastáveis, gráficos N/V/M/y, tabela de custos, relatório.
- Scripts **Python** (numpy/scipy, já instalados) só como referência independente para validar o motor.
- Persistência local (arquivo de projeto JSON); backend só se você quiser multiusuário/conta.

## 5. Fases
| Fase | Entrega | Validação |
|---|---|---|
| 0 | Extração/OCR e fichamento das fórmulas e tabelas (com página de origem) | Conferência visual |
| 1 | Perfil SPT + capacidade de carga (3 métodos) | Reproduzir a planilha `.xls` |
| 2 | Estaca isolada horizontal: viga FE + molas (kh const. e linear) | Hetenyi, Matlock-Reese, Lima (2015), V&L |
| 3 | Grupo + bloco rígido + combinações + estacas deslocadas | Alonso (Schiel/Nökkentved), exemplos da bibliografia, equilíbrio global |
| 4 | Dimensionamento estrutural da estaca (N–M) | Cálculo manual / exemplos Milhomem |
| 5 | Otimização de custo e Pareto | Casos comparados manualmente |
| 6 | Bloco de coroamento + detalhamento | Exemplos Campos |
| 7 | Não linearidades (p-y, EI fissurado, grupo) | Literatura / provas de carga (Saraiva Jr.) |
| 8 | Relatório/memorial, exportação (DXF/PDF) | — |

## 6. Decisões já tomadas (v0.2)
1. Normas adicionadas em `Normas/`: NBR 6122:2022, NBR 6118 (edição 2026), NBR 6123:2023 (vento; fora do escopo). **Faltam**: NBR 16258 (estacas pré-moldadas — a 6122 remete a ela), NBR 12131 (prova de carga) se quiser.
2. Tipos de estaca: escavada (com e sem fluido), hélice contínua, raiz, pré-moldada, Franki e Strauss.
3. Combinações de carga entram prontas, por arquivo (formato a definir — ver 7.2).
4. Apenas estacas **verticais** nesta versão.
5. Referência de recursos: software de referência (andrekengenharia.com.br/estak-pro) — resumo em 6.1.
6. OCR instalado (Tesseract 5.4 + idioma português, pasta local); rodando nos escaneados relevantes a estacas.
7. Motor em TypeScript no navegador; prioridade: rápido, eficiente e fácil de entender.

### 6.1 O que o software de referência oferece (fonte: página do fabricante)
Capacidade de carga por Aoki-Velloso, Décourt-Quaresma e Teixeira "por furo de sondagem"; recalques (Aoki-Lopes) com efeito de grupo; armadura em flexão composta oblíqua; diagramas M, N, V, deslocamento horizontal e tensões; reanálise com coordenadas reais se houver desvio de locação; memorial PDF e detalhamento DXF. Limites: blocos até 10 estacas, até 10 furos SPT, até 10 camadas (mín. 1 m), SPT até 50 m; estacas circulares ou retangulares; Windows apenas, licença paga.
**Diferenciais propostos para o Estakalc:** web (qualquer SO), otimização de custo diâmetro × armadura, interação Winkler explícita, sem limite rígido de estacas.
*Não encontrei na página* o método exato de carga horizontal do software de referência; não vou supor.

### 6.2 Valores já confirmados na NBR 6122:2022 (conferidos visualmente na página)
- **Tabela 4** (p. 34): concreto/argamassa mínimo, γc, armadura mínima 0,4 %, comprimento mínimo armado e tensão abaixo da qual não precisa armar, por tipo de estaca e CAA. Ex.: hélice CAA I/II: C30, γc 2,7, 4,0 m, 6,0 MPa; escavada s/ fluido I/II: C25, γc 3,1, 2,0 m, 5,0 MPa (III/IV: C40, γc 5,0); escavada c/ fluido I/II: C30, γc 2,7, 4,0 m, 6,0 MPa (III/IV: C40, γc 3,6); Strauss: 20 MPa, γc 2,5, 2,0 m, 5,0 MPa; Franki: 20 MPa, γc 1,8, armadura integral; raiz: 20 MPa, γc 1,6, integral. γs = 1,15; γf = 1,4. Nota (b): em Strauss, Franki e raiz o diâmetro de cálculo é o externo do revestimento. Nota (c): espaçamento entre barras ≥ um diâmetro e ≥ 20 mm; taxa máxima 8 % Ac (barras < 310 mm) — **texto exato a conferir ao implementar**.
- **8.5.6**: excentricidades executivas — estaca isolada/alinhada deve resistir aos momentos de excentricidade (ou travar com vigas); só exige reavaliação se > 10 % da menor dimensão da estaca. Bloco com estacas não alinhadas: aceita-se **até +10 %** na carga axial sem correção/reforço. **8.5.7**: desaprumo > 1:100 obriga revisar a segurança.
- **8.6.2**: cobrimento conforme NBR 6118 pela CAA; alternativa simplificada: reduzir 2 mm no diâmetro das barras longitudinais (espessura de sacrifício).
- **6.2.1.2.1**: método semiempírico — FS global 2,0 / ponderador 1,4; Rk = mín[(Rse)méd/ξ1; (Rse)mín/ξ2], Tabela 2 (ξ1, ξ2 por nº de perfis). **Detalhe de Padm = Rk/FSg a conferir na página** (o texto extraído mostra "FSg = 1,4" ao lado de 2,0).
- **6.3**: vento como ação principal permite majorar carga admissível em 15 % (FS ≥ 1,6) ou força resistente de cálculo em 10 %.
- **8.4.2**: esforços transversais — considerar plastificação do solo ou do elemento estrutural nos ELU e ELS.

## 7. Propostas e perguntas abertas
### 7.1 Escopo inicial sugerido
Estacas circulares (as 6 tipologias). Retangulares (barretes) ficam para depois — software de referência tem, mas você não pediu.
### 7.2 Formato do arquivo de combinações (minha recomendação)
Um **.xlsx/.csv** com uma linha por (pilar, combinação): `Pilar; Combinação; Tipo (ELU/ELS); Fx; Fy; Fz; Mx; My; (Mz opcional)` + planilha-modelo para baixar. Além do upload, o usuário também poderá digitar/colar na tela. Quer unidades kN e kN·m, com convenção de sinais definida por um desenho na tela? (**preciso da sua confirmação**)
### 7.3 Perguntas ainda abertas
1. **Verificação geotécnica**: usar valores admissíveis (FS global 2,0) ou estados limites (ponderador 1,4)? Sugiro oferecer ambos, como a 6122 permite.
2. **Carga transversal e normas**: a 6122 não traz método de cálculo para carga horizontal (só exige considerar). Posso usar Winkler com nh de Velloso & Lopes/Terzaghi — o usuário poderá sobrescrever. De acordo?
3. **Pré-moldada**: sem a NBR 16258 não fixo tensões/armaduras dessas estacas. Você consegue incluí-la na pasta? Enquanto isso entra com dados informados pelo usuário (seção e resistência do fabricante).
4. **Custos**: itens sugeridos — concreto (R$/m³), aço (R$/kg), execução da estaca (R$/m, por diâmetro), mobilização, arrasamento, bloco (formas/concreto/aço). Algum outro?
5. Nome do produto: mantemos "Estakalc"?

## 8. Status (v0.3)
- **Decisões do usuário**: arquivo de combinações em **.csv**; critério de segurança padrão = o mais conservador, editável; Winkler com nh de Velloso & Lopes/Terzaghi (editável por camada); custos adicionais permitidos; NBR 16258 adicionada em `Normas/`.
- **Fase 1 (em andamento)** — código em `app/` (Vite + React + TypeScript + Vitest):
  - `src/core/capacity/`: Aoki-Velloso, Décourt-Quaresma, Teixeira, segurança NBR 6122:2022 (6.2.1.2.1).
  - Aoki-Velloso reproduz a planilha `.xls` (testes `npx vitest run`). Décourt-Quaresma e Teixeira conferidos com cálculo manual das fórmulas do livro (a aba D-Q da planilha tem lógica própria de N_L e não foi usada como referência).
  - Tabelas com procedência `livro` / `adaptado` (valores da planilha para solos mistos e tipos de estaca fora do livro geram aviso na tela).
  - Tela inicial: SPT de um furo, tipo/diâmetro da estaca, três métodos lado a lado.
- Pendente na Fase 1: vários furos (ξ da Tab. 2), importação CSV da sondagem, gráfico, conferência das notas das tabelas com a edição impressa.

## 9. Pesquisa complementar (v0.4)

### 9.1 Vídeo de referência do software de referência (módulo de dimensionamento estrutural, 7 min 39 s)
Não consegui obter a transcrição; analisei **quadros do vídeo** (interface em baixa resolução, só registro o que ficou legível):
- **Abas**: Dados (SPT) · Lançamento · Parâmetros geotécnicos · Parâmetros estruturais · Resultados geotécnicos · Análise estrutural · Dimensionamento estrutural; menus Arquivo, Relatório, Verificar Projeto, Dados do usuário.
- **Parâmetros estruturais**: tabela por tipo de estaca com CAA, fck, γc, % armadura mínima, comprimento mínimo e tensão sem armar — **é a Tabela 4 da NBR 6122:2022** (mesmos valores que conferi); parâmetros do bloco (dimensão lateral, ângulo das bielas, altura mínima), estacas (cobrimento lateral, espaçamento), concreto (agregado, γc, γs, CAA), opção "reduzir 2 mm no diâmetro das barras longitudinais" (NBR 6122, 8.6.2), "desconsiderar peso próprio do bloco/estacas", erro máximo do diagrama de interação, tensão de tração admissível.
- **Dimensionamento estrutural**: entrada de φ longitudinal, nº de barras, φ e espaçamento dos estribos (helicoidal), "ancorar armadura no topo do bloco", botão "Calcular armaduras"; saída com desenho da seção e da estaca, tabela de armadura por estaca, **resumo de materiais** (kg), verificação de esforço normal (Nd, FS), cortante (Vd crítico, Asw calculada/efetiva), tabela de momentos por profundidade (Md em duas direções, FS) e **diagrama de interação** de flexão composta oblíqua com a "situação crítica".
- Para o Estakalc isso sugere: abas na mesma ordem do fluxo, e resultados sempre com tabela + desenho + FS.

### 9.2 Coeficientes de Aoki-Velloso e Décourt (Velloso & Lopes, cap. 12, p. 264–266 — conferido nas páginas)
- **Conjuntos de coeficientes alternativos** (devem ser usados *completos*, nunca misturando k/α de um autor com F1/F2 de outro):
  - Aoki-Velloso (1975): Tab. 12.6/12.7 (k em kgf/cm²: areia 10 … argila 2; F1/F2 Franki 2,5/5,0; metálica 1,75/3,5; pré-moldada 1,75/3,5; escavada 3,0/6,0). Raiz, hélice, ômega: F1 = 2, F2 = 4 (p. 265). Limite N ≤ 50; Np = média de 3 valores (ponta, 1 m acima e 1 m abaixo).
  - Laprovitera (1988)/Benegas (1993): Tab. 12.8/12.9 (F1/F2 Franki 2,5/3,0; metálica 2,4/3,4; pré-moldada 2,0/3,5; escavada 4,5/4,5).
  - **Monteiro (1997)**: Tab. 12.10/12.11 — inclui **Strauss (F1 4,2; F2 3,9)**, escavada com lama bentonítica (3,5/4,5), raiz (2,2/2,4) e **hélice contínua (3,0/3,8, "requer reserva: poucas provas de carga")**; N limitado a 40; qp = média de valores nas espessuras 7B acima e 3,5B abaixo da base.
- **Décourt-Quaresma**: V&L admite, "em primeira aproximação", α = β = 1 também para Franki, **Strauss** (ponta em argila) e escavadas; Cintra & Aoki (2010) só mantêm α = β = 1 para pré-moldada, metálica e Franki e dão fatores menores para escavada/Strauss. **Há divergência entre as fontes** — o padrão do Estakalc (conservador) usa os fatores menores, com opção de trocar.
- **Antunes & Cabral (1996) para hélice**: Qult = (β2'·Nb)·Ab + U·Σ(β1'·N)·ΔL; β1' (%): areia 4–5, silte 2,5–3,5, argila 2–3,5; β2': areia 2–2,5, silte 1–2, argila 1–1,5; limites β1'N ≤ ... e β2'Nb ≤ 40 kgf/cm². **Falta a definição de Nb** (fonte original SEFE 1996 não obtida) → não implementado.
- Busca na web: encontrei apenas trabalhos secundários (TCCs/artigos) que repetem essas tabelas; usei as páginas dos livros da pasta como fonte primária.

### 9.3 Módulo de várias sondagens (feito)
Importação por CSV (`furo;profundidade;nspt;solo[;na]`), modelo para download, mensagens de erro por linha, seleção de quais furos representam a fundação (aplica ξ da NBR 6122 à média/mínimo). Ainda falta: ligar cada fundação (pilar) a seus furos.

## 10. Status (v0.5) — decisões e entregas
- **Decisões**: (1) conjuntos de coeficientes do Aoki-Velloso selecionáveis, padrão Cintra & Aoki (2010), Strauss → Monteiro (1997), tudo editável; (2) Décourt-Quaresma/Strauss: padrão conservador (fatores de escavada), editável; (3) hélice permanece em Aoki-Velloso (F1 = 2, F2 = 4); Antunes & Cabral fica fora até obtermos a definição de N_b.
- **Entregue**: seção "Parâmetros de cálculo" (K, α, F1, F2, C, α/β de Décourt, N_L máx., α/β de Teixeira), com destaque dos campos editados, aviso nos resultados e botão de restaurar. Conjuntos Laprovitera e Monteiro incluídos (Velloso & Lopes, Tabs. 12.8–12.11). 19 testes passando.
- **Limitações conhecidas**: conjunto Monteiro aplica apenas k, α, F1, F2 (não a regra 7B/3,5B nem N ≤ 40); a conversão kgf/cm² → kPa usa 100 kPa por kgf/cm² (convenção das tabelas de Cintra & Aoki); edições persistem só na sessão (salvar projeto virá com o arquivo de projeto).

## 11. Fase 2 — estaca isolada sob carga lateral (v0.6)
**Decisões do usuário**: condição de apoio do topo definida pelo usuário (livre / impedida / mola, em deslocamento e em rotação — preocupação com estacas "destravadas" em solo fraco e flambagem); curvas **p-y** desde já (não só Winkler linear).

**Modelo** (`app/src/core/lateral/`): viga-coluna de elementos finitos (Hermite) sobre molas p-y não lineares (iteração secante), com **P-Δ** (matriz de rigidez geométrica), trecho livre acima do terreno opcional, carga axial N, e cálculo da **carga crítica de flambagem** (bisecção na perda de positividade da rigidez; λ = Pcr/N). Roda em milissegundos no navegador.

**Curvas p-y e fontes** (todas de Velloso & Lopes, cap. 15, conferidas nas páginas):
- argila mole — Matlock (1970), Eqs. 15.11–15.13, Fig. 15.4 (estático e cíclico);
- argila rija — Reese, Cox & Koop (1975), Eqs. 15.14–15.23, Fig. 15.5, Tab. 15.3 (estático e cíclico);
- areia — API, Eqs. 15.24–15.26. C1, C2, C3 pelas expressões analíticas da API (coincidem com a Fig. 15.6b em φ = 30°); k(φ) pelos ajustes da API (publicados em documentação do openpile, conferidos com 10 lb/in³ a 28,8° e ≈ 275 lb/in³ a 40°).
- Observação: o eixo da Fig. 15.6c de V&L está rotulado "k×1000 (kN/m³)" mas os valores batem com **kgf/cm³** (7,7 kgf/cm³ ≈ 275 lb/in³); usei a API.
- A' e B' (Fig. 15.6a) foram **digitalizados** do gráfico (±0,02) — marcado no código.

**Parâmetros do solo a partir do SPT** (correlações de uso preliminar, editáveis por camada): Su = 10N kPa (Teixeira & Godoy); φ' = menor entre 28° + 0,4N (Godoy 1983) e √(20N) + 15° (Teixeira 1996), limitado a 20°–40°; γ por Godoy (1972), Tabs. 8 e 9 (Marangon, p. 69); γ' = γ − 10 abaixo do NA (NA ausente ⇒ superfície, conservador); argila com Su < 0,5 kgf/cm² ⇒ modelo de argila mole, senão argila rija. Silte tratado como argila (sinalizado).

**Validação**: modelo linear (nh·z) reproduz Matlock & Reese (V&L Tab. 15.4): y = 2,435·H·T³/EI, θ = 1,623·H·T²/EI, M → y = 1,623·M·T²/EI, topo com rotação impedida y ≈ 0,93·H·T³/EI (erro < 1–2 %); flambagem reproduz Euler (engastado-livre π²EI/4L² e engastado-engastado π²EI/L², erro < 2 %); equilíbrio ΣR = H; pontos notáveis das curvas p-y. **Não** comparei as curvas p-y com um programa independente (LPILE etc.) nem com prova de carga — validação restante.

**Pontos que o projetista deve decidir/ciente**: EI = 0,8·E_cs·I como padrão (analogia ao 15.7.3 da NBR 6118:2026, que é para pilares de edifícios — **não** é prescrição para estacas; editável); N constante ao longo da estaca; efeito de grupo ainda não considerado (Fase 3); armadura/fissuração não linear (M–κ) fica para a Fase 4/7.

## 12. Fase 3 — grupo de estacas, bloco rígido (v0.7)
**Decisões**: nível d'água é **obrigatório** (informado pelo usuário por furo, ou marcado "não encontrado"; sem NA a análise lateral não roda); bloco rígido; efeito de grupo lateral por Davisson (1970) como padrão (V&L §15.7: 25 % a 3B, 100 % a ≥ 8B), opcional; formato de cargas em CSV.
**CSV de cargas** (`core/loads.ts`): `pilar;combinacao;tipo;fx;fy;fz;mx;my[;mz]`, kN e kN·m; eixos X,Y em planta e Z para cima (mão direita); fz > 0 = compressão; mx > 0 aumenta a compressão nas estacas com y menor; my > 0, nas com x maior; origem = eixo do pilar. Modelo com comentários no próprio arquivo.
**Motor** (`core/group/`): bloco rígido com 6 gdl; por estaca, mola axial kv e rigidez lateral 2×2 (do modelo p-y) nos planos XZ e YZ; cabeça engastada ou articulada por estaca; solo com rigidez secante única por estaca, função do deslocamento resultante √(yx²+yy²); P-Δ com a carga axial de cada estaca; flambagem por estaca; coordenadas reais (x, y) e de projeto (x0, y0) com comparação `compareAsBuilt`.
**Verificado** (48 testes): carga vertical centrada = Fz/n; horizontal centrada = H/n; momento com cabeças articuladas = superposição Pi = N/n + My·xi/Σx² (a fórmula clássica citada em estudeengenharia.com); somatórios ΣP = Fz, ΣH = F; estaca única = análise isolada de topo livre; estaca deslocada altera as cargas no sentido esperado.
**Observações**: (i) um bloco sobre uma única estaca gira livremente (não há outra estaca para impedir a rotação) — o resultado é o de topo livre; (ii) com cabeças engastadas, o binário axial muda N entre as estacas e, por P-Δ, a rigidez lateral (diferença de ~0,1 % no exemplo); (iii) kv = E_cs·A/L é aproximação (ponta indeslocável) — melhorar na Fase 5 com a curva carga-recalque.
**Regra de Feld** (eficiência vertical do grupo, lida na página estudeengenharia.com por resumo automático — confirmar em livro antes de usar): −1/16 por estaca vizinha; ainda não implementada.
**Pendente**: interface do grupo (croqui das estacas arrastáveis, escolha do furo por pilar, importação do CSV de cargas, tabela por combinação); verificações da NBR 6122 8.5.6 (excentricidade > 10 % da menor dimensão; +10 % de carga axial em blocos de estacas não alinhadas; desaprumo > 1:100).

## 13. Fase 4 — dimensionamento estrutural real da estaca (v0.8)
**Decisões do usuário**: otimização econômica determinando o modelo (com diâmetro livre ou fixado pelo usuário); momento-curvatura **real**; armaduras longitudinal e transversal dimensionadas, com **estribos como padrão** e helicoidal como opção.

**Seção circular** (`core/structural/section.ts`): diagrama de interação N–M e momento-curvatura por integração de fibras, com os diagramas da NBR 6118:2026 (parábola-retângulo 0,85·ηc·fcd, εc2 = 2,0 ‰, εcu = 3,5 ‰, aço bilinear, domínios de deformação 1 a 5 da Fig. 17.1; fck ≤ 50 MPa), tração do concreto até fct na curva M–κ. Duas orientações da gaiola (barra no extremo / entre barras) e o menor MRd. **Validação**: capacidades axiais exatas (−As·fyd e 0,85·fcd·Ac + …) e MRd(N) conferido contra um cálculo independente em Python por integração polar (diferença < 1 % em N = 0, 500, 1500 e 2500 kN).
**Acoplamento com a análise lateral** (`EIfn`): EI(M) secante da curva M–κ atualizado por elemento a cada iteração, junto com as curvas p-y. Observação: usa os diagramas **de cálculo** (módulo inicial 2·0,85·fcd/εc2, menor que Ecs) — adequado ao ELU/2ª ordem; para deslocamentos de serviço usar EI = fator·Ecs·I (ou, futuramente, curva com valores característicos). Se o momento passa de MRd a análise não converge — sinal de seção insuficiente.

**Dimensionamento** (`core/structural/design.ts`), por tipo (Tab. 4 da NBR 6122 e Tab. 7.2/18.4 da NBR 6118:2026):
- cobrimento por CAA (contato com solo: 30/30/40/50 mm); γc e fck mínimos por tipo/CAA; As,mín = máx[0,15·Nd/fyd; 0,4 %·Ac]; As,máx = 6 % (D ≥ 400 mm) ou 8 %; ≥ 6 barras; φ entre 10 mm e D/8; espaçamento livre ≥ máx[20 mm; φ; 1,2·dmáx] e entre eixos ≤ mín[2D; 400 mm]; redução de 2 mm no diâmetro (NBR 6122 8.6.2, ligada por padrão);
- cortante (modelo I, 17.4.2.2) com Vc em flexo-compressão (M0 = N·D/8 em seção circular), VRd2, ρsw,mín, espaçamentos (18.3.3.2 e 18.4.3: ≤ mín[200 mm; D; 12φ]) e a dispensa do 17.4.1.1.2-c; passo variável por trechos, arredondado a 2,5 cm;
- comprimento da gaiola: até onde Md excede a capacidade com a armação mínima + ancoragem lb,nec (9.4.2), mas não menos que o comprimento útil mínimo da Tab. 4 (integral em Franki e raiz);
- escolhe, entre as combinações viáveis (nº de barras × bitola × bitola do estribo), a de **menor massa de aço**; estribo fechado ou helicoidal na mesma rotina; devolve quantitativos (kg longitudinal, transversal, kg/m³).
**Interpretações assumidas e sinalizadas na saída (revisar):** γc da Tab. 4 usado em toda resistência do concreto (inclusive fctd e ancoragem) — conservador; cortante em seção circular com bw = D e d = D/2 + 2·Rs/π (a NBR 6118 não trata seção circular); helicoidal com os mesmos limites de passo dos estribos (a NBR não detalha); ganchos/traspasse e voltas de fechamento dos helicoidais; η2 = 1,0 (boa aderência, barras verticais); As,calc/As,ef ≈ taxa de utilização na ancoragem. Pré-moldada **fora** (NBR 16258/fabricante). 66 testes passando.

## 14. Próximo — otimização econômica e interface (proposta)
Fluxo por pilar: (1) para cada diâmetro candidato (lista do usuário ou automática) e cada arranjo de estacas, procurar o **menor comprimento** que atende à capacidade geotécnica (Fase 1, com a segurança escolhida) e aos deslocamentos limites; (2) rodar o grupo (Fase 3) com as combinações ELU → esforços ao longo de cada estaca; (3) dimensionar a estaca (Fase 4); (4) custo = concreto + aço + execução por metro (por diâmetro) + itens adicionais (mobilização, arrasamento, bloco…); (5) apresentar o ranking e a fronteira de Pareto; o usuário pode fixar diâmetro/comprimento/arranjo e editar tudo. Interface com abas na ordem do fluxo (dados, lançamento, solo, parâmetros, resultados geotécnicos, análise estrutural, dimensionamento, custos), como no software de referência.

## 15. Otimização econômica (v0.9)
**Decisões**: custos deixados em aberto com valor inicial 0 (sem custos a classificação é por volume de concreto e massa de aço, com aviso); arranjo **automático** conforme a literatura; deslocamento limite no topo padrão 25 mm, editável.
**Fontes dos arranjos** (Campos, *Elementos de Fundações em Concreto*, §11.1.1 e Tab. 10.21; NBR 6118:2026, 22.7): n inicial = (N + 5–10 % de peso do bloco)/capacidade, +30 % se houver momento; espaçamento inicial 3·dE e mínimos por tipo/solo (escavadas 3dE; moldadas rugosas 2,5dE em argila/2dE em areia; pré-moldadas 3dE em areia; piso 60 cm); arranjos usuais de 1 a 6 estacas (linha, triângulo, quadrado, quadrado com central/pentagonal, hexagonal/retangular) e malhas até 12. Altura estimada do bloco pelo critério de bloco rígido análogo ao da sapata (h ≥ (a − ap)/3, NBR 6118:2026, 22.5/22.7.1) — o bloco será dimensionado na Fase 6.
**Deslocamento limite — o que a pesquisa mostrou:** os 25 mm aparecem na literatura como **critério convencional de ruptura em prova de carga horizontal** (e como recalque de referência em provas verticais, p.ex. Marangon e NBR 12131), **não** como limite de serviço. Velloso & Lopes (§15.4.2, Broms) dizem que o limite depende da estrutura: onde só pequenos deslocamentos são toleráveis, o projeto é governado pelo deslocamento sob a carga de trabalho. Não encontrei nas fontes um valor numérico normativo de serviço. Por isso 25 mm fica como valor informado pelo usuário (padrão do Estakalc a pedido), exibido como "limite do usuário", e a tela deve lembrar que depende da estrutura suportada.
**Algoritmo** (`core/optimize/`): por tipo × diâmetro × arranjo; comprimento mínimo pela verificação vertical clássica (superposição, estacas articuladas, conservador); análise do grupo em ELS (deslocamento, Padm, tração) e ELU (esforços → dimensionamento; 2ª passada com EI(M) do momento-curvatura); custo (concreto com sobreconsumo, aço, execução por m e diâmetro, mobilização, arrasamento, bloco, extras livres); ramificação e poda por limite inferior de custo. Tração só se o usuário permitir (capacidade = atrito admissível — **interpretação**, NBR 6122 8.4.1 pede tratar o atrito à tração separadamente). 88 testes.
**Premissas a rever**: peso do bloco somado às cargas (γ = 25 kN/m³; ELU ×1,4); lateral calculada com o primeiro furo selecionado; atrito acima da base do bloco desprezado; bloco sobre 2 estacas recebe aviso para o momento transversal (viga de travamento).

## 16. Interface (v1.0 do protótipo)
Abas: **Capacidade de carga (SPT)** (sondagens CSV com NA, 3 métodos, coeficientes editáveis), **Carga lateral (p-y)** (estaca isolada), **Otimização econômica** (CSV de cargas, pilar, ranking, croqui, armadura, custos, travar tipo/diâmetro/arranjo/comprimento, descartados) e **Parâmetros** (tela única com todos os critérios editáveis: deslocamento máximo 25 mm, EI, EI não linear, p-y estático/cíclico, efeito de grupo, cabeça engastada/articulada, tração, excentricidade executiva, CAA, fck, estribo/helicoidal, comprimentos, peso do bloco, tipos e diâmetros candidatos, custos e itens extras). Parâmetros persistem no navegador (localStorage). Exemplos em `samples/`.

## 17. Bloco, exportação e revisão geral (v1.1)
**Bloco de coroamento** (`core/block/`): método das bielas e tirantes generalizado (Campos §12.2 e Quadro 12.2; Eqs. 12.4–12.12): por estaca, tg θ = d/(r − a), Rs = P·(r − a)/d, Rc = P/sen θ, com a = b/4, 0,3b e b√2/4 para 2, 3 e 4 estacas (0,3b para ≥ 5 — interpretação). Altura d pelo ângulo das bielas (45°–55°, Campos §12.4) e critério de bloco rígido (NBR 6118:2026, 22.7; h ≥ (a − ap)/3); verificação de tensão nas bielas (Quadro 12.5: κ = 1,4/1,75/2,11; junto à estaca 0,85·fcd; serviço 0,43·fck); fck do bloco sobe de 30 para 35 e 40 MPa se necessário; tirantes por faixas de 1,2·dE, malha (Eqs. 12.23 e 12.24, α = 0,8), cintas em 3 estacas (Rs(lados) = Rs(diag)/√3), armadura de pele/superior/estribos (Campos §12.4.2), ancoragem (Eqs. 12.26–12.28, −20 % pela biela). Reações de cálculo vêm da análise do grupo (cargas excêntricas incluídas). **Validado** contra o exemplo resolvido de Campos (4 estacas, P = 1650 kN): As(lados) = 3,98 cm² (α = 0,6) e a reprovação da biela com fck 20 MPa e d = 55 cm, como no livro.
**Exportação**: DXF (R12/AC1009; planta do bloco, corte, detalhe da estaca com gaiola, estribos por trecho e seção, quadro de quantitativos; layers por tipo de elemento) e memorial HTML imprimível (→ PDF). **DWG não é gerado** (formato proprietário): abrir o DXF no CAD e salvar como DWG.
**Revisão geral**: bug corrigido — o cache de EI(M) era compartilhado entre armaduras diferentes na 2ª passada do ELU (curvas desatualizadas); cálculo agora assíncrono com barra de progresso e cancelamento; limite padrão de 40 candidatos; teste de robustez com 40 cenários aleatórios (sem exceções, sem NaN/∞ e com as verificações respeitadas nas soluções aceitas); lint limpo. 100 testes.
**Limitações conhecidas** (revisar antes de uso em projeto): curvas p-y sem comparação com programa independente/prova de carga; correlações SPT → φ', Su, γ preliminares; kv axial = E·A/L; N constante na estaca; cortante em seção circular e helicoidal por interpretação; fórmulas de bloco para ≥ 5 estacas generalizadas; planta do bloco retangular (contorno triangular/hexagonal de Campos não desenhado); peso do bloco usa a altura estimada; pré-moldada sem dimensionamento estrutural; um furo para a análise lateral; não há ligação pilar↔sondagem nem lote de pilares; DXF esquemático (sem cotas completas nem tabela de ferros).

## 18. Nova interface (v1.2)
Fluxo guiado em 4 passos com barra lateral de progresso (✓ quando completo): **1 Sondagens** (importar CSV, NA por furo, perfil gráfico do solo com NSPT e NA), **2 Cargas** (CSV, pilar, seção do pilar, esquema das forças), **3 Critérios** (visão "Essenciais": tipos de estaca e diâmetros, limite de deslocamento, CAA, estribo/helicoidal, custos; visão "Avançados": critério geotécnico, p-y, grupo, EI, bloco), **4 Resultados** (botão único de cálculo com progresso/cancelar; ranking em cartões com miniatura do arranjo; detalhe em abas Resumo/Bloco/Estaca/Custos/Avisos com planta dimensionada e colorida pela carga em serviço, corte do bloco com armadura, estaca armada com estribos por trecho e seção, diagramas de momento, cortante e deslocamento, barras de utilização verde/amarelo/vermelho, custo empilhado e quantitativos). **Análises avançadas** reúne capacidade de carga (com gráfico) e carga lateral da estaca isolada. Botão "Carregar exemplo" preenche tudo em um clique; dados e parâmetros persistem no navegador; temas claro/escuro automáticos; responsivo.

## 19. Lançamento manual e custos SINAPI (v1.3)
**Lançamento manual**: sondagem (editor por metro com N_SPT, tipo de solo, NA, duplicar solo para baixo, adicionar metros; renomear furo) e cargas (pilares com nome/seção, combinações ELS/ELU editáveis em tabela, adicionar/remover pilar e combinação); importação por CSV continua. Validações: nome de furo único, NA obrigatório, combinações repetidas, Fz > 0.
**Custos padrão (SINAPI)**: a pedido, baixei do site da CAIXA o relatório de **agosto/2026** (`SINAPI-2026-08-formato-xlsx.zip`, 15,8 MB, emitido em 11/09/2026) e extraí por UF e regime (sem/com desoneração) os custos usados pelo Estakalc (`app/src/data/sinapi.ts`, gerado por script a partir das abas de composições e insumos). **Mapeamento**: concreto = insumo 1525 (C30 bombeável); execução por metro = composição da estaca (hélice contínua fck 30 sem armadura; escavada sem fluido fck 25 sem armadura; raiz sem rocha) − volume teórico × concreto; aço = composição de montagem de armadura (estaca Ø16; bloco Ø12,5; já inclui o aço); arrasamento por faixa de diâmetro; bloco: concretagem fck 30 com bomba, fôrma de compensado (4 usos) e lastro 5 cm. Diâmetros sem composição são interpolados/escalados pela área e marcados com *. **O SINAPI não publica custo de estaca Strauss, estacão (escavada com fluido) nem Franki, e não tem mobilização**: ficam em zero para o usuário informar (a tela avisa). Padrão inicial: SP, sem desoneração; o usuário escolhe UF e regime, edita qualquer valor (campos destacados) e restaura o SINAPI. Os custos continuam editáveis e o modo manual parte de zero.
**Limites**: preços SINAPI são referenciais de obras públicas por capital/UF (agosto/2026) e não substituem cotação de fornecedores; as composições incluem BDI? Não: SINAPI publica custo sem BDI.

## 20. Resultados em seções amplas, armadura editável e resultado persistente (v1.4)
**Pedidos**: desenhos pequenos → seções próprias em largura total; editar a armadura da estaca dinamicamente com verificação ao vivo; não perder o cálculo ao sair da etapa 4. Referências: telas do software de referência (dimensionamento estrutural, análise estrutural, lançamento) e do software de referência (bielas, detalhamento do bloco).
**Persistência**: a página de resultados fica montada depois da 1ª visita (ranking, solução escolhida, armaduras e blocos editados sobrevivem à troca de etapa). Se sondagens, cargas ou critérios mudarem depois do cálculo, aparece aviso e o botão passa a "Recalcular (dados alterados)". Não persiste após fechar/recarregar a página (os resultados não são gravados no navegador).
**Seções** (abas largas sob o ranking): Resumo · Bloco · Estaca e armadura · Esforços na estaca · Custos · Avisos; seletor da solução e botões DXF/memorial sempre visíveis; largura útil ampliada (1760 px).
**Estaca e armadura** (`core/structural/verify.ts`, `pages/PileDesigner.tsx`): o usuário edita nº de barras, bitola, estribo/helicoidal, bitola e passo da transversal e comprimento da gaiola; a verificação é refeita na hora contra os esforços de cálculo (ELU) de **todas** as combinações × estacas: Nd ≤ NRd, Md ≤ MRd(N) em cada profundidade (FS), VRd2, Asw efetivo ≥ necessário, passo ≤ exigido (18.4.3 e 17.4), comprimento da gaiola (momento + ancoragem + mínimo da Tab. 4 da NBR 6122), n ≥ 6, φ mín./máx., As mín./máx., espaçamentos, φt, cobrimento; ✔/✖ por item com a referência normativa. Gráficos: diagrama de interação N–M com os pontos solicitantes, momento solicitante × resistente em profundidade, desenho ampliado (elevação e seção), tabela por profundidade (FS, Vd, passo exigido) por estaca/combinação ou envoltória; variação de massa e custo de aço frente à armadura sugerida; botão "voltar à sugerida". A verificação é a mesma fórmula do dimensionamento automático (teste garante: armadura automática ⇒ aprovada, com a mesma massa de aço). A armadura editada alimenta KPIs, DXF e memorial (com aviso se NÃO atende). **Limitação**: os esforços não são reanalisados com a rigidez EI(M) da armadura editada; o custo do ranking permanece o da armadura automática.
**Bloco** (`pages/BlockView.tsx`): altura hb e fck editáveis (faixa de 45°–55° informada), redimensionamento ao vivo pelo mesmo método; planta e corte ampliados; bielas em planta com reações; modelo de biela e tirante (Blévot–Frémy) por estaca com θ, Rs, d, r−a; armaduras, tensões nas bielas. Alturas que não atendem mantêm o último bloco válido nos desenhos e mostram o motivo.
**Esforços na estaca**: quatro colunas em profundidade (Nd, Vd, Md, deslocamento) com valores por metro e marca do fim da gaiola (N tomado constante: simplificação documentada).
**Testes**: `verify.test.ts`; limite de tempo dos testes elevado (otimização e cenários aleatórios são pesados). Não implementado: não-linearidade com a armadura editada (reanálise), detalhamento gráfico das barras do bloco (software de referência) e tabela de ferros no DXF.

## 21. Parâmetros dos métodos, reanálise e tabela de ferros (v1.5)
**Nova etapa "Parâmetros dos métodos"** (barra lateral), como no software de referência, com 4 seções; tudo que é editado vale para a otimização, as análises e o memorial, aparece destacado e tem "restaurar padrões":
- **Capacidade de carga**: conjunto e coeficientes de Aoki-Velloso (F1/F2, K, α), Décourt-Quaresma (C, α, β, N_L máx.), Teixeira (α, β) por tipo de estaca e de solo; novos critérios *ligados ao cálculo*: limitar a ponta a X % da lateral, desprezar o atrito do último metro, limites de N_SPT no atrito (Aoki-Velloso e Teixeira); critério de carga admissível e FS global. Não implementados (não existem no motor): desprezar o 1º metro e o N_SPT 1 m acima da ponta; recalque (Es, ν) e Kh por tabela m do software de referência — o Estakalc usa p-y.
- **Solo e carga lateral (p-y)**: regra de φ' (conservador/Godoy/Teixeira), Su = fator·N, tabela por camada de cada furo (modelo p-y, γ', φ', Su, n_h e, em "detalhados", k, ε50, J, ks, kc). Antes só existia nas Análises avançadas e *não chegava à otimização*; agora chega (primeiro furo selecionado).
- **Estrutural da estaca**: Tab. 4 da NBR 6122 por tipo (fck, γc, comprimento mínimo armado), fck global, taxa mínima de armadura, cobrimento, fyk, γs, dmáx, redução de 2 mm. Valem no dimensionamento automático e na verificação da armadura editada.
- **Grupo, rigidez e bloco**: limite de deslocamento, efeito de grupo, cabeça, tração, excentricidade, EI, EI não linear, fck/α/margem/peso do bloco e **ângulos mínimo e máximo das bielas**.
**Reanálise** (`reanalyzeELU`): botão "Reanalisar com esta armadura" na aba da estaca: recalcula os esforços ELU de todas as estacas/combinações com o EI(M) do momento-curvatura da armadura do usuário e reverifica; mostra aviso se ficar desatualizada após nova edição; "voltar aos esforços originais". Exige EI não linear ativo. Uma passada (a armadura é fixa). O custo do ranking e o bloco (reações axiais) não são recalculados.
**Tabela de ferros** (`export/schedule.ts`): posições N1/N2 (estaca) e N3… (bloco), bitola, quantidade total, comprimento unitário e total, massa, resumo por bitola (aço de 5 mm = CA-60); soma confere com os quantitativos (teste). No **DXF**: cotas encadeadas na planta (eixos das estacas, total, pilar), cotas do corte (h, d, largura) e da estaca (L, gaiola, trechos de estribo, diâmetro), chamadas de posição e a tabela desenhada com layer próprio; no **memorial**, seção 7. Limitações: comprimento da barra longitudinal = gaiola (sem espera de ancoragem no bloco; o l_b,nec é informado); armadura de pele/superior/estribos do bloco entram só com a massa (o motor não tabela quantidade e comprimento); DXF continua esquemático (sem dobramento/forma das barras).
**Testes**: 118 (novos: ligação dos parâmetros, reanálise, tabela de ferros/DXF/memorial).

## 22. Lote de pilares, Eberick, blocos e locação (v1.6)
**Eberick** (`core/xlsx.ts`, `core/eberick.ts`, `pages/EberickImport.tsx`; arquivo de exemplo em `samples/Fundacao_Combinacoes.xlsx`): relatório "Esforços nas Fundações por Elementos" da AltoQi — 20 elementos (B1…B20), cada um com 13 casos simples (G1, G2, S, Q, V1–V4, D1–D4, R) e 28 combinações, em tf e kgf·m (N, Mx, My, Vx, Vy, Mt). O arquivo traz **esforços característicos** (combinações só com ψ, sem γf) e **não traz ELU, seção do pilar nem sondagem**. Importação: converte unidades (tf→kN, kgf·m→kN·m; Mt→Mz), entra como **ELS**; o **ELU = γf × ELS** (γf padrão 1,4, editável; 0 = não gera); opção de **combinações críticas** (N máx./mín., Mx, My, Vx, Vy, momento e cortante resultantes, maior M/N — cobre extremos, sem garantia de conter a governante) ou todas; inversão dos sinais de Mx/My (o relatório não informa os eixos). Seção do pilar e sondagem passam a ser **por pilar** (Cargas).
**Todos os pilares** (`pages/BatchPage.tsx`, `ui/buildInput.ts`): calcula a solução mais econômica de cada pilar em sequência (≈ 6 s por pilar no exemplo), com progresso/cancelar, tabela-resumo, totais e CSV. Resultados ficam em cache por pilar e abrem na tela de Resultados (que ganhou seletor de pilares); aviso discreto "dados alterados" quando algo mudou. Teste no Eberick de exemplo: 20 elementos + 2 do exemplo em ~2 min.
**Projeto em arquivo**: "Salvar/Abrir projeto" (.json: sondagens, cargas, seções e parâmetros). **Sondagens**: "Exportar sondagens (CSV)" no mesmo formato da importação (teste de ida e volta).
**Bloco**: (1) dimensões em planta editáveis (centrado nas estacas; mínimo dE/2 + 5 cm; aviso abaixo de dE + 15 cm), além de h e fck; (2) **métodos**: Blévot e Frémy (Campos cap. 12), **método da flexão** (Campos §13.4: seção S_II a 0,15·b_p da face do pilar, As por flexão retangular com ρmín 0,15 %, armadura repartida nas faixas sobre as estacas, cortante a d/2 com contribuição proporcional das estacas que cruzam a seção, τRd = 0,25·fctd, ρ1 = 0) e **conservador** (padrão: calcula os dois e adota o de maior massa de tirantes). Outros métodos da literatura (Fusco 1994/1995, Santos et al. 2013/2015/2023 [MBT], Adebar & Zhou 1996, modelos 3D da NBR 6118:2026 22.7.3) **não foram implementados**: não há formulação nas fontes do projeto. (3) altura mínima do bloco (padrão do software de referência: 50 cm) e d ≥ 1,2·dE para 1 estaca — **eram ignorados**: blocos de 1 estaca saíam com h = 20 cm; a altura também deve permitir ancorar a armadura de arranque do pilar (22.7.4.1.4), não verificada (não se conhece a armadura do pilar).
**Locação das estacas** (`reevaluateWithLayout`): na aba Bloco, informe as coordenadas executadas; o programa refaz o grupo (ELS e ELU), o bloco e a flexão das estacas (mesma armadura/comprimento) e compara projeto × executado (deslocamento, compressão, tração, FS à flexão, bielas); desenhos e memorial passam a usar a locação executada. O bloco acompanha o centro das estacas.
**Armadura**: ancoragem no bloco (barras prolongadas por l_b,nec, arredondado a 5 cm; padrão ligado; entra em massa, tabela de ferros e DXF); múltiplo de arredondamento do comprimento da gaiola. **Diagrama de interação**: o cálculo já respondia às barras (teste: MRd cresce com n e φ); o que escondia a mudança era o eixo reescalado automaticamente — agora há a envoltória da armadura sugerida tracejada como referência.
**Parâmetros**: método do bloco, altura mínima e d de 1 estaca. **UI**: gráficos sem altura máxima, perfil do solo e croqui de cargas maiores, áreas rolantes mais altas, fontes dos desenhos maiores.
**Testes**: 129.

## 23. Dois relatórios do Eberick, unidades e progresso global (v1.7)
**Segundo arquivo** ("Relatório de Cargas nas Fundações", `samples/Projeto_CargasFundacao.xlsx`): uma linha por pilar (P1…P20) com Nome, Seção (cm, ex.: "14x30"), cargas por caso (tf) e carga máxima positiva/negativa — só máximos. A importação aceita **os dois arquivos**: combinações do primeiro, seção do segundo. Associação B1…B20 ↔ P1…P20 pelo número e conferida pela carga máxima (coincidem em todos os 20 do exemplo; editável por linha). A ordem "AxB" é tomada como X × Y (opção "trocar"; o relatório não diz — confira no Eberick). P19 e P20 vêm sem seção (usam o padrão 40×40); P18 = 150×60.
**Unidades**: o arquivo está em tf e kgf·m e a conversão **já era feita** (1 tf = 9,80665 kN; 1 kgf·m = 0,00980665 kN·m; Mt → Mz): o programa calcula sempre em kN e kN·m. Para evitar a dúvida, a importação mostra a conferência (ex.: N = 3,93 tf → 38,5 kN; Mx = 249,3 kgf·m → 2,45 kN·m) e a tela Cargas ganhou "Unidade na tela: kN/kN·m ou tf/tf·m" (exibe e edita em tf; croqui e coluna N do lote seguem a escolha). Resultados e memorial continuam em kN. γf = 1,4 confirmado pelo usuário.
**Progresso global**: o cálculo (um pilar ou o lote) vive no App, continua ao trocar de tela e mostra uma barra flutuante (pilar atual, n/total, candidatos, Ver, Cancelar) em qualquer página; a tela do lote reflete o andamento ao voltar.

## 24. Unidades definidas pelo usuário e métodos de capacidade de carga (v1.8)
**Unidades**: seletor global "Unidades: kN·kN·m | tf·tf·m" na barra superior (salvo no projeto). Vale para Cargas, resultados (verificações, esforços, reações, diagramas de interação, capacidade em profundidade, bielas), tabelas por profundidade, comparação da locação, lote e **memorial** (cabeçalhos e valores; nota "1 tf = 9,80665 kN"). O cálculo é sempre em kN e kN·m. Não convertidos (ficam em kN): Análises avançadas (capacidade e carga lateral) e textos de avisos. O DXF não tem textos de força.
**Capacidade de carga** (Parâmetros dos métodos → Capacidade de carga): escolha dos métodos (Aoki-Velloso, Décourt-Quaresma, Teixeira; ao menos um), **combinação**: o menor (padrão, conservador) ou a **média** das cargas admissíveis dos métodos selecionados; **utilização da resistência de ponta (%) e lateral (%)** (padrão 100; multiplicam Rp e Rl de todos os métodos antes do limite da ponta em % da lateral e dos coeficientes de segurança; aviso acima de 100 %). Vale na otimização, nas análises avançadas e é citado no memorial. Teste: média ≥ menor; lateral a 50 % reduz Padm.
**Pendente**: seção/orientação do pilar e relatórios do Eberick com as seções por elemento (usuário procura a exportação); convenção "AxB" do relatório de cargas (X×Y assumido, com opção de trocar).



## 25. Profundidade da estaca, desenhos e DXF de detalhamento (v1.9)
**Por que a estaca não chegava a 9 m**: o otimizador procura a **menor profundidade que atende** capacidade e deslocamento (mais fundo só encarece) e o comprimento máximo é limitado pela sondagem menos a base do bloco (9 m − 1 m = 8 m). Não era defeito. Agora: (1) Critérios → "Comprimento da estaca": **automático** (padrão) ou **fixo** (definido pelo usuário; erro claro se exceder a sondagem); (2) ao lançar sondagem manualmente, a **profundidade final é obrigatória** (e editável no editor do furo); (3) aviso quando a estaca chega ao fim da sondagem.
**Desenhos nos resultados**: elevação da estaca ampliada, com ancoragem no bloco, quebra do fuste, cotas e chamadas legíveis; esforços ao longo da estaca com colunas largas, rótulos sem sobreposição (halo, espaçamento mínimo, recorte), título e valor máximo acima de cada painel; a aba de armadura passa a coluna única abaixo de 1500 px para dar largura ao desenho.
**DXF** reescrito (unidade cm, tipos de linha tracejado/eixo, Ø/° em códigos %%c/%%d): ficha da estaca (tipo, quantidade, fck, diâmetro, cobrimento, comprimento), seção e estribo em escala ampliada, elevação (esc. 1:25) com trechos de estribo cotados, gaiola, ancoragem e comprimento total, planta do bloco com estacas, cotas encadeadas, armaduras e etiquetas de posição, corte A-A, detalhe das barras do bloco (forma com ganchos e cotas), **tabela de aço**, **resumo de aço** (inclui nº de barras de 12 m), peso +10 %, volumes, notas, carimbo e moldura. Esquemático: conferir antes de emitir.
**Textos**: removidas menções a outros programas; avisos citam só autores (Campos, Cintra & Aoki, Décourt & Quaresma, Teixeira, Monteiro) e normas. **Unidades**: Análises avançadas seguem o seletor kN/tf.

## 26. Revisão do DXF (v1.10)
Cotas verticais deixaram de ficar sobre as linhas (erro de deslocamento do texto girado); símbolos fora do ASCII (≥, ≤, ≈, ×, ·, ², ³, letras gregas) são convertidos (>=, <=, ~, x, ., 2, 3, gama…) em vez de virar "?"; Ø e ° usam %%c e %%d; textos da tabela são cortados pela largura da célula e colunas alargadas; o nome do programa não aparece mais nos desenhos. **Armaduras complementares do bloco** (pele, superior, estribos) agora têm quantidade, bitola e comprimento estruturados (`BlockResult.secondary`), entram na tabela de aço com posição própria (N7…), aparecem no corte A-A (barras de pele nas duas faces, barras superiores, estribo com gancho e etiquetas), na planta (barras superiores tracejadas) e em detalhes (forma, cotas e comprimento). **Correção**: o comprimento do estribo do bloco usava o perímetro em planta; passou a ser o estribo vertical fechado 2·[(menor lado − 2c) + (h − 2c)] + ganchos, com contagem ao longo do maior lado.
Acesso pelo celular: `Iniciar-Estakalc-rede.bat` (servidor com --host) ou copiar o `Estakalc.html` para o aparelho.

## 27. Formato otimizado do bloco, análise lateral e revisão de UI (v1.11)
**Formato do bloco** (`core/block`): o contorno deixou de ser a caixa envolvente. Pesquisa: Campos (2015, §12.4.1 e Fig. 12.21) manda dispor as estacas "de modo a conduzir menor dimensão de bloco possível", com distância do eixo da estaca à borda a = máx[(1,0 a 1,5)·dE; dE + 15 cm] e largura ≥ 2a para estacas alinhadas, com contornos próprios para 2, 3, 4 estacas e alinhadas; NBR 6118:2026 22.7 não prescreve formato. Busca na internet não trouxe fórmula adicional. **Implementação** (interpretação da regra): contorno = casco convexo das estacas afastado de a (soma de Minkowski com octógono de apótema a, cantos chanfrados), sempre cobrindo o pilar (+15 cm): triângulo para 3 estacas, "pista" para alinhadas, etc. Volume, forma e lastro usam a área/perímetro reais; o comprimento das barras é o da corda do contorno na posição de cada faixa. Padrão **otimizado**; "retangular" e dimensões digitadas pelo usuário continuam disponíveis (Parâmetros → Grupo e bloco, e aba Bloco). Planta, miniaturas, bielas e DXF desenham o contorno. O ranking passa a refletir a economia (ex.: 3 estacas em vez de caixa).
**Estaca isolada sob carga lateral**: o cálculo já respondia às cargas (teste: H de 20 a 300 kN muda o deslocamento de 0,5 a 81 mm); o que escondia a mudança eram gráficos auto-escalados (mesma forma, escala diferente) e o fato de que, com rotação do topo **impedida**, o momento M aplicado vai para o engaste e não altera a estaca. Agora: gráficos maiores com valor máximo e eixos, botão "Fixar este resultado como referência" (curva tracejada, escalas comuns) e aviso sobre M com rotação impedida.
**UI**: alinhamento de campos por rótulo de altura fixa (inputs alinhados mesmo com rótulos de 1 ou 2 linhas), botões com altura única, linhas com campos e botões alinhados, caixas de seleção dos métodos (um CSS duplicado quebrava o grid), tabela de combinações em largura total com o croqui abaixo, desenhos de planta/corte com mais resolução (texto proporcional), tabelas de entrada compactas.

## 28. Roteiro de blocos (Bastos/Machado), consistência e flambagem em solos moles (v1.12)
**Blocos.pdf** (Bastos, UNESP, 2023, baseado em Machado 1985 e Campos 2015): novo método de bielas `machado` (`core/block/machado.ts`) com K_R, tensões-limite de Blévot por arranjo (2 a 7 estacas), pilar equivalente √(ap·bp), deslocamento a do nó da biela por arranjo, armadura de tirantes por lado, malha, suspensão, pele e estribos, bloco de 1 estaca (T = 0,25P). O CEB-70 (flexão) foi reescrito (seção S1 a 0,15·ap, As = M/(0,85·d·fyd), 3 estacas, faixa 2c/3 ≤ h ≤ 2c, cortante S2 e resistência local). Os 3 exemplos numéricos do documento viram testes (`bastos.test.ts`). Modo conservador = maior armadura entre os métodos válidos. Parâmetro novo: K_R (padrão 0,90).
**Contornos típicos** (padrão, `typicalOutline`): 3 estacas = triângulo truncado; 5 (pentágono), 6 e 7 (hexágono) = polígono das estacas afastado de a; 1, 2, 4 e 5 com pilar central = retângulo; o contorno otimizado continua como opção. **Pendente**: folga mínima 15 cm/5 cm por porte.
**Flambagem em solos moles**: o modelo p-y já inclui o solo (rigidez secante Es(z)) e P-Δ; Pcr vem da perda de positividade da rigidez. Acrescentado o comprimento equivalente Le = π√(EI/Pcr) (solver, grupo e painel lateral). Base: NBR 6122:2022 8.6.1 (estacas em solos muito moles exigem 2ª ordem) e 8.6.5.1; Velloso & Lopes cap. 18.3 (Timoshenko, Bergfelt, van Langendonck, Davisson & Robinson, desvios construtivos).

## 29. Verificações especiais, comparativo e memorial em Word (v1.13)
**Folga do bloco**: opção Campos (a = dE + margem), Bastos grande porte (15 cm da face) ou pequeno porte (5 cm), em Parâmetros → bloco.
**Pilar e momento**: avisos de pilar alongado (efeito de usar o menor lado sobre os tirantes), de momento (n·P_máx supera a carga média) e de estaca tracionada. **Fissuração** dos tirantes no ELS (`core/block/crack.ts`, NBR 6118:2026 17.3.3.2; limites da Tab. 13.4 por CAA), mostrada na tela do bloco e no memorial.
**Aba "Solo mole, atrito negativo e recalque"** (`core/special/`): argila mole (W ≥ 930 cm³, i ≥ 5,4/6,4 cm; limite de N_SPT editável, padrão 5); atrito negativo (β de Long e Healy: argila 0,20–0,25, silte 0,25–0,35, areia 0,35–0,50; ponto neutro na base da camada; ELS desconta o atrito positivo até o ponto neutro e soma Qn; ELU soma γf·Qn ao axial, γf padrão 1,4 por falta de valor na norma); recalque do grupo pelo radier fictício (2/3 L por padrão, espraiamento 2:1 editável, E = α·K·N de Teixeira e Godoy; limite opcional).
**Comparativo** lado a lado (aba Resumo) com CSV; **memorial** reorganizado em modelo único (`export/doc.ts`) com saídas HTML/PDF e DOCX (ZIP sem dependências).
**Validação**: Campos cap. 11 Ex. 2 (reações), V&L Davisson–Robinson (S_T ≈ 1,8; o modelo dá 1,84). **Observação**: Pcr do modelo usa N constante e ponta livre (conservador; ≈ metade de 2√(k·EI) de Hetényi para solo de k constante). **Testes**: 171.

## 30. Esforço normal variável ao longo da estaca e tensão da Tab. 4 (v1.14)
O normal deixou de ser constante no dimensionamento estrutural: N(z) = N·(1 − Rl(z)/R_total) (atrito e ponta mobilizados na mesma proporção; vale o maior N entre métodos e furos). Opção "constante" mantém o comportamento anterior. A análise lateral (P-Δ) segue com N do topo (conservador). Com atrito negativo ligado, N é constante (P + γf·Qn).
**Tab. 4 da NBR 6122:2022 (8.6.3)**: "tensão de compressão simples abaixo da qual não é necessário armar" (5 MPa escavada, 6 MPa hélice e escavada com fluido) **não era usada**; agora a gaiola vai até a profundidade em que N/A supera o limite (base: Nd, com coeficiente editável; 1,4 = serviço). Limite editável por tipo. Gráficos: N(z), tensão N/A com o limite e tensão máxima na fibra. Testes: 175.

## 31. Normal N(z) no P-Δ e no atrito negativo, tração, conformidade e manuseio (v1.15)
**P-Δ com N(z)** (`axialShape` no solver; `axialProfile` por estaca): a rigidez geométrica e a carga crítica usam o perfil do normal. **Atrito negativo**: N cresce até P + γf·Qn no ponto neutro e depois diminui pelo atrito positivo (gráficos e dimensionamento). **Textos**: `fx()` (vírgula decimal) nas mensagens do cálculo; `unitText()` converte kN/kN·m em tf nos avisos, descartados e memorial. **Ranking** sem soluções espelhadas (base em X/Y) de mesmo custo (≤ 1 %).
**Conformidade** (testes): malha de 110 casos de estaca (NBR 6118:2026 17.3.5.3, 18.4.2, 18.4.3, Tab. 7.2; NBR 6122:2022 Tab. 4 e 8.6.3) e 80 de blocos. **Tração**: capacidade = 0,7 × atrito (Campos; V&L), editável; N negativo no dimensionamento (flexo-tração) e ancoragem plena l_b.
**Manuseio de pré-moldadas** (NBR 16258:2014, 6.2.1, 8.2–8.3): içamento por 1 ponto (0,05·q·L²·α) e 2 pontos (0,02·q·L²·α), α ≥ 1,3, MRd da seção armada e armadura transversal (1,38 e 2,76 cm²/m, CA-60). Painel em Análises avançadas. Testes: 375.

## 32. Validação com o TCC de Pacchioni (UNESP, 2022) (v1.16)
`core/validacao-tcc.test.ts` (30 testes): Aoki-Velloso hélice Ø70 (Rp idêntico em todas as profundidades; Rl difere por convenção — o app conta 6–7 m e usa N da base do metro, o trabalho omite 6–6,9 m e usa N do topo; Pult do app até 11 % maior); blocos de 2 estacas (As, θ, tensões idênticos), 4 estacas (As ≤ 0,6 %, θ e σ idênticos) e 3 estacas (θ e σ idênticos; As do trabalho é 33–45 % maior porque a fórmula foi aplicada como e√3 − 0,9·ap/d, em vez de (e√3 − 0,9·ap)/d); armadura da estaca 13 Ø12,5 em 4 m reproduzida com coeficiente 1,4 na tensão N/A. Diferenças de critério: suspensão sempre dimensionada (Bastos) e 6 estacas retangulares fora do roteiro (modelo de Campos).

## 33. Nome do projeto, tabela de capacidades e P2 do TCC (v1.17)
**Nome do projeto**: campo "Projeto" na barra superior (salvo no projeto; dá nome ao arquivo .json e aparece sob o logotipo). **Tabela de capacidades** (Análises avançadas → Capacidade de carga): por método, R_l, R_p, R (carga geotécnica) e P_adm por metro de ponta, coluna "Adotada" (menor ou média dos métodos marcados), base do bloco editável (atrito acima dela não conta) e exportação CSV.
**P2 do TCC**: com os dados do TCC a melhor solução tem gaiola de 4 m (não integral); a gaiola integral só ocorre quando N/A > limite da Tab. 4 ou o normal supera a capacidade da seção com armação mínima em todo o fuste (estacas muito carregadas), e agora o aviso diz o motivo. Corrigido: a verificação S2 do CEB-70 gerava limite absurdo (48 kN) quando o pilar é mais largo que o espaçamento das estacas (P2: 204 cm sobre estacas a 2,10 m), reprovando o Ø70 × 4 estacas do próprio TCC; com a correção esse bloco passa e a estaca fica 13 Ø12,5 em 4 m, como no trabalho.

## 34. Folga do bloco padrão, afastamento das estacas e utilização por estaca (v1.18)
Padrão da folga passou a **Bastos, grande porte** (15 cm da face da estaca à borda; Ø70 a 3·dE → bloco 310 cm, antes 380 cm pela regra de Campos dE + 15 cm eixo–borda; concreto do bloco −33 % no P3 do TCC). A regra de Campos continua como opção; projetos salvos mantêm a escolha. Novo parâmetro: **afastamento entre eixos (× diâmetro)**, vazio = mínimo da literatura por tipo. Planta de estacas mostra carga/Padm e % de utilização.

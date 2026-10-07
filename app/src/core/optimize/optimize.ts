/**
 * Otimização econômica da fundação de um pilar: tipo de estaca × diâmetro × arranjo (automático, conforme Campos) ×
 * comprimento, com verificações geotécnicas (SPT), de serviço (deslocamento horizontal no topo) e estruturais
 * (flexo-compressão e cortante da estaca), e custo a partir dos valores informados pelo usuário.
 *
 * Método:
 *  1. por tipo e diâmetro: capacidade admissível por profundidade (Fase 1, o menor entre os métodos escolhidos);
 *  2. por arranjo: n inicial por Campos (§11.1.1), espaçamento ≥ mínimo da Tab. 10.21; comprimento mínimo pela verificação
 *     vertical clássica (superposição, bloco rígido, estacas articuladas — convenção conservadora);
 *  3. análise do grupo (Fase 3) em ELS (deslocamento ≤ limite, compressão ≤ Padm, tração) e em ELU (esforços para o
 *     dimensionamento; EI constante e, depois, EI(M) pelo momento-curvatura da armadura obtida);
 *  4. dimensionamento estrutural (Fase 4) e custo; ranking por custo.
 * Para evitar avaliar tudo, os candidatos são ordenados por um limite inferior de custo e a busca para quando o próximo
 * limite supera o melhor custo encontrado (ramificação e poda).
 *
 * Unidades: kN, m, R$.
 */
import { PILE_LABEL, pileArea, type PileType } from '../pile'
import type { SptBorehole } from '../soil'
import { SOIL_TYPES, weakestEnvelope } from '../soil'
import type { LoadCombination } from '../loads'
import {
  admissibleLoad,
  aokiVelloso,
  decourtQuaresma,
  teixeira,
  type CapacityMethod,
  type CapacityParams,
  type SafetyOptions,
} from '../capacity'
import { buildLateralProfile, type Loading, type ProfileOptions } from '../lateral'
import { blockGeometry, designBlock, type BlockInput, type BlockMethod, type BlockResult, type BlockShape } from '../block'
import {
  analyzeGroup,
  concreteProps,
  initialPileCount,
  LAYOUT_COUNTS,
  layoutsFor,
  minSpacing,
  type GroupInput,
  type GroupPile,
  type GroupResult,
  type Layout,
} from '../group'
import {
  designStructural,
  type Caa,
  type Demands,
  type StructuralDesign,
  type StructuralOptions,
  type TransverseType,
} from '../structural/design'
import { negativeFriction, type NegFrictionInput } from '../special/negfriction'
import { softClaySection, softClayThickness, SOFT_CLAY_NSPT_DEFAULT, VERY_SOFT_CLAY_NSPT } from '../special/softsoil'
import { settlementOfGroup, type RaftDepth, type SettlementResult } from '../special/settlement'
import { momentCurvature, secantEI, type Materials } from '../structural/section'
import { fx } from '../format'

// ------------------------------------------------------------------ custos

/** Estimativa de geometria do bloco (antes da análise). */
export interface BlockEstimate {
  lx: number
  ly: number
  h: number
  volume: number
  formArea: number
}

export interface ExtraCost {
  name: string
  basis: 'porEstaca' | 'porBloco' | 'porMetroDeEstaca' | 'porM3DeEstaca'
  /** R$ por unidade da base. */
  value: number
}

export interface CostParams {
  /** R$/m³ de concreto da estaca. */
  concretePerM3: number
  /** Sobreconsumo de concreto (fração; 0,15 = 15 %). */
  concreteOverrun: number
  /** R$/kg de aço (CA-50) — estaca e bloco. */
  steelPerKg: number
  /** R$/m de execução da estaca, por diâmetro em cm (chave "40" etc.). Ausente = 0. */
  executionPerM: Record<string, number>
  /** R$/estaca. */
  mobilizationPerPile: number
  /** R$/estaca (arrasamento/preparo da cabeça) — valor geral. */
  cutOffPerPile: number
  /** Arrasamento por diâmetro em cm (chave "40" etc.); se ausente vale cutOffPerPile. */
  cutOffByDiameter: Record<string, number>
  /** R$/kg de aço do bloco (se ausente, usa steelPerKg). */
  blockSteelPerKg?: number
  /** R$/m² de lastro de concreto magro sob o bloco. */
  leanPerM2: number
  blockConcretePerM3: number
  blockFormPerM2: number
  extras: ExtraCost[]
}

export const ZERO_COSTS: CostParams = {
  concretePerM3: 0,
  concreteOverrun: 0,
  steelPerKg: 0,
  executionPerM: {},
  mobilizationPerPile: 0,
  cutOffPerPile: 0,
  cutOffByDiameter: {},
  leanPerM2: 0,
  blockConcretePerM3: 0,
  blockFormPerM2: 0,
  extras: [],
}

export interface CostBreakdown {
  concrete: number
  steel: number
  execution: number
  mobilization: number
  cutOff: number
  block: number
  extras: number
  total: number
}

const costIsZero = (c: CostParams) =>
  c.concretePerM3 === 0 && c.steelPerKg === 0 && Object.values(c.executionPerM).every((v) => v === 0) && c.mobilizationPerPile === 0 &&
  c.cutOffPerPile === 0 && Object.values(c.cutOffByDiameter).every((v) => v === 0) && c.leanPerM2 === 0 && c.blockConcretePerM3 === 0 && c.blockFormPerM2 === 0 && c.extras.every((e) => e.value === 0)

// ------------------------------------------------------------------ entradas/saídas

export interface OptimizeInput {
  boreholes: SptBorehole[]
  capacityMethods?: CapacityMethod[]
  /** 'menor' (padrão): vale o menor Padm entre os métodos; 'media': média dos Padm. */
  capacityCombine?: 'menor' | 'media'
  /** Percentual (%) das resistências de ponta e lateral usado (padrão 100). */
  tipUsePct?: number
  shaftUsePct?: number
  capacityParams?: CapacityParams
  safety?: SafetyOptions
  pillar: { ax: number; ay: number }
  /** Área total (m²) quando o bloco recebe dois pilares (então `pillar` é a caixa envolvente). */
  pillarArea?: number
  combos: LoadCombination[]
  types: PileType[]
  /** Diâmetros candidatos (m) por tipo. */
  diameters: Partial<Record<PileType, number[]>>
  caa: Caa
  transverse: TransverseType
  /** Profundidade da base do bloco abaixo do terreno (m). */
  topDepth: number
  Lmin?: number
  Lmax?: number
  /** Deslocamento horizontal máximo no topo em ELS (m). Padrão 0,025. */
  serviceLimit?: number
  costs: CostParams
  groupEffect?: 'davisson' | 'none'
  fck?: number
  /** Fator de rigidez do EI constante usado em ELS (e na 1ª passada em ELU). */
  eiFactor?: number
  nonlinearEI?: boolean
  loading?: Loading
  permitTension?: boolean
  /** Capacidade à tração = fator × atrito lateral admissível à compressão (Campos e Velloso & Lopes: redução da ordem de 30 %; padrão 0,7); peso próprio desprezado. */
  tensionShaftFactor?: number
  headFixity?: 'engastada' | 'articulada'
  /** Excentricidade executiva (m) somada ao momento de cálculo (NBR 6122, 8.5.6.1). */
  execEccentricity?: number
  /** Peso específico do concreto do bloco (kN/m³) e coeficiente de majoração no ELU. */
  blockUnitWeight?: number
  blockWeightFactorELU?: number
  /** Acréscimo (m) à dE na distância do eixo da estaca à borda do bloco (Campos, Fig. 12.21: a = dE + 15 cm). */
  blockMargin?: number
  blockKR?: number
  /** Afastamento entre eixos das estacas, em múltiplos do diâmetro; omitido = mínimo da literatura por tipo (Campos, Tab. 10.21). */
  pileSpacingFactor?: number
  /** N_SPT máximo para considerar a argila "mole" (NBR 6122:2022, 8.6.5.1); padrão 5. */
  softClayNspt?: number
  /** Atrito negativo (NBR 6122:2022, 5.8; Velloso & Lopes §18.1): ponto neutro, β, γ, sobrecarga e NA. */
  negFriction?: NegFrictionInput
  /** Coeficiente de ponderação do atrito negativo como compressão no ELU (a norma não fixa; padrão 1,4). */
  negFrictionFactor?: number
  /** Esforço normal ao longo da estaca: 'atrito' (padrão) desconta o atrito lateral mobilizado; 'constante' mantém a carga do topo em todo o fuste (a favor da segurança). */
  axialTransfer?: 'atrito' | 'constante'
  /** Recalque do grupo (radier fictício): profundidade do radier, espraiamento, fator do módulo E e limite (m; sem limite se omitido). */
  settlement?: { raftDepth?: RaftDepth; spread?: number; eFactor?: number; limit?: number }
  /** Folga (m) da face da estaca à borda do bloco; se informada, sobrepõe blockMargin. */
  blockEdgeClear?: number
  /** fck inicial do bloco (MPa); sobe a 35 e 40 se a biela não passar. */
  blockFck?: number
  /** α da armadura segundo os lados (blocos de 4 estacas). */
  blockAlpha?: number
  /** Opções do perfil lateral (φ', Su = fator·N, sobrescritas por camada do primeiro furo selecionado). */
  lateralOptions?: ProfileOptions
  /** Furo da análise lateral: 'envoltoria' = camada mais fraca entre os furos selecionados (padrão, conservador); 'primeiro' = só o primeiro. */
  lateralHoles?: 'envoltoria' | 'primeiro'
  /** Edições estruturais (Tab. 4, cobrimento, aço, taxa mínima…). */
  structural?: StructuralOptions
  /** Método de dimensionamento das armaduras do bloco. */
  blockMethod?: BlockMethod
  /** Formato do bloco em planta (padrão: retangular no núcleo). */
  blockShape?: BlockShape
  /** Altura mínima do bloco (m) e fator de dE para o d mínimo do bloco de 1 estaca. */
  blockHMin?: number
  blockD1Factor?: number
  /** Ângulos-limite das bielas do bloco (graus). */
  blockThetaMin?: number
  blockThetaMax?: number
  /** Restringe a busca (o usuário "trava" parte da solução). */
  fixed?: { type?: PileType; diameter?: number; layoutId?: string; n?: number; length?: number }
  maxResults?: number
  maxEvaluations?: number
}

export interface Candidate {
  type: PileType
  diameter: number
  layout: Layout
  spacing: number
  length: number
  block: BlockEstimate
  design: StructuralDesign
  blockDesign: BlockResult
  cost: CostBreakdown
  quantities: { pileConcreteM3: number; steelKg: number; totalPileLength: number }
  service: {
    maxHeadDisplacement: number
    maxCompression: number
    minAxial: number
    padm: number
    ok: boolean
  }
  /** Esforços de cálculo de maior momento (ELU). */
  maxMomentELU: { value: number; z: number; combo: string; pile: string }
  /** Perfis ao longo da estaca mais solicitada (z a partir do topo da estaca) para os gráficos. */
  profiles: {
    els: { z: number[]; y: number[]; combo: string }
    elu: { z: number[]; M: number[]; V: number[]; N: number; /** normal de cálculo ao longo da estaca (kN), por nó */ Nz?: number[]; combo: string; pile: string }
  }
  /** Maior compressão por estaca nas combinações ELS (kN), na ordem do arranjo. */
  pileAxialELS: number[]
  /** Esforços de cálculo (ELU) ao longo de cada estaca, um conjunto por combinação × estaca (para verificar armaduras editadas). */
  demands: { sets: Demands[]; labels: { combo: string; pile: string }[] }
  /** Verificações especiais: argila mole (m atravessados), atrito negativo (kN) e recalque do grupo. */
  special?: { softClayM: number; negFriction?: { Qn: number; Qnd: number; zNeutral: number }; settlement?: SettlementResult & { limit?: number } }
  /** Dados usados no dimensionamento do bloco (permitem redimensionar com altura ou fck editados). */
  blockInput: BlockInput
  warnings: string[]
}

export interface Rejection {
  type: PileType
  diameter: number
  layoutId: string
  reason: string
}

export interface OptimizeResult {
  best: Candidate[]
  rejected: Rejection[]
  evaluated: number
  /** Custos todos zerados: classificação por volume de concreto e massa de aço. */
  proxyRanking: boolean
  warnings: string[]
}

// ------------------------------------------------------------------ capacidade geotécnica

interface CapacityTable {
  /** Padm (kN) por profundidade de ponta z (m, do terreno), z = 1…zmax. */
  padm: (z: number) => number
  /** Parcela de atrito admissível (kN), para tração. */
  shaftAdm: (z: number) => number
  zmax: number
  /**
   * Fração f(z) da carga que ainda atua na profundidade z (m abaixo da base do bloco): f = 1 − Rl(z)/R_total, com mobilização
   * proporcional do atrito e da ponta (mesma segurança nos dois). Com ponto neutro (z_n, m abaixo da base do bloco), vale
   * f = 1 − [Rl(z) − Rl(z_n)]/[R_total − Rl(z_n)] para z > z_n. Entre métodos e furos vale o maior f (maior normal: a favor da segurança).
   */
  axialFractionFn: (L: number, zNeutralRel?: number) => (z: number) => number
  warnings: string[]
}

function capacityTable(inp: OptimizeInput, type: PileType, D: number): CapacityTable {
  const methods = inp.capacityMethods ?? ['aoki-velloso', 'decourt-quaresma', 'teixeira']
  const run = { 'aoki-velloso': aokiVelloso, 'decourt-quaresma': decourtQuaresma, teixeira }
  const warnings: string[] = []
  const perMethod = methods.map((m) => inp.boreholes.map((b) => {
    const r = run[m](b, { pile: { type, diameter: D }, params: inp.capacityParams, tipFactor: (inp.tipUsePct ?? 100) / 100, shaftFactor: (inp.shaftUsePct ?? 100) / 100 })
    warnings.push(...r.warnings)
    return r.rows
  }))
  const zmax = Math.min(...inp.boreholes.map((b) => b.layers.length))
  // atrito acima da base do bloco não contribui: desconta Rl(topDepth)
  const rlAt = (rows: { depth: number; Rl: number }[], z: number) => {
    if (z <= 0) return 0
    const i = Math.min(Math.floor(z), rows.length)
    const a = i >= 1 ? rows[i - 1].Rl : 0
    const b = i < rows.length ? rows[i].Rl : a
    return a + (z - i) * (b - a)
  }
  const make = (shaftOnly: boolean) => (z: number) => {
    const vals: number[] = []
    perMethod.forEach((holes) => {
      const res = holes.map((rows) => {
        const row = rows[Math.min(Math.max(Math.round(z), 1), rows.length) - 1]
        const rl = row.Rl - rlAt(rows, inp.topDepth)
        return shaftOnly ? Math.max(rl, 0) : Math.max(row.Rp + rl, 0)
      })
      vals.push(admissibleLoad(res, inp.safety).Padm)
    })
    return inp.capacityCombine === 'media' ? vals.reduce((a, b) => a + b, 0) / vals.length : Math.min(...vals)
  }
  const axialFractionFn = (L: number, zNeutralRel?: number) => {
    const tip = inp.topDepth + L
    const step = 0.1
    const n = Math.ceil(L / step) + 1
    const table = new Array<number>(n).fill(0)
    for (const holes of perMethod) for (const rows of holes) {
      const row = rows[Math.min(Math.max(Math.round(tip), 1), rows.length) - 1]
      const rl0 = rlAt(rows, inp.topDepth)
      const rlN = zNeutralRel !== undefined ? Math.max(rlAt(rows, inp.topDepth + Math.min(zNeutralRel, L)) - rl0, 0) : 0
      const total = Math.max(row.Rp + row.Rl - rl0 - rlN, 0)
      for (let i = 0; i < n; i++) {
        const z = Math.min(i * step, L)
        if (zNeutralRel !== undefined && z <= zNeutralRel) { table[i] = 1; continue }
        const rl = Math.max(rlAt(rows, inp.topDepth + z) - rl0 - rlN, 0)
        table[i] = Math.max(table[i], total <= 0 ? 1 : Math.min(Math.max(1 - rl / total, 0), 1))
      }
    }
    return (z: number) => {
      const t = Math.min(Math.max(z, 0), L) / step
      const i = Math.min(Math.floor(t), n - 2)
      return n < 2 ? table[0] : table[i] + (t - i) * (table[i + 1] - table[i])
    }
  }
  return { padm: make(false), shaftAdm: make(true), zmax, axialFractionFn, warnings: [...new Set(warnings)] }
}

// ------------------------------------------------------------------ utilitários

const BLOCK_ELS_FACTOR = 1

function soilClassOf(b: SptBorehole, depth: number): 'coesivo' | 'granular' {
  const layers = b.layers.filter((l) => l.depth <= depth)
  const sand = layers.filter((l) => l.soil.startsWith('areia')).length
  return sand > layers.length / 2 ? 'granular' : 'coesivo'
}

/** Atrito negativo para a estaca de diâmetro D e comprimento L: Qn característico, Qn de cálculo e redução da capacidade (atrito positivo no trecho do ponto neutro). */
function specialLoads(inp: OptimizeInput, cap: CapacityTable, D: number, L: number) {
  const nf = inp.negFriction
  if (!nf) return { Qn: 0, Qnd: 0, padmCut: 0 }
  const tip = inp.topDepth + L
  const Qn = negativeFriction(D, inp.topDepth, tip, nf)
  return { Qn, Qnd: Qn * (inp.negFrictionFactor ?? 1.4), padmCut: Qn + cap.shaftAdm(Math.min(nf.zNeutral, tip)) }
}

/**
 * Perfil do esforço normal N(z) (kN) ao longo da estaca, dado o normal N do topo: sem atrito negativo, N·f(z) (atrito lateral
 * mobilizado); com atrito negativo, cresce de N até N + γf·Qn no ponto neutro e depois diminui pelo atrito positivo. Retorna
 * `undefined` quando o normal é tomado constante (opção do usuário e sem atrito negativo).
 */
function makeAxialProfile(inp: OptimizeInput, cap: CapacityTable, D: number, L: number, negFactor: number): ((z: number, N: number) => number) | undefined {
  const nf = inp.negFriction
  const constant = inp.axialTransfer === 'constante'
  if (constant && !nf) return undefined
  if (!nf) {
    const f = cap.axialFractionFn(L)
    return (z, N) => (N > 0 ? N * f(z) : N)
  }
  const zNrel = Math.min(Math.max(nf.zNeutral - inp.topDepth, 0), L)
  const f = constant ? () => 1 : cap.axialFractionFn(L, zNrel)
  const step = 0.1
  const n = Math.ceil(L / step) + 1
  const Q = Array.from({ length: n }, (_, i) => negativeFriction(D, inp.topDepth, inp.topDepth + Math.min(i * step, zNrel), nf) * negFactor)
  const qAt = (z: number) => {
    const t = Math.min(Math.max(z, 0), zNrel) / step
    const i = Math.min(Math.floor(t), n - 2)
    return n < 2 ? Q[0] : Q[i] + (t - i) * (Q[i + 1] - Q[i])
  }
  return (z, N) => (z <= zNrel ? N + qAt(z) : (N + qAt(zNrel)) * f(z))
}

/** Esforço axial máximo/mínimo por superposição (bloco rígido, estacas articuladas) em um conjunto de combinações. */
function verticalExtremes(layout: Layout, combos: LoadCombination[], extraN: (state: 'ELU' | 'ELS') => number, states: ('ELU' | 'ELS')[]) {
  const sx = layout.points.reduce((a, p) => a + p.x * p.x, 0)
  const sy = layout.points.reduce((a, p) => a + p.y * p.y, 0)
  let max = -Infinity
  let min = Infinity
  for (const c of combos.filter((q) => states.includes(q.state))) {
    const N = c.fz + extraN(c.state)
    for (const p of layout.points) {
      const P = N / layout.n + (sx > 0 ? (c.my * p.x) / sx : 0) - (sy > 0 ? (c.mx * p.y) / sy : 0)
      max = Math.max(max, P)
      min = Math.min(min, P)
    }
  }
  return { max, min }
}

function costOf(inp: OptimizeInput, type: PileType, D: number, L: number, n: number, steelKgPile: number, block: { volume: number; formArea: number; leanArea?: number }, blockSteelKg = 0): CostBreakdown {
  const c = inp.costs
  const volPile = pileArea(D) * L
  const concrete = n * volPile * (1 + c.concreteOverrun) * c.concretePerM3
  const steel = n * steelKgPile * c.steelPerKg + blockSteelKg * (c.blockSteelPerKg ?? c.steelPerKg)
  const dcm = Math.round(D * 100)
  const execution = n * L * (c.executionPerM[`${type}:${dcm}`] ?? c.executionPerM[String(dcm)] ?? 0)
  const mobilization = n * c.mobilizationPerPile
  const cutOff = n * (c.cutOffByDiameter[String(dcm)] ?? c.cutOffPerPile)
  const blockCost = block.volume * c.blockConcretePerM3 + block.formArea * c.blockFormPerM2 + (block.leanArea ?? 0) * c.leanPerM2
  const extras = c.extras.reduce((a, e) => {
    switch (e.basis) {
      case 'porEstaca': return a + n * e.value
      case 'porBloco': return a + e.value
      case 'porMetroDeEstaca': return a + n * L * e.value
      case 'porM3DeEstaca': return a + n * volPile * e.value
    }
  }, 0)
  const total = concrete + steel + execution + mobilization + cutOff + blockCost + extras
  return { concrete, steel, execution, mobilization, cutOff, block: blockCost, extras, total }
}

// ------------------------------------------------------------------ avaliação de um candidato

/** Perfil lateral conforme `lateralHoles`; na envoltória as sobrescritas por camada (feitas num furo) não se aplicam. */
function lateralProfileOf(inp: OptimizeInput) {
  if ((inp.lateralHoles ?? 'envoltoria') === 'primeiro' || inp.boreholes.length === 1) return buildLateralProfile(inp.boreholes[0], inp.lateralOptions ?? {})
  const env = weakestEnvelope(inp.boreholes)
  const prof = buildLateralProfile(env, { ...(inp.lateralOptions ?? {}), overrides: undefined })
  prof.warnings.push(`Análise lateral com a envoltória dos furos ${inp.boreholes.map((b) => b.id).join(', ')} (menor N_SPT em cada metro, NA mais raso, profundidade do furo mais curto); sobrescritas por camada não se aplicam.`)
  return prof
}

interface Ctx {
  inp: OptimizeInput
  lateralProfile: ReturnType<typeof buildLateralProfile>
}

function groupInput(ctx: Ctx, layout: Layout, type: PileType, D: number, L: number, combo: LoadCombination, extraN: number, nonlinear?: GroupInput['eiModel'], axial?: GroupPile['axialProfile']): GroupInput {
  const { inp } = ctx
  const piles: GroupPile[] = layout.points.map((p, i) => ({
    id: `E${i + 1}`, x: p.x, y: p.y, type, diameter: D, length: L,
    headFixity: inp.headFixity ?? 'engastada', profile: ctx.lateralProfile, axialProfile: axial,
  }))
  return {
    piles,
    loads: { fx: combo.fx, fy: combo.fy, fz: combo.fz + extraN, mx: combo.mx, my: combo.my, mz: combo.mz },
    fck: inp.fck ?? 30,
    eiFactor: inp.eiFactor ?? 0.8,
    topDepth: inp.topDepth,
    loading: inp.loading ?? 'static',
    groupEffect: inp.groupEffect ?? 'davisson',
    eiModel: nonlinear,
  }
}

/** Esforços de cálculo (conjuntos de demandas) a partir dos resultados ELU. */
/** Opções estruturais do usuário repassadas ao dimensionamento da estaca. */
export function structFor(inp: OptimizeInput, type: PileType) {
  const o = inp.structural
  return { t4: o?.t4?.[type], cover: o?.cover, fyk: o?.fyk, gammaS: o?.gammaS, dmax: o?.dmax, sacrificial: o?.sacrificial, minRho: o?.minRho, noRebarDivisor: o?.noRebarDivisor, anchorBlock: o?.anchorBlock }
}

function demandSets(results: { combo: LoadCombination; res: GroupResult }[], ecc: number, axial?: (z: number, N: number) => number): { sets: Demands[]; labels: { combo: string; pile: string }[]; max: Candidate['maxMomentELU']; profile: Candidate['profiles']['elu'] } {
  const sets: Demands[] = []
  const labels: { combo: string; pile: string }[] = []
  let max: Candidate['maxMomentELU'] = { value: -1, z: 0, combo: '', pile: '' } // −1: o primeiro nó sempre define o perfil, mesmo sem momento (carga só vertical)
  let profile: Candidate['profiles']['elu'] = { z: [], M: [], V: [], N: 0, combo: '', pile: '' }
  for (const { combo, res } of results) {
    for (const p of res.piles) {
      if (p.z.length === 0) continue
      const z0 = p.z[0]
      const zr = p.z.map((z) => z - z0)
      // estaca tracionada: tração tomada constante ao longo do fuste (a favor da segurança); caso contrário N(z) com atrito
      const Nz = p.axial < 0 ? zr.map(() => p.axial) : zr.map((z) => Math.max(axial ? axial(z, p.axial) : p.axial, 0))
      const N = Nz[0]
      const M = p.M_res.map((m, i) => m + Nz[i] * ecc)
      sets.push({ z: zr, N: Nz, M, V: p.V_res })
      labels.push({ combo: combo.name, pile: p.id })
      p.M_res.forEach((_, i) => {
        // maior momento; empatados (p.ex. só carga vertical, M = 0), vale a estaca de maior normal
        if (M[i] > max.value + 1e-9 || (Math.abs(M[i] - max.value) <= 1e-9 && Nz[0] > (profile.Nz?.[0] ?? -1))) {
          max = { value: M[i], z: p.z[i] - z0, combo: combo.name, pile: p.id }
          profile = { z: zr, M, V: p.V_res, N, Nz, combo: combo.name, pile: p.id }
        }
      })
    }
  }
  if (max.value < 0) max = { ...max, value: 0 }
  return { sets, labels, max, profile }
}

/** Modelo EI(M) (momento-curvatura) da armadura de `d`, com cache por nível de esforço normal. */
function eiModelFor(inp: OptimizeInput, D: number, d: StructuralDesign): GroupInput['eiModel'] {
  const cache = new Map<number, (M: number) => number>() // por armadura: a curva depende da seção
  const mat: Materials = { fck: d.fck, gammaC: d.gammaC, fyk: inp.structural?.fyk ?? 500, gammaS: inp.structural?.gammaS ?? 1.15 }
  const Ec = concreteProps(d.fck).Ecs
  const fct = 0.3 * d.fck ** (2 / 3) * 1000
  const l = d.longitudinal!
  const sec = { D, n: l.n, phi: Math.max(l.phiMm / 1000 - 0.002, 0.005), Rs: l.Rs }
  return (N) => {
    const key = Math.round(N / 50)
    let fn = cache.get(key)
    if (!fn) {
      const curve = momentCurvature(sec, mat, key * 50, { Ec, fct })
      fn = (M: number) => secantEI(curve, M)
      cache.set(key, fn)
    }
    return fn
  }
}

/**
 * Reanálise dos esforços de cálculo (ELU) de um candidato com a armadura do usuário: a rigidez EI(M) passa a vir
 * do momento-curvatura DESSA armadura (`design` com `longitudinal`). Devolve os novos conjuntos de esforços.
 */
export function reanalyzeELU(inp: OptimizeInput, c: Candidate, design: StructuralDesign) {
  const ctx: Ctx = { inp, lateralProfile: lateralProfileOf(inp) }
  const eluN = (inp.blockUnitWeight ?? 25) * c.block.volume * (inp.blockWeightFactorELU ?? 1.4)
  const elu = inp.combos.filter((q) => q.state === 'ELU')
  const model = eiModelFor(inp, c.diameter, design)
  const capR = capacityTable(inp, c.type, c.diameter)
  const axELU = makeAxialProfile(inp, capR, c.diameter, c.length, inp.negFrictionFactor ?? 1.4)
  const res = elu.map((combo) => ({ combo, res: analyzeGroup(groupInput(ctx, c.layout, c.type, c.diameter, c.length, combo, eluN, model, axELU)) }))
  const converged = res.every((r) => r.res.converged)
  const unstable = res.some((r) => r.res.warnings.some((w) => w.includes('Instabilidade')))
  // as reações axiais mudam com a rigidez da armadura (acoplamento do grupo): o bloco é redimensionado com elas
  const reactions = res.map(({ combo, res: r }) => ({ name: combo.name, P: r.piles.map((p) => p.axial), Nsd: combo.fz }))
  const blockDesign = designBlock({ ...c.blockInput, combos: reactions })
  return { ...demandSets(res, inp.execEccentricity ?? 0, axELU), converged, unstable, blockDesign }
}

/** Resultado da verificação de uma locação ajustada (estacas fora da posição de projeto). */
export interface AsBuilt {
  layout: Layout
  service: Candidate['service']
  elsProfile: Candidate['profiles']['els']
  pileAxialELS: number[]
  demands: Candidate['demands']
  eluProfile: Candidate['profiles']['elu']
  maxMomentELU: Candidate['maxMomentELU']
  blockInput: BlockInput
  blockDesign: BlockResult
  converged: boolean
  unstable: string
  /** Limites em ELS verificados: deslocamento, compressão e tração. */
  limits: { head: number; padm: number; tension: number }
  notes: string[]
}

/**
 * Reverifica a solução com as estacas em outras coordenadas (por exemplo, erro de locação em obra): mesma estaca,
 * comprimento e armadura; refaz o grupo em ELS e ELU, o bloco (com as opções `blockOpts`) e devolve os novos esforços.
 */
export function reevaluateWithLayout(inp: OptimizeInput, c: Candidate, points: Layout['points'], design: StructuralDesign, blockOpts: Partial<BlockInput> = {}): AsBuilt {
  const ctx: Ctx = { inp, lateralProfile: lateralProfileOf(inp) }
  const layout: Layout = { ...c.layout, id: `${c.layout.id}*`, label: 'Locação ajustada', points }
  const D = c.diameter
  const L = c.length
  const bg = blockGeometry(points, D, inp.pillar, { pillarArea: inp.pillarArea, edgeMargin: inp.blockMargin ?? 0.15, edgeClear: inp.blockEdgeClear, caa: inp.caa, thetaMin: inp.blockThetaMin, thetaMax: inp.blockThetaMax, lx: blockOpts.lx, ly: blockOpts.ly, hMin: inp.blockHMin, d1Factor: inp.blockD1Factor, shape: blockOpts.shape ?? inp.blockShape })
  const blockW = (inp.blockUnitWeight ?? 25) * bg.volume
  const eluN = blockW * (inp.blockWeightFactorELU ?? 1.4)
  const els = inp.combos.filter((q) => q.state === 'ELS')
  const elu = inp.combos.filter((q) => q.state === 'ELU')
  const cap = capacityTable(inp, c.type, D)
  const sp = specialLoads(inp, cap, D, L)
  const axELS = makeAxialProfile(inp, cap, D, L, 1)
  const axELU = makeAxialProfile(inp, cap, D, L, inp.negFrictionFactor ?? 1.4)
  const padm = cap.padm(inp.topDepth + L) - sp.padmCut
  const limit = inp.serviceLimit ?? 0.025
  const notes: string[] = []

  let maxHead = 0
  let elsProfile: Candidate['profiles']['els'] = { z: [], y: [], combo: '' }
  const pileMax = new Array<number>(layout.n).fill(-Infinity)
  let maxComp = -Infinity
  let minAxial = Infinity
  let unstable = ''
  for (const q of els) {
    const r = analyzeGroup(groupInput(ctx, layout, c.type, D, L, q, blockW * BLOCK_ELS_FACTOR, undefined, axELS))
    if (!r.converged && r.warnings.some((w) => w.includes('Instabilidade'))) unstable = 'instabilidade (flambagem) em ELS'
    r.piles.forEach((p, ip) => {
      pileMax[ip] = Math.max(pileMax[ip], p.axial)
      if ((p.headDisplacement > maxHead || elsProfile.z.length === 0) && p.z.length) elsProfile = { z: p.z.map((z) => z - p.z[0]), y: p.y_res, combo: q.name }
      maxHead = Math.max(maxHead, p.headDisplacement)
      maxComp = Math.max(maxComp, p.axial)
      minAxial = Math.min(minAxial, p.axial)
    })
  }
  const tension = inp.permitTension ? (inp.tensionShaftFactor ?? 0.7) * cap.shaftAdm(inp.topDepth + L) : 0
  const okService = !unstable && maxHead <= limit && maxComp <= padm && minAxial >= -tension - 1e-6

  const model = inp.nonlinearEI !== false ? eiModelFor(inp, D, design) : undefined
  const res = elu.map((q) => ({ combo: q, res: analyzeGroup(groupInput(ctx, layout, c.type, D, L, q, eluN, model, axELU)) }))
  const converged = res.every((r) => r.res.converged)
  if (res.some((r) => r.res.warnings.some((w) => w.includes('Instabilidade')))) unstable = unstable || 'instabilidade (flambagem) em ELU'
  const dm = demandSets(res, inp.execEccentricity ?? 0, axELU)

  const reactions = res.map(({ combo, res: r }) => ({ name: combo.name, P: r.piles.map((p) => p.axial), Nsd: combo.fz }))
  const blockInput: BlockInput = {
    ...c.blockInput, ...blockOpts, piles: points, combos: reactions, serviceMaxP: maxComp,
  }
  const blockDesign = designBlock(blockInput)
  notes.push(`Peso do bloco recalculado com h ≈ ${fx(bg.h, 2)} m (${fx(blockW, 0)} kN).`)
  return {
    layout, service: { maxHeadDisplacement: maxHead, maxCompression: maxComp, minAxial, padm, ok: okService },
    elsProfile, pileAxialELS: pileMax, demands: { sets: dm.sets, labels: dm.labels }, eluProfile: dm.profile, maxMomentELU: dm.max,
    blockInput, blockDesign, converged, unstable, limits: { head: limit, padm, tension }, notes,
  }
}

function evaluateCandidate(
  ctx: Ctx, cap: CapacityTable, type: PileType, D: number, layout: Layout, spacing: number, L0: number, block: BlockEstimate, rejections: Rejection[],
): Candidate | undefined {
  const { inp } = ctx
  const Lmax = Math.min(inp.Lmax ?? 40, cap.zmax - inp.topDepth)
  const reject = (reason: string) => {
    rejections.push({ type, diameter: D, layoutId: layout.id, reason })
    return undefined
  }
  const blockW = (inp.blockUnitWeight ?? 25) * block.volume
  const eluN = blockW * (inp.blockWeightFactorELU ?? 1.4)
  const els = inp.combos.filter((c) => c.state === 'ELS')
  const elu = inp.combos.filter((c) => c.state === 'ELU')
  if (els.length === 0 || elu.length === 0) return reject('Informe combinações ELS e ELU.')
  const limit = inp.serviceLimit ?? 0.025

  let settleFail = ''
  for (let L = L0; L <= Lmax; L++) {
    const sp = specialLoads(inp, cap, D, L)
    const padm = cap.padm(inp.topDepth + L) - sp.padmCut
    const axELS = makeAxialProfile(inp, cap, D, L, 1)
    const axELU = makeAxialProfile(inp, cap, D, L, inp.negFrictionFactor ?? 1.4)
    const softM = softClayThickness(inp.boreholes, inp.topDepth, inp.topDepth + L, inp.softClayNspt ?? SOFT_CLAY_NSPT_DEFAULT)
    if (softM > 0) {
      const sc = softClaySection(D, L)
      if (!sc.ok) return reject(`Argila mole atravessada (${softM} m): ${sc.reasons.join('; ')}.`)
    }
    // --- ELS
    let maxHead = 0
    let elsProfile: Candidate['profiles']['els'] = { z: [], y: [], combo: '' }
    const pileMax = new Array<number>(layout.n).fill(-Infinity)
    let maxComp = -Infinity
    let minAxial = Infinity
    let lateralOk = true
    let axialOk = true
    let unstable = ''
    for (const c of els) {
      const r = analyzeGroup(groupInput(ctx, layout, type, D, L, c, blockW * BLOCK_ELS_FACTOR, undefined, axELS))
      if (!r.converged && r.warnings.some((w) => w.includes('Instabilidade'))) unstable = 'instabilidade (flambagem) em ELS'
      r.piles.forEach((p, ip) => {
        pileMax[ip] = Math.max(pileMax[ip], p.axial)
        if ((p.headDisplacement > maxHead || elsProfile.z.length === 0) && p.z.length) elsProfile = { z: p.z.map((z) => z - p.z[0]), y: p.y_res, combo: c.name }
        maxHead = Math.max(maxHead, p.headDisplacement)
        maxComp = Math.max(maxComp, p.axial)
        minAxial = Math.min(minAxial, p.axial)
      })
    }
    if (unstable) return reject(unstable)
    if (maxHead > limit) lateralOk = false
    if (maxComp > padm) axialOk = false
    const tensionLimit = inp.permitTension ? (inp.tensionShaftFactor ?? 0.7) * cap.shaftAdm(inp.topDepth + L) : 0
    if (minAxial < -tensionLimit - 1e-6) axialOk = false
    if (!lateralOk) {
      // aumentar o comprimento não reduz o deslocamento além do comprimento ativo: descarta o candidato
      if (L >= Math.min(L0 + 6, Lmax)) return reject(`Deslocamento no topo ${fx((maxHead * 1000), 1)} mm > ${fx((limit * 1000), 0)} mm (ELS).`)
      continue
    }
    if (!axialOk) continue
    let settlement: (SettlementResult & { limit?: number }) | undefined
    if (inp.settlement) {
      const xs = layout.points.map((q) => q.x), ys = layout.points.map((q) => q.y)
      const Qs = Math.max(...els.map((c) => c.fz)) + blockW * BLOCK_ELS_FACTOR
      settlement = {
        ...settlementOfGroup({
          boreholes: inp.boreholes, topDepth: inp.topDepth, L, Bx: Math.max(...xs) - Math.min(...xs) + D, By: Math.max(...ys) - Math.min(...ys) + D, Q: Qs + layout.n * sp.Qn,
          Pmax: maxComp + sp.Qn, D, Ec: concreteProps(inp.fck ?? 30).Ecs, raftDepth: inp.settlement.raftDepth, spread: inp.settlement.spread, eFactor: inp.settlement.eFactor,
        }),
        limit: inp.settlement.limit,
      }
      if (inp.settlement.limit !== undefined && settlement.total > inp.settlement.limit) {
        settleFail = `Recalque estimado do grupo ${fx((settlement.total * 1000), 1)} mm > ${fx((inp.settlement.limit * 1000), 0)} mm.`
        continue
      }
    }

    // --- ELU: 1ª passada com EI constante
    const runELU = (nonlinear?: GroupInput['eiModel']) => elu.map((c) => ({ combo: c, res: analyzeGroup(groupInput(ctx, layout, type, D, L, c, eluN, nonlinear, axELU)) }))
    let eluRes = runELU()
    if (eluRes.some((r) => r.res.warnings.some((w) => w.includes('Instabilidade')))) return reject('Instabilidade (flambagem) em ELU.')
    let { sets, labels, max, profile } = demandSets(eluRes, inp.execEccentricity ?? 0, axELU)
    let design = designStructural({ type, D, L, caa: inp.caa, fck: inp.fck, transverse: inp.transverse, demands: sets, ...structFor(inp, type) })
    if (!design.feasible) return reject(design.reasons.join(' '))

    // --- ELU: 2ª passada com EI(M) do momento-curvatura da armadura obtida
    if (inp.nonlinearEI !== false) {
      const makeModel = (d: StructuralDesign) => eiModelFor(inp, D, d)
      for (let pass = 0; pass < 2; pass++) {
        eluRes = runELU(makeModel(design))
        if (eluRes.some((r) => !r.res.converged)) return reject('Análise não linear (EI(M)) não convergiu em ELU: momento acima da capacidade da seção.')
        const dm = demandSets(eluRes, inp.execEccentricity ?? 0, axELU)
        const nd = designStructural({ type, D, L, caa: inp.caa, fck: inp.fck, transverse: inp.transverse, demands: dm.sets, ...structFor(inp, type) })
        if (!nd.feasible) return reject(nd.reasons.join(' '))
        const same = nd.longitudinal!.n === design.longitudinal!.n && nd.longitudinal!.phiMm === design.longitudinal!.phiMm
        sets = dm.sets
        labels = dm.labels
        max = dm.max
        profile = dm.profile
        design = nd
        if (same) break
      }
    }

    const n = layout.n
    const steelKg = design.weights!.totalKg
    // --- bloco: reações de cálculo (ELU) de cada estaca → bielas e tirantes
    const reactions = eluRes.map(({ combo, res }) => ({ name: combo.name, P: res.piles.map((p) => p.axial), Nsd: combo.fz }))
    let bd: BlockResult | undefined
    let blockInput!: BlockInput
    for (const fckB of [...new Set([inp.blockFck ?? 30, 35, 40].filter((v) => v >= (inp.blockFck ?? 30)))]) {
      blockInput = {
        piles: layout.points, dE: D, pillar: inp.pillar, pillarArea: inp.pillarArea, fckBlock: fckB, caa: inp.caa, combos: reactions, serviceMaxP: maxComp,
        edgeMargin: inp.blockMargin ?? 0.15, edgeClear: inp.blockEdgeClear, alphaSides: inp.blockAlpha ?? 0.8, thetaMin: inp.blockThetaMin, thetaMax: inp.blockThetaMax, method: inp.blockMethod, kr: inp.blockKR, hMin: inp.blockHMin, d1Factor: inp.blockD1Factor, shape: inp.blockShape,
      }
      bd = designBlock(blockInput)
      if (bd.feasible) break
    }
    if (!bd || !bd.feasible) return reject(`Bloco: ${bd?.reasons.join(' ') ?? 'sem solução'}`)
    const cost = costOf(inp, type, D, L, n, steelKg, { volume: bd.quantities.concreteM3, formArea: bd.quantities.formM2, leanArea: bd.quantities.leanConcreteM2 }, bd.quantities.steelKg)
    const warnings = [...new Set([...design.warnings, ...cap.warnings, ...ctx.lateralProfile.warnings])]
    if (!inp.groupEffect || inp.groupEffect === 'davisson') warnings.push('Efeito de grupo lateral por Davisson (1970), conforme Velloso & Lopes §15.7.')
    if (L >= Math.floor(cap.zmax - inp.topDepth)) warnings.push(`A estaca chegou ao fim da sondagem (${cap.zmax} m, descontada a base do bloco a ${inp.topDepth} m): não há dados de SPT abaixo disso. Aprofunde a sondagem se precisar de mais capacidade.`)
    warnings.push(`Peso do bloco (${fx(blockW, 0)} kN, h estimada ${fx(block.h, 2)} m) somado às cargas; ELU com fator ${fx(inp.blockWeightFactorELU ?? 1.4, 2)}.`)
    if (Math.abs(bd.geometry.h - block.h) > 0.1 * block.h) warnings.push(`A altura final do bloco (${fx(bd.geometry.h, 2)} m) difere da estimada (${fx(block.h, 2)} m) usada no peso próprio: reexecute com a altura definitiva se a diferença for relevante.`)
    warnings.push(...bd.warnings)
    if (softM > 0) {
      warnings.push(`Estaca atravessa ${softM} m de argila mole (N ≤ ${inp.softClayNspt ?? SOFT_CLAY_NSPT_DEFAULT}): atendidos W e raio de giração mínimos (NBR 6122:2022, 8.6.5.1); efeitos de 2ª ordem entram no P-Δ da análise.`)
      if (softClayThickness(inp.boreholes, inp.topDepth, inp.topDepth + L, VERY_SOFT_CLAY_NSPT) > 0)
        warnings.push('Há argila muito mole (N ≤ 2): confirme as condições de apoio do topo e verifique desvios de execução (excentricidade executiva) — NBR 6122:2022, 8.6.1.')
    }
    if (inp.negFriction) warnings.push(`Atrito negativo: Qn = ${fx(sp.Qn, 0)} kN por estaca (β = ${fx(inp.negFriction.beta, 2)}, ponto neutro a ${inp.negFriction.zNeutral} m); no ELU entra como compressão ×${fx(inp.negFrictionFactor ?? 1.4, 2)}; no ELS desconta-se o atrito positivo do trecho do ponto neutro (NBR 6122:2022, 5.8).`)
    if (settlement) warnings.push(`Recalque estimado do grupo: ${fx((settlement.total * 1000), 1)} mm (radier fictício ${fx((settlement.raft * 1000), 1)} mm + encurtamento elástico ${fx((settlement.elastic * 1000), 1)} mm)${settlement.truncated ? '; a sondagem termina antes da profundidade de influência — valor subestimado' : ''}.`)
    if (layout.n === 2 && inp.combos.some((q) => Math.abs(layout.points[0].x === layout.points[1].x ? q.my : q.mx) > 1e-9))
      warnings.push('Bloco sobre duas estacas: o momento na direção perpendicular à linha das estacas é resistido só pela flexão das estacas; considere viga de travamento (NBR 6122, 8.5.6.1) ou verifique com cuidado.')
    return {
      type, diameter: D, layout, spacing, length: L, block, design, blockDesign: bd, cost,
      quantities: { pileConcreteM3: n * pileArea(D) * L, steelKg: n * steelKg, totalPileLength: n * L },
      service: { maxHeadDisplacement: maxHead, maxCompression: maxComp, minAxial, padm, ok: true },
      maxMomentELU: max,
      profiles: { els: elsProfile, elu: profile },
      pileAxialELS: pileMax,
      demands: { sets, labels },
      blockInput,
      special: {
        softClayM: softM,
        negFriction: inp.negFriction ? { Qn: sp.Qn, Qnd: sp.Qnd, zNeutral: inp.negFriction.zNeutral } : undefined,
        settlement,
      },
      warnings,
    }
  }
  return reject(settleFail || `Não atende com L ≤ ${Lmax} m (capacidade geotécnica insuficiente ou perfil de sondagem curto).`)
}

// ------------------------------------------------------------------ otimização

export interface Progress {
  done: number
  total: number
  found: number
}

function* optimizeSteps(inp: OptimizeInput): Generator<Progress, OptimizeResult> {
  const warnings: string[] = []
  const rejected: Rejection[] = []
  if (inp.boreholes.length === 0) throw new Error('Selecione ao menos uma sondagem.')
  const profile = lateralProfileOf(inp) // exige NA informado
  const ctx: Ctx = { inp, lateralProfile: profile }
  const proxy = costIsZero(inp.costs)
  if (proxy) warnings.push('Custos zerados: classificação por volume de concreto (estacas + bloco) e massa de aço. Informe os custos para ranquear em R$.')

  const hasMoment = inp.combos.some((c) => Math.abs(c.mx) + Math.abs(c.my) > 1e-9)
  const blockUnit = inp.blockUnitWeight ?? 25
  const Nmax = Math.max(...inp.combos.map((c) => c.fz), 0)
  const Lmin = inp.Lmin ?? 3
  const Lmax = inp.Lmax ?? 40

  interface Item { type: PileType; D: number; layout: Layout; spacing: number; L0: number; block: BlockEstimate; lb: number; cap: CapacityTable }
  const items: Item[] = []
  const capCache = new Map<string, CapacityTable>()
  const types = inp.fixed?.type ? [inp.fixed.type] : inp.types
  for (const type of types) {
    const ds = inp.fixed?.diameter ? [inp.fixed.diameter] : (inp.diameters[type] ?? [])
    for (const D of ds) {
      const key = `${type}|${D}`
      if (!capCache.has(key)) capCache.set(key, capacityTable(inp, type, D))
      const cap = capCache.get(key)!
      const zTop = inp.topDepth
      const zMaxL = Math.min(Lmax, cap.zmax - zTop)
      if (zMaxL < Lmin) {
        rejected.push({ type, diameter: D, layoutId: '-', reason: 'Perfil de sondagem mais curto que o comprimento mínimo.' })
        continue
      }
      const capMax = cap.padm(zTop + zMaxL)
      if (!(capMax > 0)) {
        rejected.push({ type, diameter: D, layoutId: '-', reason: 'Capacidade geotécnica nula.' })
        continue
      }
      const spacingMin = minSpacing(type, D, soilClassOf(inp.boreholes[0], zTop + zMaxL))
      const spacing = inp.pileSpacingFactor ? Math.max(inp.pileSpacingFactor * D, 0.3) : spacingMin
      const n0 = initialPileCount(Nmax, capMax, hasMoment)
      const counts = inp.fixed?.n ? [inp.fixed.n] : LAYOUT_COUNTS.filter((n) => n >= n0 && n <= n0 + 3)
      for (const n of counts) {
        for (const layout of layoutsFor(n, spacing)) {
          if (inp.fixed?.layoutId && layout.id !== inp.fixed.layoutId) continue
          const bg = blockGeometry(layout.points, D, inp.pillar, { pillarArea: inp.pillarArea, edgeMargin: inp.blockMargin ?? 0.15, edgeClear: inp.blockEdgeClear, caa: inp.caa, thetaMin: inp.blockThetaMin, thetaMax: inp.blockThetaMax, hMin: inp.blockHMin, d1Factor: inp.blockD1Factor, shape: inp.blockShape })
          const block: BlockEstimate = { lx: bg.lx, ly: bg.ly, h: bg.h, volume: bg.volume, formArea: bg.formArea }
          const W = blockUnit * block.volume
          const ext = verticalExtremes(layout, inp.combos, (s) => (s === 'ELU' ? W * (inp.blockWeightFactorELU ?? 1.4) : W), ['ELS'])
          let L0 = inp.fixed?.length ?? 0
          if (!L0) {
            for (let L = Lmin; L <= zMaxL; L++) {
              if (cap.padm(zTop + L) >= ext.max) { L0 = L; break }
            }
          }
          if (!L0) {
            rejected.push({ type, diameter: D, layoutId: layout.id, reason: `Capacidade geotécnica insuficiente (carga na estaca ≈ ${fx(ext.max, 0)} kN).` })
            continue
          }
          const lbCost = costOf(inp, type, D, L0, layout.n, 0, block).total
          const lbProxy = layout.n * pileArea(D) * L0 + block.volume
          items.push({ type, D, layout, spacing, L0, block, lb: proxy ? lbProxy : lbCost, cap })
        }
      }
    }
  }
  items.sort((a, b) => a.lb - b.lb)

  const best: Candidate[] = []
  const K = inp.maxResults ?? 8
  const maxEval = inp.maxEvaluations ?? 40
  let evaluated = 0
  let mirrored = 0
  const score = (c: Candidate) => (proxy ? c.quantities.pileConcreteM3 + c.block.volume + c.quantities.steelKg / 7850 : c.cost.total)
  for (const it of items) {
    if (evaluated >= maxEval) {
      warnings.push(`Busca limitada a ${maxEval} candidatos avaliados.`)
      break
    }
    if (best.length >= K && it.lb >= score(best[K - 1])) break
    evaluated++
    yield { done: evaluated, total: Math.min(items.length, maxEval), found: best.length }
    const c = evaluateCandidate(ctx, it.cap, it.type, it.D, it.layout, it.spacing, inp.fixed?.length ?? it.L0, it.block, rejected)
    if (!c) continue
    // arranjos espelhados (base em X ou em Y) com mesmo tipo, diâmetro, comprimento e custo (≤ 1 %) são a mesma solução
    const baseId = (id: string) => id.replace(/[xy]\*?$/, '')
    if (best.some((b) => b.type === c.type && b.diameter === c.diameter && b.layout.n === c.layout.n && b.length === c.length && baseId(b.layout.id) === baseId(c.layout.id) && Math.abs(score(b) - score(c)) <= 0.01 * score(b))) { mirrored++; continue }
    best.push(c)
    best.sort((a, b) => score(a) - score(b))
    if (best.length > K) best.length = K
  }
  if (mirrored > 0) warnings.push(`${mirrored} solução(ões) espelhada(s) (base em X ou Y, mesmo custo) omitida(s) do ranking.`)
  if (best.length === 0) warnings.push('Nenhuma solução atende a todas as verificações. Veja os motivos em "descartados".')
  void PILE_LABEL
  void SOIL_TYPES
  return { best, rejected, evaluated, proxyRanking: proxy, warnings }
}

/** Execução síncrona (testes, scripts). */
export function optimize(inp: OptimizeInput): OptimizeResult {
  const g = optimizeSteps(inp)
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
  }
}

/** Execução que devolve o controle ao navegador entre candidatos (barra de progresso e cancelamento). */
export async function optimizeAsync(inp: OptimizeInput, onProgress?: (p: Progress) => void, signal?: { cancelled: boolean }): Promise<OptimizeResult> {
  const g = optimizeSteps(inp)
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
    onProgress?.(r.value)
    if (signal?.cancelled) {
      g.return({ best: [], rejected: [], evaluated: r.value.done, proxyRanking: false, warnings: [] })
      return { best: [], rejected: [], evaluated: r.value.done, proxyRanking: false, warnings: ['Cancelado pelo usuário.'] }
    }
    await new Promise((res) => setTimeout(res, 0))
  }
}

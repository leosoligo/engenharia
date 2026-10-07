/** Parâmetros editáveis da otimização (tela "Parâmetros"), com persistência local. */
import { PILE_TYPES, type PileType } from './core/pile'
import { DEFAULT_COST_SOURCE, type CostOverrides, type CostSource } from './costs'
import type { Caa, StructuralOptions, TransverseType } from './core/structural/design'
import type { LayerOverride, ProfileOptions } from './core/lateral'
import type { BlockMethod, BlockShape } from './core/block'
import type { VerifyInput } from './core/structural/verify'
import type { Loading } from './core/lateral'
import type { CapacityMethod, CapacityParams, SafetyMode } from './core/capacity'

export interface Settings {
  serviceLimitMm: number
  eiFactor: number
  nonlinearEI: boolean
  loading: Loading
  groupEffect: 'davisson' | 'none'
  permitTension: boolean
  /** Capacidade à tração = fator × atrito lateral à compressão (Campos; Velloso & Lopes: redução da ordem de 30 %). */
  tensionShaftFactor: number
  headFixity: 'engastada' | 'articulada'
  execEccentricityCm: number
  blockUnitWeight: number
  blockWeightFactorELU: number
  blockMarginCm: number
  blockKR: number
  /** Afastamento entre eixos das estacas (× diâmetro); null = mínimo da literatura por tipo de estaca. */
  pileSpacingFactor: number | null
  /** Folga da face da estaca à borda do bloco: 'campos' (a = dE + margem), 'grande' (≥ 15 cm) ou 'pequeno' (≥ 5 cm), Bastos 2023. */
  blockEdgeRule: 'campos' | 'grande' | 'pequeno'
  blockFck: number
  blockAlpha: number
  /** Vazio = mínimo da Tab. 4 da NBR 6122 para o tipo e a CAA. */
  fck: number | null
  caa: Caa
  transverse: TransverseType
  topDepth: number
  Lmin: number
  Lmax: number
  /** 'auto': a menor profundidade que atende (entre Lmín e Lmáx); 'fixo': usa `lengthFixed`. */
  lengthMode: 'auto' | 'fixo'
  lengthFixed: number
  maxResults: number
  methods: Record<CapacityMethod, boolean>
  /** Como combinar os métodos selecionados: o menor (conservador, padrão) ou a média das cargas admissíveis. */
  capacityCombine: 'menor' | 'media'
  /** Percentual das resistências de ponta e lateral considerado (100 = integral). */
  tipUsePct: number
  shaftUsePct: number
  safetyMode: SafetyMode
  fsGlobal: number
  /** Coeficientes dos métodos de capacidade de carga editados pelo usuário. */
  capParams: CapacityParams
  typesEnabled: Record<PileType, boolean>
  /** Diâmetros candidatos em cm, por tipo. */
  diameters: Record<PileType, number[]>
  /** Origem dos custos-base (SINAPI por UF ou manual) e edições do usuário sobre eles. */
  costSource: CostSource
  costs: CostOverrides
  /** Solo para a análise lateral (p-y): regra de φ', Su = fator·N e sobrescritas por camada de cada furo. */
  lateral: { phiRule: 'conservador' | 'godoy' | 'teixeira'; suFactor: number; overrides: Record<string, Record<number, LayerOverride>> }
  /** Edições estruturais (Tab. 4 por tipo, cobrimento, aço, taxa mínima…). */
  structural: StructuralOptions
  blockThetaMin: number
  blockThetaMax: number
  /** Método de dimensionamento das armaduras do bloco (padrão: o mais conservador entre os implementados). */
  blockMethod: BlockMethod
  /** Formato do bloco em planta: contorno otimizado (padrão) ou retangular. */
  blockShape: BlockShape
  /** Altura mínima do bloco (cm) e, para 1 estaca, d mínimo = fator × diâmetro (valores usuais: 50 cm e 1,2). */
  blockHMinCm: number
  blockD1Factor: number
  /** N_SPT máximo da argila considerada "mole" (NBR 6122:2022, 8.6.5.1); a norma não fixa o valor. */
  softClayNspt: number
  /** Esforço normal na estaca: desconta o atrito lateral mobilizado ('atrito') ou mantém a carga do topo ('constante'). */
  axialTransfer: 'atrito' | 'constante'
  /** Atrito negativo (NBR 6122:2022, 5.8): β de Long e Healy por tipo de solo, ponto neutro, γ, sobrecarga e γf do ELU. */
  negFriction: { on: boolean; zNeutral: number; soil: 'argila' | 'silte' | 'areia'; beta: number; gamma: number; surcharge: number; factorELU: number }
  /** Recalque do grupo pelo radier fictício; limite 0 = apenas informar. */
  settlement: { on: boolean; raftDepth: 'ponta' | 'dois-tercos' | 'um-terco'; spread: number; eFactor: number; limitMm: number }
}

/** Opções do perfil lateral do furo, a partir dos parâmetros do projeto. */
export function lateralOptions(s: Settings, holeId: string | undefined): ProfileOptions {
  return { phiRule: s.lateral.phiRule, suFactor: s.lateral.suFactor, overrides: holeId ? s.lateral.overrides[holeId] : undefined }
}

/** Diâmetros usuais de cada tipo de estaca (cm). */
const DIAMETERS: Record<PileType, number[]> = {
  helice: [35, 40, 50, 60, 70, 80, 90, 100],
  escavada: [25, 30, 35, 40, 45, 50],
  escavada_fluido: [60, 80, 100, 120],
  strauss: [25, 32, 38, 42, 45],
  franki: [35, 40, 45, 52, 60],
  raiz: [10, 12, 15, 20, 25, 31],
  premoldada: [],
}

export const DEFAULT_SETTINGS: Settings = {
  serviceLimitMm: 25,
  eiFactor: 0.8,
  nonlinearEI: true,
  loading: 'static',
  groupEffect: 'davisson',
  permitTension: false,
  tensionShaftFactor: 0.7,
  headFixity: 'engastada',
  execEccentricityCm: 0,
  blockUnitWeight: 25,
  blockWeightFactorELU: 1.4,
  blockMarginCm: 15,
  blockKR: 0.9,
  pileSpacingFactor: null,
  blockEdgeRule: 'grande',
  blockFck: 30,
  blockAlpha: 0.8,
  fck: null,
  caa: 2,
  transverse: 'estribo',
  topDepth: 1,
  Lmin: 3,
  Lmax: 40,
  lengthMode: 'auto',
  lengthFixed: 9,
  maxResults: 8,
  methods: { 'aoki-velloso': true, 'decourt-quaresma': true, teixeira: true },
  capacityCombine: 'menor',
  tipUsePct: 100,
  shaftUsePct: 100,
  safetyMode: 'conservador',
  fsGlobal: 2,
  capParams: {},
  typesEnabled: { helice: true, escavada: true, escavada_fluido: false, strauss: false, franki: false, raiz: false, premoldada: false },
  diameters: DIAMETERS,
  costSource: DEFAULT_COST_SOURCE,
  costs: {},
  lateral: { phiRule: 'conservador', suFactor: 10, overrides: {} },
  structural: {},
  blockThetaMin: 45,
  blockThetaMax: 55,
  blockMethod: 'conservador',
  blockShape: 'tipico',
  blockHMinCm: 50,
  blockD1Factor: 1.2,
  softClayNspt: 5,
  axialTransfer: 'atrito',
  negFriction: { on: false, zNeutral: 6, soil: 'argila', beta: 0.25, gamma: 18, surcharge: 0, factorELU: 1.4 },
  settlement: { on: false, raftDepth: 'dois-tercos', spread: 0.5, eFactor: 1, limitMm: 0 },
}

const KEY = 'estakalc.settings.v2'

/** Completa parâmetros salvos (de versões anteriores) com os padrões atuais. */
export function normalizeSettings(s: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS, ...s,
    methods: { ...DEFAULT_SETTINGS.methods, ...s.methods },
    typesEnabled: { ...DEFAULT_SETTINGS.typesEnabled, ...s.typesEnabled },
    diameters: { ...DEFAULT_SETTINGS.diameters, ...s.diameters },
    costSource: { ...DEFAULT_SETTINGS.costSource, ...s.costSource },
    costs: s.costs ?? {},
    lateral: { ...DEFAULT_SETTINGS.lateral, ...s.lateral },
    structural: s.structural ?? {},
    negFriction: { ...DEFAULT_SETTINGS.negFriction, ...s.negFriction },
    settlement: { ...DEFAULT_SETTINGS.settlement, ...s.settlement },
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    return normalizeSettings(JSON.parse(raw) as Partial<Settings>)
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* armazenamento indisponível: segue sem persistir */
  }
}

export const OPTIMIZABLE_TYPES = PILE_TYPES.filter((t) => t !== 'premoldada')

/** Dados comuns (sem esforços) para verificar a armadura de uma estaca com os parâmetros do projeto. */
export function verifyBase(s: Settings, c: { type: PileType; diameter: number; length: number }): Omit<VerifyInput, 'demands'> {
  const o = s.structural
  return { type: c.type, D: c.diameter, L: c.length, caa: s.caa, fck: s.fck ?? undefined, t4: o.t4?.[c.type], cover: o.cover, fyk: o.fyk, gammaS: o.gammaS, dmax: o.dmax, sacrificial: o.sacrificial, noRebarDivisor: o.noRebarDivisor, minRho: o.minRho }
}

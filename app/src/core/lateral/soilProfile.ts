/**
 * Parâmetros do solo para a análise lateral, estimados a partir do SPT (correlações empíricas) e
 * editáveis pelo usuário. Cada correlação é de uso preliminar (como dizem as próprias fontes).
 *
 * Fontes (Marangon, Geotecnia de Fundações, UFJF, 2018, p. 68–69; conferido na página 69):
 *  - Su = 10·N (kPa) — Teixeira & Godoy (1996);
 *  - φ' (areias) = 28° + 0,4·N — Godoy (1983);  φ' = √(20·N) + 15° — Teixeira (1996). Padrão: o menor.
 *  - γ — Godoy (1972), Tab. 8 (argilas, por N) e Tab. 9 (areias: úmida/saturada, por N).
 */
import type { SoilType, SptBorehole } from '../soil'
import { apiSandK, stiffClayTab153 } from './pyCurves'

export type LateralModel = 'sand' | 'softClay' | 'stiffClay' | 'linear'

export const MODEL_LABEL: Record<LateralModel, string> = {
  sand: 'Areia — API',
  softClay: 'Argila mole — Matlock (1970)',
  stiffClay: 'Argila rija — Reese et al. (1975)',
  linear: 'Linear — Terzaghi (nh)',
}

/** Parâmetros efetivos de uma camada de 1 m (cada campo pode ser sobrescrito pelo usuário). */
export interface LateralLayer {
  top: number
  bottom: number
  soil: SoilType
  nspt: number
  model: LateralModel
  /** Peso específico efetivo γ' (kN/m³). */
  gammaEff: number
  /** φ' (graus) — areia. */
  phi: number
  /** k inicial API (kN/m³) — areia. */
  kSand: number
  /** Su (kPa) — argilas. */
  su: number
  epsC: number
  J: number
  /** ks e kc (kN/m³) — argila rija. */
  ks: number
  kc: number
  /** nh (kN/m³) — modelo linear. */
  nh: number
  belowWaterTable: boolean
}

export type LayerOverride = Partial<Omit<LateralLayer, 'top' | 'bottom' | 'soil' | 'nspt' | 'belowWaterTable'>>

export interface ProfileOptions {
  /** Nível d'água (m, profundidade). Obrigatório (aqui ou no furo); Infinity = não encontrado na sondagem. */
  waterLevel?: number
  /** Sobrescritas por profundidade da camada (1, 2, 3 … m). */
  overrides?: Record<number, LayerOverride>
  /** Regra de φ' para areias. */
  phiRule?: 'conservador' | 'godoy' | 'teixeira'
  /** Se verdadeiro, usa o modelo linear (nh) em todas as camadas. */
  forceLinear?: boolean
  nhLinear?: number
  /** Su = fator × N_SPT (kPa). Padrão 10 (Teixeira & Godoy). */
  suFactor?: number
}

export class MissingWaterLevelError extends Error {
  constructor(boreholeId: string) {
    super(`Informe o nível d'água do furo ${boreholeId} (ou marque "não encontrado").`)
    this.name = 'MissingWaterLevelError'
  }
}

const GAMMA_W = 10 // kN/m³
export const SU_SOFT_LIMIT = 98.0665 / 2 // 0,5 kgf/cm² — limite inferior da Tab. 15.3 de V&L

const isSand = (s: SoilType) => s.startsWith('areia')

function gammaClay(n: number): number {
  return n <= 2 ? 13 : n <= 5 ? 15 : n <= 10 ? 17 : n <= 19 ? 19 : 21
}
function gammaSand(n: number): { moist: number; sat: number } {
  if (n <= 8) return { moist: 18, sat: 19 }
  if (n <= 18) return { moist: 19, sat: 20 }
  return { moist: 20, sat: 21 }
}
export function phiFromN(n: number, rule: 'conservador' | 'godoy' | 'teixeira' = 'conservador'): number {
  const godoy = 28 + 0.4 * n
  const teixeira = Math.sqrt(20 * n) + 15
  const phi = rule === 'godoy' ? godoy : rule === 'teixeira' ? teixeira : Math.min(godoy, teixeira)
  return Math.min(Math.max(phi, 20), 40) // faixa 20°–40° das Figs. 15.6b/c de V&L
}

export interface LateralProfile {
  layers: LateralLayer[]
  warnings: string[]
}

export function buildLateralProfile(bh: SptBorehole, opt: ProfileOptions = {}): LateralProfile {
  const warnings: string[] = []
  const wl = opt.waterLevel ?? bh.waterLevel
  if (wl === undefined || Number.isNaN(wl)) throw new MissingWaterLevelError(bh.id)
  if (wl === Infinity) warnings.push('NA não encontrado na sondagem: solo considerado acima do nível d’água em todo o perfil.')
  const na = wl
  const sorted = [...bh.layers].sort((a, b) => a.depth - b.depth)
  const layers = sorted.map((l): LateralLayer => {
    const top = l.depth - 1
    const bottom = l.depth
    const mid = (top + bottom) / 2
    const below = mid >= na
    const sand = isSand(l.soil)
    const su = (opt.suFactor ?? 10) * l.nspt
    const gammaEff = sand
      ? below
        ? gammaSand(l.nspt).sat - GAMMA_W
        : gammaSand(l.nspt).moist
      : below
        ? gammaClay(l.nspt) - GAMMA_W
        : gammaClay(l.nspt)
    const phi = sand ? phiFromN(l.nspt, opt.phiRule) : 0
    const t153 = stiffClayTab153(su)
    const model: LateralModel = opt.forceLinear ? 'linear' : sand ? 'sand' : su < SU_SOFT_LIMIT ? 'softClay' : 'stiffClay'
    const base: LateralLayer = {
      top,
      bottom,
      soil: l.soil,
      nspt: l.nspt,
      model,
      gammaEff,
      phi,
      kSand: sand ? apiSandK(phi, below) : 0,
      su,
      epsC: model === 'stiffClay' ? t153.epsC : 0.01,
      J: 0.5,
      ks: t153.ks,
      kc: t153.kc,
      nh: opt.nhLinear ?? 0,
      belowWaterTable: below,
    }
    const ov = opt.overrides?.[l.depth]
    const merged = ov ? { ...base, ...ov } : base
    // consistência: se o usuário mudou φ' e não k, recalcula k pela API
    if (ov && ov.phi !== undefined && ov.kSand === undefined && merged.model === 'sand') merged.kSand = apiSandK(merged.phi, below)
    return merged
  })
  if (!sorted.some((l) => !isSand(l.soil))) {
    /* só areias */
  } else {
    warnings.push('Silte e argilas: Su = 10·N (Teixeira & Godoy); γ pela Tab. 8 de Godoy (1972) — correlações de uso preliminar.')
  }
  if (sorted.some((l) => isSand(l.soil)))
    warnings.push('Areias: φ\' = menor entre 28° + 0,4N (Godoy) e √(20N) + 15° (Teixeira), limitado a 20°–40°; γ pela Tab. 9 de Godoy (1972).')
  return { layers, warnings }
}

/** Camada que contém a profundidade z (a última se z estiver abaixo do perfil). */
export function layerAt(p: LateralProfile, z: number): LateralLayer {
  const ls = p.layers
  for (const l of ls) if (z <= l.bottom) return l
  return ls[ls.length - 1]
}

/** Tensão vertical efetiva (kPa), média de γ' (kN/m³) e média de Su (kPa) de 0 até z. */
export function stressesAt(p: LateralProfile, z: number) {
  let sigma = 0
  let suInt = 0
  let remaining = Math.max(z, 0)
  for (const l of p.layers) {
    if (remaining <= 0) break
    const dz = Math.min(l.bottom - l.top, remaining)
    sigma += l.gammaEff * dz
    suInt += l.su * dz
    remaining -= dz
  }
  if (remaining > 0) {
    const last = p.layers[p.layers.length - 1]
    sigma += last.gammaEff * remaining
    suInt += last.su * remaining
  }
  const zz = Math.max(z, 1e-9)
  return { sigmaV: sigma, gammaAvg: sigma / zz, suAvg: suInt / zz }
}

/**
 * Parâmetros de cálculo editáveis. Os valores padrão vêm de `tables.ts`; o usuário pode sobrescrever
 * qualquer um deles (decisão técnica dele). Os campos ausentes mantêm o padrão.
 */
import type { PileType } from '../pile'
import type { SoilClass3, SoilType } from '../soil'
import { DQ_C, dqAlphaBeta, resolveAv, teixeiraAlphaBeta, type AvSetId } from './tables'

export interface CapacityParams {
  avSet?: AvSetId
  avSoil?: Partial<Record<SoilType, Partial<{ K: number; alpha: number }>>>
  avF?: Partial<Record<PileType, Partial<{ F1: number; F2: number }>>>
  dqC?: Partial<Record<SoilType, number>>
  dqAlpha?: Partial<Record<PileType, Partial<Record<SoilClass3, number>>>>
  dqBeta?: Partial<Record<PileType, Partial<Record<SoilClass3, number>>>>
  dqNlMax?: Partial<Record<PileType, number>>
  txAlpha?: Partial<Record<PileType, Partial<Record<SoilType, number>>>>
  txBeta?: Partial<Record<PileType, number>>
  /** Limita a resistência de ponta a este percentual (%) da resistência lateral (limitar a resistência de ponta). */
  tipLimitPct?: number
  /** Despreza o atrito lateral no último metro do fuste (grava-se só quando verdadeiro). */
  ignoreLastMeter?: boolean
  /** Limites de N_SPT no atrito lateral de Aoki-Velloso e Teixeira (Décourt-Quaresma usa o limite superior próprio). */
  sptShaftLimits?: Partial<Record<PileType, { min?: number; max?: number }>>
}

/** Há algum valor sobrescrito pelo usuário? (para exibir aviso). */
export function hasOverrides(p?: CapacityParams): boolean {
  if (!p) return false
  const nonEmpty = (o: unknown): boolean =>
    o !== null && typeof o === 'object' ? Object.values(o).some(nonEmpty) : o !== undefined
  return nonEmpty({ ...p, avSet: undefined })
}

export const AV_DEFAULT_SET: AvSetId = 'cintra'

export function avEffective(p: CapacityParams | undefined, type: PileType, D: number) {
  const r = resolveAv(p?.avSet ?? AV_DEFAULT_SET, type, D)
  const soil = (s: SoilType) => ({
    K: p?.avSoil?.[s]?.K ?? r.soil[s].K,
    alpha: p?.avSoil?.[s]?.alpha ?? r.soil[s].alpha,
  })
  return {
    ...r,
    soilValue: soil,
    F1: p?.avF?.[type]?.F1 ?? r.F1,
    F2: p?.avF?.[type]?.F2 ?? r.F2,
  }
}

export function dqEffective(p: CapacityParams | undefined, type: PileType) {
  const base = dqAlphaBeta(type)
  return {
    source: base.source,
    nlMax: p?.dqNlMax?.[type] ?? base.nlMax,
    alpha: (c: SoilClass3) => p?.dqAlpha?.[type]?.[c] ?? base.alpha[c],
    beta: (c: SoilClass3) => p?.dqBeta?.[type]?.[c] ?? base.beta[c],
    C: (s: SoilType) => ({ C: p?.dqC?.[s] ?? DQ_C[s].C, source: DQ_C[s].source }),
  }
}

export function txEffective(p: CapacityParams | undefined, type: PileType, soil: SoilType) {
  const base = teixeiraAlphaBeta(type, soil)
  return {
    alpha: p?.txAlpha?.[type]?.[soil] ?? base.alpha,
    beta: p?.txBeta?.[type] ?? base.beta,
    source: base.source,
  }
}

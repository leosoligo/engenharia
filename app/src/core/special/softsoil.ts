/**
 * Estacas em camadas de argila mole (NBR 6122:2022, 8.6.1 e 8.6.5.1): espessura da camada mole atravessada e requisitos
 * estruturais mínimos de seção. A norma não define numericamente "argila mole": o limite de N_SPT é parâmetro editável
 * (padrão 5, faixa "mole" da NBR 6484: 3 a 5 golpes; N ≤ 2 = "muito mole").
 */
import { soilClass3, type SptBorehole } from '../soil'
import { fx } from '../format'

export const SOFT_CLAY_NSPT_DEFAULT = 5
export const VERY_SOFT_CLAY_NSPT = 2

/** Maior espessura (m) de argila com N_SPT ≤ nMax entre as profundidades z0 e z1 (m do terreno), entre os furos. */
export function softClayThickness(boreholes: SptBorehole[], z0: number, z1: number, nMax = SOFT_CLAY_NSPT_DEFAULT): number {
  let best = 0
  for (const b of boreholes) {
    const n = b.layers.filter((l) => l.depth > z0 && l.depth <= Math.ceil(z1) && soilClass3(l.soil) === 'argila' && l.nspt <= nMax).length
    best = Math.max(best, n)
  }
  return best
}

export interface SoftClayCheck {
  ok: boolean
  /** Módulo resistente W (cm³) e raio de giração i (cm) da seção circular cheia. */
  W: number
  i: number
  Wmin: number
  iMin: number
  reasons: string[]
}

/** NBR 6122:2022, 8.6.5.1: W ≥ 930 cm³; i ≥ 5,4 cm (20 a 30 m) e ≥ 6,4 cm (> 30 m). Seção circular cheia de diâmetro D (m). */
export function softClaySection(D: number, L: number): SoftClayCheck {
  const dcm = D * 100
  const W = (Math.PI * dcm ** 3) / 32
  const i = dcm / 4
  const Wmin = 930
  const iMin = L > 30 ? 6.4 : L >= 20 ? 5.4 : 0
  const reasons: string[] = []
  if (W < Wmin) reasons.push(`W = ${fx(W, 0)} cm³ < 930 cm³ (NBR 6122:2022, 8.6.5.1-a)`)
  if (i < iMin) reasons.push(`raio de giração ${fx(i, 1)} cm < ${iMin} cm para L = ${L} m (NBR 6122:2022, 8.6.5.1-${L > 30 ? 'c' : 'b'})`)
  return { ok: reasons.length === 0, W, i, Wmin, iMin, reasons }
}

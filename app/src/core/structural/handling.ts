/**
 * Manuseio de estacas pré-moldadas (ABNT NBR 16258:2014, 6.2.1.1, 6.2.1.4, 6.2.1.5 e 8.2–8.3): momentos mínimos de içamento por
 * um ponto (a = 0,29·L: M = 0,05·q·L²·α) e por dois pontos (a = 0,21·L: M = 0,02·q·L²·α), com normal nula e α ≥ 1,3 (ampliação
 * dinâmica); comparação com o momento resistente da seção circular armada e verificação da armadura transversal (CA-60):
 * ≥ 1,38 cm²/m em todo o comprimento e ≥ 2,76 cm²/m nos 50 cm das extremidades.
 *
 * O texto chama os valores de "momento mínimo de cálculo" (Mk,min); por isso o coeficiente adicional γf é editável (padrão 1,0).
 */
import { interactionCurve, momentCapacityFromCurve, type Materials } from './section'

export interface HandlingInput {
  /** Diâmetro (m) e comprimento (m) da estaca; peso específico do concreto (kN/m³, padrão 25). */
  D: number
  L: number
  gammaConc?: number
  /** Coeficiente de ampliação dinâmica α (mínimo 1,3). */
  alpha?: number
  /** Coeficiente adicional sobre Mk,min (padrão 1,0). */
  gammaF?: number
  /** Armadura longitudinal: número de barras, diâmetro (mm) e raio do círculo das barras (m). */
  n: number
  phiMm: number
  Rs: number
  /** fck (MPa) na desmoldagem (içamento por 2 pontos) e final (içamento por 1 ponto). */
  fckDemold: number
  fckFinal: number
  fyk?: number
  gammaS?: number
  gammaC?: number
  /** Estribos: diâmetro (mm), passo no trecho corrente e nas extremidades (cm); 2 ramos, CA-60. */
  stirrup?: { phiMm: number; spacingCm: number; endSpacingCm: number }
}

export interface HandlingCase {
  name: string
  /** Distâncias (m) dos pontos de içamento/apoio a partir do topo. */
  points: number[]
  /** Momento (kN·m): fórmula da norma, estática exata e valor adotado (maior dos dois × α × γf). */
  Mnorm: number
  Mexact: number
  Md: number
  MRd: number
  fck: number
  util: number
  ok: boolean
}

export interface HandlingResult {
  q: number
  cases: HandlingCase[]
  transverse?: { AswCorrente: number; AswExtremidade: number; minCorrente: number; minExtremidade: number; okCorrente: boolean; okExtremidade: boolean }
  notes: string[]
}

/** Maior |M| (kN·m) de viga biapoiada com balanços sob carga q (kN/m), apoios em xA e xB (m) de uma barra de comprimento L. */
export function maxMomentTwoSupports(L: number, xA: number, xB: number, q: number): number {
  const span = xB - xA
  // reações por momentos em torno de A: R_B·span = q·[L²/2 − xA·L]... (equilíbrio de q·L aplicada no meio)
  const RB = (q * L * (L / 2 - xA)) / span
  const RA = q * L - RB
  const M = (x: number) => {
    let m = (-q * x * x) / 2
    if (x > xA) m += RA * (x - xA)
    if (x > xB) m += RB * (x - xB)
    return m
  }
  let best = 0
  const N = 2000
  for (let i = 0; i <= N; i++) best = Math.max(best, Math.abs(M((L * i) / N)))
  return best
}

export function handlingCheck(inp: HandlingInput): HandlingResult {
  const alpha = Math.max(inp.alpha ?? 1.3, 1.3)
  const gammaF = inp.gammaF ?? 1
  const q = ((inp.gammaConc ?? 25) * Math.PI * inp.D ** 2) / 4
  const sec = { D: inp.D, n: inp.n, phi: inp.phiMm / 1000, Rs: inp.Rs }
  const mat = (fck: number): Materials => ({ fck, gammaC: inp.gammaC ?? 1.4, fyk: inp.fyk ?? 500, gammaS: inp.gammaS ?? 1.15 })
  const make = (name: string, points: number[], kNorm: number, fck: number): HandlingCase => {
    const Mnorm = kNorm * q * inp.L ** 2 * alpha
    const Mexact = maxMomentTwoSupports(inp.L, points[0], points[1], q) * alpha
    const Md = Math.max(Mnorm, Mexact) * gammaF
    const MRd = momentCapacityFromCurve(interactionCurve(sec, mat(fck), 40), 0)
    return { name, points, Mnorm, Mexact, Md, MRd, fck, util: MRd > 0 ? Md / MRd : Infinity, ok: MRd > 0 && Md <= MRd }
  }
  const cases = [
    make('Içamento por 1 ponto a 0,29·L (extremidade oposta apoiada no solo) — resistência final', [0, 0.71 * inp.L], 0.05, inp.fckFinal),
    make('Içamento/apoio por 2 pontos a 0,21·L das extremidades — resistência na desmoldagem', [0.21 * inp.L, 0.79 * inp.L], 0.02, inp.fckDemold),
  ]
  let transverse: HandlingResult['transverse']
  if (inp.stirrup) {
    const a1 = (Math.PI * (inp.stirrup.phiMm / 10) ** 2) / 4 // cm²
    const asw = (s: number) => (2 * a1 * 100) / s // cm²/m, 2 ramos
    transverse = {
      AswCorrente: asw(inp.stirrup.spacingCm), AswExtremidade: asw(inp.stirrup.endSpacingCm), minCorrente: 1.38, minExtremidade: 2.76,
      okCorrente: asw(inp.stirrup.spacingCm) >= 1.38 - 1e-9, okExtremidade: asw(inp.stirrup.endSpacingCm) >= 2.76 - 1e-9,
    }
  }
  const notes = [
    'NBR 16258:2014, 6.2.1.1: normal nula no manuseio; momento mínimo de cálculo Mk,min,1 = 0,05·q·L²·α (1 ponto) e Mk,min,2 = 0,02·q·L²·α (2 pontos), α ≥ 1,3.',
    'Adotado o maior entre a fórmula da norma e a estática exata da viga sobre os apoios de içamento (posições da Tab. 3 e da Fig. 11).',
    'Armadura transversal obrigatória em todo o comprimento, CA-60: ≥ 1,38 cm²/m (2 ramos) e ≥ 2,76 cm²/m nos 50 cm de cada extremidade; cobrimento mínimo de 2,0 cm nos estribos estruturais (6.2.1.4 e 6.2.1.5).',
    'Cravação (6.2.1.3): tensão de compressão ≤ 85 % da resistência do concreto e tração na armadura ≤ 70 % de fyk — verificar com o sistema de cravação.',
  ]
  return { q, cases, transverse, notes }
}

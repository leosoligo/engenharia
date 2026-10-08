/**
 * Ancoragem das barras de arranque do pilar no bloco (verificação opcional).
 * Mesma formulação da ancoragem da estaca no bloco (NBR 6118, 9.4.2): lb = (φ/4)·fyd/fbd, fbd = η1·η2·η3·fctd,
 * η1 = 2,25 (barra nervurada), η2 = 1,0 (boa aderência, barra vertical), η3 = 1,0 (φ < 32 mm) ou (132 − φ)/100;
 * lb,nec = α1·lb ≥ lb,min = máx[0,3·lb; 10φ; 100 mm]; α1 = 0,7 com gancho (cobrimento ≥ 3φ), senão 1,0.
 * O texto do item 22.7.4.1.4 da NBR 6118:2026 não foi consultado: a altura mínima é lb,nec + cobrimento inferior + 2 camadas
 * de armadura do bloco (estimativa de 2 × 1,6 cm), a confirmar pelo projetista.
 */
import { coverBlock } from './block'

export interface PillarBars {
  /** Bitola das barras de arranque (mm). */
  phiMm: number
  /** Gancho na extremidade inferior (α1 = 0,7). */
  hook?: boolean
  /** fyk (MPa); padrão 500. */
  fyk?: number
}

export interface PillarAnchorage {
  lb: number
  lbNec: number
  /** Altura mínima do bloco (m) para ancorar a armadura. */
  hMin: number
  text: string
}

export function pillarAnchorage(bars: PillarBars, fckBlock: number, caa: 1 | 2 | 3 | 4, gammaC = 1.4, gammaS = 1.15): PillarAnchorage {
  const phi = bars.phiMm / 1000
  const fctd = (0.7 * 0.3 * fckBlock ** (2 / 3) * 1000) / gammaC // kPa
  const fyd = ((bars.fyk ?? 500) * 1000) / gammaS
  const eta3 = bars.phiMm < 32 ? 1 : (132 - bars.phiMm) / 100
  const fbd = 2.25 * 1 * eta3 * fctd
  const lb = (phi / 4) * (fyd / fbd)
  const lbMin = Math.max(0.3 * lb, 10 * phi, 0.1)
  const lbNec = Math.max((bars.hook ? 0.7 : 1) * lb, lbMin)
  const hMin = lbNec + coverBlock(caa) + 2 * 0.016
  return { lb, lbNec, hMin, text: `Arranque Ø${bars.phiMm}${bars.hook ? ' com gancho' : ''}: lb = ${(lb * 100).toFixed(0)} cm, lb,nec = ${(lbNec * 100).toFixed(0)} cm, h mínima do bloco = ${(hMin * 100).toFixed(0)} cm` }
}

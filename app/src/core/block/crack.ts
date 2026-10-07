/**
 * Abertura característica de fissuras dos tirantes do bloco no ELS (NBR 6118:2026, 17.3.3.2): menor entre
 *   w1 = φ/(12,5·η1) · σs/Es · 3σs/fctm   e   w2 = φ/(12,5·η1) · σs/Es · (4/ρri + 45),
 * com a tensão σs da barra tracionada (estádio II de tração axial: concreto desprezado) e Acri = retângulo a até 7,5φ do eixo da barra.
 * Limites (Tabela 13.4, combinação frequente): CAA I 0,4 mm; CAA II e III 0,3 mm; CAA IV 0,2 mm.
 */

export const CRACK_LIMIT_MM: Record<1 | 2 | 3 | 4, number> = { 1: 0.4, 2: 0.3, 3: 0.3, 4: 0.2 }

export interface CrackInput {
  /** Diâmetro da barra (mm) e número de barras do tirante. */
  phiMm: number
  nBars: number
  /** Largura da faixa (m) em que as barras se distribuem e distância (m) do eixo da barra à face inferior do bloco. */
  strip: number
  bottom: number
  /** Tensão na armadura no ELS (MPa). */
  sigma: number
  fck: number
  /** Coeficiente de conformação superficial (2,25 para CA-50). */
  eta1?: number
}

export interface CrackResult { wk: number; rho: number; Acr: number }

/** wk em mm. */
export function crackWidth(c: CrackInput): CrackResult {
  const phi = c.phiMm / 1000
  const eta1 = c.eta1 ?? 2.25
  const Es = 210_000 // MPa
  const fctm = 0.3 * c.fck ** (2 / 3)
  const w = Math.min(c.strip / c.nBars, 15 * phi)
  const Acr = w * (c.bottom + 7.5 * phi)
  const rho = (Math.PI * phi ** 2) / 4 / Acr
  const k = (c.phiMm / (12.5 * eta1)) * (c.sigma / Es)
  const w1 = k * ((3 * c.sigma) / fctm)
  const w2 = k * (4 / rho + 45)
  return { wk: Math.min(w1, w2), rho, Acr }
}

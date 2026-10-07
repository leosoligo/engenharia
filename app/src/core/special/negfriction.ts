/**
 * Atrito negativo (NBR 6122:2022, 5.8 e 8.4.3; Velloso & Lopes, cap. 18.1): τn = β·σ'v (Long e Healy, 1974) com o ponto neutro
 * na base da camada que recalca (método simples). Desconsidera o alívio de tensões junto à estaca e o efeito de grupo (a favor da segurança).
 */

export type NegSoil = 'argila' | 'silte' | 'areia'
/** β sugerido por Long e Healy (1974) (Velloso & Lopes, §18.1.2): faixa; por padrão adota-se o limite superior (conservador). */
export const NEG_BETA: Record<NegSoil, { min: number; max: number }> = {
  argila: { min: 0.2, max: 0.25 },
  silte: { min: 0.25, max: 0.35 },
  areia: { min: 0.35, max: 0.5 },
}

export interface NegFrictionInput {
  /** Profundidade (m do terreno) do ponto neutro: base da camada que recalca. */
  zNeutral: number
  beta: number
  /** Peso específico do solo (kN/m³), suposto uniforme acima do ponto neutro. */
  gamma: number
  /** Sobrecarga na superfície, p.ex. aterro (kPa). */
  surcharge: number
  /** Profundidade do nível d'água (m); sem valor: sem subpressão. */
  waterLevel?: number
}

const GAMMA_W = 9.81

/** ∫ σ'v dz entre a e b (kN/m), σ'v = q + γ·z acima do NA e com γ' abaixo. */
export function integralSigmaV(nf: NegFrictionInput, a: number, b: number): number {
  if (b <= a) return 0
  const zw = nf.waterLevel !== undefined ? Math.max(nf.waterLevel, 0) : Infinity
  const sig = (z: number) => (z <= zw ? nf.surcharge + nf.gamma * z : nf.surcharge + nf.gamma * zw + (nf.gamma - GAMMA_W) * (z - zw))
  // σ'v é linear por trechos: trapézios exatos em cada trecho
  const seg = (lo: number, hi: number) => (hi > lo ? ((sig(lo) + sig(hi)) / 2) * (hi - lo) : 0)
  if (zw >= b || zw <= a) return seg(a, b)
  return seg(a, zw) + seg(zw, b)
}

/** Carga de atrito negativo (kN) numa estaca de diâmetro D: da base do bloco (topDepth) até o ponto neutro ou a ponta (m do terreno). */
export function negativeFriction(D: number, topDepth: number, tipDepth: number, nf: NegFrictionInput): number {
  const zEnd = Math.min(nf.zNeutral, tipDepth)
  return nf.beta * Math.PI * D * integralSigmaV(nf, topDepth, zEnd)
}

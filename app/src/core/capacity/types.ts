import type { CircularPile } from '../pile'
import type { CapacityParams } from './params'

export type CapacityMethod = 'aoki-velloso' | 'decourt-quaresma' | 'teixeira'

export interface CapacityInput {
  pile: CircularPile
  /** Fator multiplicador da resistência de ponta (% da resistência de ponta). Padrão 1. */
  tipFactor?: number
  /** Fator multiplicador da resistência lateral. Padrão 1. */
  shaftFactor?: number
  /** Parâmetros de cálculo editados pelo usuário (sobrescrevem os padrões). */
  params?: CapacityParams
}

/** Resultado para uma profundidade de ponta (m) — um por metro. */
export interface CapacityRow {
  /** Profundidade da ponta (m) = comprimento embutido. */
  depth: number
  /** Resistência de ponta (kN). */
  Rp: number
  /** Resistência lateral acumulada (kN). */
  Rl: number
  /** Resistência total (kN). */
  R: number
}

export interface CapacityResult {
  method: CapacityMethod
  rows: CapacityRow[]
  /** Avisos de procedência/validade (valores adaptados, N fora do domínio do método…). */
  warnings: string[]
}

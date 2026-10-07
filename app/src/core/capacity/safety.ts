/**
 * Segurança geotécnica de estacas por método semiempírico — ABNT NBR 6122:2022, item 6.2.1.2.1
 * (conferido visualmente na página 18 da norma).
 *
 *   Rk = mín[ (Rse)méd / ξ1 ; (Rse)mín / ξ2 ]          ξ1, ξ2 da Tabela 2 (n = nº de perfis de ensaio)
 *   Padm = Rk / FSg, FSg = 1,4                          (valores admissíveis)
 *   Rd   = Rk / γm,  γm  = 1,0                          (valores de cálculo)
 * Texto da norma: "o fator de segurança global a ser utilizado para determinação da carga admissível é 2,0".
 *
 * Modo 'conservador' (padrão do Estakalc, por decisão do usuário): adota o menor entre
 * Rk/1,4 (NBR, com ξ) e R_méd/FS global informado (padrão 2,0). O usuário pode escolher outro modo.
 */

/** Tabela 2 da NBR 6122:2022: colunas n = 1…6 e n ≥ 10. */
const XI1: Record<number, number> = { 1: 1.42, 2: 1.35, 3: 1.33, 4: 1.31, 5: 1.29, 6: 1.27, 10: 1.27 }
const XI2: Record<number, number> = { 1: 1.42, 2: 1.27, 3: 1.23, 4: 1.2, 5: 1.15, 6: 1.13, 10: 1.11 }

/** A Tabela 2 não fornece ξ para n = 7, 8 ou 9: não se interpola, lança erro. */
export function xiFactors(n: number, complementaryTests = false): { xi1: number; xi2: number } {
  if (!Number.isInteger(n) || n < 1) throw new Error('n deve ser inteiro ≥ 1')
  if (n >= 7 && n <= 9) throw new Error('NBR 6122:2022, Tab. 2, não fornece ξ para n = 7, 8 ou 9 perfis')
  const key = n >= 10 ? 10 : n
  const k = complementaryTests ? 0.9 : 1
  return { xi1: XI1[key] * k, xi2: XI2[key] * k }
}

export type SafetyMode = 'conservador' | 'nbr-admissivel' | 'global'

export interface SafetyOptions {
  mode?: SafetyMode
  /** FS global usado nos modos 'global' e 'conservador'. Padrão 2,0 (NBR 6122:2022, 6.2.1.2.1). */
  fsGlobal?: number
  /** FS aplicado a Rk no modo 'nbr-admissivel'. Padrão 1,4. */
  fsRk?: number
  /** Ensaios complementares à sondagem a percussão (multiplica ξ por 0,9). */
  complementaryTests?: boolean
}

/**
 * Carga admissível para uma profundidade de ponta, dados os valores de resistência total de cada furo
 * (kN, um por perfil de ensaio da região representativa).
 */
export function admissibleLoad(resistances: number[], opt: SafetyOptions = {}): { Rk: number; Padm: number } {
  const n = resistances.length
  if (n === 0) throw new Error('Sem resistências')
  const mode = opt.mode ?? 'conservador'
  const fsGlobal = opt.fsGlobal ?? 2.0
  const fsRk = opt.fsRk ?? 1.4
  const med = resistances.reduce((a, b) => a + b, 0) / n
  const min = Math.min(...resistances)
  const { xi1, xi2 } = xiFactors(n, opt.complementaryTests)
  const Rk = Math.min(med / xi1, min / xi2)
  const byNbr = Rk / fsRk
  const byGlobal = med / fsGlobal
  const Padm = mode === 'nbr-admissivel' ? byNbr : mode === 'global' ? byGlobal : Math.min(byNbr, byGlobal)
  return { Rk, Padm }
}

/** Unidades de força e momento exibidas (o cálculo é sempre em kN e kN·m). */
export const TF_IN_KN = 9.80665

export interface Units {
  /** 'kN' ou 'tf' e 'kN·m' ou 'tf·m'. */
  F: string
  M: string
  /** Fator de kN (ou kN·m) para a unidade exibida. */
  k: number
}

export const unitsOf = (u?: 'kN' | 'tf'): Units => (u === 'tf' ? { F: 'tf', M: 'tf·m', k: 1 / TF_IN_KN } : { F: 'kN', M: 'kN·m', k: 1 })
export const KN: Units = unitsOf('kN')

/**
 * Converte, em um texto gerado pelo cálculo (sempre em kN), os valores "N kN" e "N kN·m" para as unidades escolhidas pelo usuário.
 * Números no formato pt-BR (vírgula decimal). Não toca em "kN/m", "kN/m²" nem em "kN/m³".
 */
export function unitText(text: string, u: Units): string {
  if (u.k === 1) return text
  return text.replace(/(\d+(?:,\d+)?)(\s*)(kN·m|kN)(?![\w/·²³])/g, (_, num: string, sp: string, un: string) => {
    const v = parseFloat(num.replace(',', '.')) * u.k
    const d = Math.abs(v) < 10 ? 2 : 1
    return `${v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false })}${sp}${un === 'kN' ? u.F : u.M}`
  })
}

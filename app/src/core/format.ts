/** Número com vírgula decimal (pt-BR), sem separador de milhar, para mensagens e textos. */
export function fx(x: number, digits = 0): string {
  return Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }) : '—'
}

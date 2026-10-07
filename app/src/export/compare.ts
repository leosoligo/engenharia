/** Comparativo lado a lado entre soluções candidatas, com exportação em CSV (abre no Excel). */
import type { Candidate } from '../core/optimize'
import { PILE_LABEL } from '../core/pile'

export interface CompareTable {
  /** Cabeçalhos das colunas (uma por solução). */
  columns: string[]
  /** Linhas: rótulo, valores já formatados e, quando faz sentido, o índice da melhor coluna (menor valor numérico). */
  rows: { label: string; values: string[]; best?: number; group?: string }[]
}

const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')

export function compareTable(cands: Candidate[], u: { F: string; k: number } = { F: 'kN', k: 1 }): CompareTable {
  const minIdx = (v: number[]) => {
    if (v.length < 2 || v.some((x) => !Number.isFinite(x))) return undefined
    const m = Math.min(...v)
    return v.every((x) => x === m) ? undefined : v.indexOf(m)
  }
  const num = (label: string, group: string, vals: number[], d: number, best = true): CompareTable['rows'][number] => ({
    label, group, values: vals.map((x) => f(x, d)), best: best ? minIdx(vals) : undefined,
  })
  const txt = (label: string, group: string, vals: string[]): CompareTable['rows'][number] => ({ label, group, values: vals })
  const blk = (c: Candidate) => c.blockDesign.geometry
  const util = (c: Candidate) => Math.max(...c.blockDesign.checks.map((k) => k.value / k.limit)) * 100
  const rows: CompareTable['rows'] = [
    txt('Estaca', 'Solução', cands.map((c) => `${PILE_LABEL[c.type]} Ø${f(c.diameter * 100)} cm`)),
    num('Número de estacas', 'Solução', cands.map((c) => c.layout.n), 0, false),
    num('Comprimento (m)', 'Solução', cands.map((c) => c.length), 0),
    txt('Arranjo', 'Solução', cands.map((c) => c.layout.label)),
    txt('Armadura longitudinal', 'Solução', cands.map((c) => `${c.design.longitudinal!.n}Ø${f(c.design.longitudinal!.phiMm, 1)}`)),
    txt('Bloco (cm)', 'Bloco', cands.map((c) => `${f(blk(c).lx * 100)} × ${f(blk(c).ly * 100)} × ${f(blk(c).h * 100)}`)),
    num('Concreto do bloco (m³)', 'Bloco', cands.map((c) => c.blockDesign.quantities.concreteM3), 2),
    num('Forma do bloco (m²)', 'Bloco', cands.map((c) => c.blockDesign.quantities.formM2), 1),
    num('Aço do bloco (kg)', 'Bloco', cands.map((c) => c.blockDesign.quantities.steelKg), 0),
    num('Utilização da pior biela (%)', 'Bloco', cands.map(util), 0),
    num('Concreto das estacas (m³)', 'Quantitativos', cands.map((c) => c.quantities.pileConcreteM3), 2),
    num('Aço das estacas (kg)', 'Quantitativos', cands.map((c) => c.design.weights!.totalKg * c.layout.n), 0),
    num('Metros de estaca (m)', 'Quantitativos', cands.map((c) => c.quantities.totalPileLength), 0),
    num(`Compressão máx. por estaca ELS (${u.F})`, 'Verificações', cands.map((c) => c.service.maxCompression * u.k), 0, false),
    num(`Carga admissível (${u.F})`, 'Verificações', cands.map((c) => c.service.padm * u.k), 0, false),
    num('Deslocamento no topo ELS (mm)', 'Verificações', cands.map((c) => c.service.maxHeadDisplacement * 1000), 1),
    num('Flexo-compressão da estaca (%)', 'Verificações', cands.map((c) => c.design.longitudinal!.utilization * 100), 0),
    num('Recalque estimado do grupo (mm)', 'Verificações', cands.map((c) => (c.special?.settlement ? c.special.settlement.total * 1000 : NaN)), 1),
    num(`Atrito negativo Qn (${u.F})`, 'Verificações', cands.map((c) => (c.special?.negFriction ? c.special.negFriction.Qn * u.k : NaN)), 0, false),
    num('Custo do concreto (R$)', 'Custos', cands.map((c) => c.cost.concrete), 0),
    num('Custo do aço (R$)', 'Custos', cands.map((c) => c.cost.steel), 0),
    num('Custo de execução (R$)', 'Custos', cands.map((c) => c.cost.execution), 0),
    num('Mobilização e arrasamento (R$)', 'Custos', cands.map((c) => c.cost.mobilization + c.cost.cutOff), 0),
    num('Bloco (R$)', 'Custos', cands.map((c) => c.cost.block), 0),
    num('Extras (R$)', 'Custos', cands.map((c) => c.cost.extras), 0),
    num('Custo total (R$)', 'Custos', cands.map((c) => c.cost.total), 0),
  ]
  return { columns: cands.map((_, i) => `${i + 1}ª solução`), rows }
}

/** CSV com separador ";" e BOM UTF-8, como o Excel em português espera. */
export function compareCsv(t: CompareTable, title = ''): string {
  const q = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines: string[] = []
  if (title) lines.push(q(title))
  lines.push(['Item', ...t.columns].map(q).join(';'))
  for (const r of t.rows) lines.push([r.label, ...r.values].map(q).join(';'))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

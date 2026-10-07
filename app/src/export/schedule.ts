/**
 * Tabela de ferros (lista de armaduras) da solução: estacas e bloco. Compartilhada pelo DXF e pelo memorial.
 * Os comprimentos e pesos seguem as mesmas fórmulas dos quantitativos do dimensionamento (core/structural e core/block),
 * logo a soma bate com os totais exibidos nos quadros de quantitativo.
 */
import type { Candidate } from '../core/optimize'

const STEEL = 7850 // kg/m³
const area = (phiMm: number) => (Math.PI * (phiMm / 1000) ** 2) / 4 // m²

export interface BarRow {
  pos: string
  element: 'Estaca' | 'Bloco'
  description: string
  phiMm: number
  /** Quantidade total na fundação (todas as estacas). */
  qty: number
  /** Comprimento de cada barra/estribo (m); para a helicoidal, o comprimento total da hélice. */
  unitLen: number
  totalLen: number
  kg: number
  note?: string
}

export interface BarSummary { phiMm: number; steel: 'CA-50' | 'CA-60'; lengthM: number; kg: number }

export interface Schedule {
  rows: BarRow[]
  /** Itens do bloco sem quantidade/comprimento tabelados (pele, superior, estribos): só massa. */
  extras: { description: string; kg: number }[]
  summary: BarSummary[]
  totalKg: number
}

export function barSchedule(c: Candidate): Schedule {
  const rows: BarRow[] = []
  const np = c.layout.n
  const l = c.design.longitudinal!
  const t = c.design.transverse!
  const D = c.diameter
  const cage = c.design.cageLength!
  const cover = c.design.cover
  const anchor = c.design.anchorage ?? 0

  // ---- estacas
  rows.push({
    pos: 'N1', element: 'Estaca', description: `Barra longitudinal (${l.n} por estaca)`, phiMm: l.phiMm, qty: l.n * np,
    unitLen: cage + anchor, totalLen: l.n * np * (cage + anchor), kg: STEEL * area(l.phiMm) * l.n * np * (cage + anchor),
    note: anchor > 0 ? `gaiola ${cage.toFixed(2)} m + ${(anchor * 100).toFixed(0)} cm de ancoragem no bloco (l_b,nec = ${(c.design.lbNec! * 100).toFixed(0)} cm)` : `reta, comprimento da gaiola; sem ancoragem no bloco (l_b,nec = ${(c.design.lbNec! * 100).toFixed(0)} cm)`,
  })
  const Rc = D / 2 - cover - t.phiMm / 2000
  const hook = 2 * Math.max((5 * t.phiMm) / 1000, 0.05)
  if (t.type === 'estribo') {
    let count = 0
    t.zones.forEach((z, k) => { count += Math.ceil((z.to - z.from) / z.spacing) + (k === 0 ? 1 : 0) })
    const unit = 2 * Math.PI * Rc + hook
    rows.push({
      pos: 'N2', element: 'Estaca', description: `Estribo circular fechado (${count} por estaca; ${t.zones.map((z) => `c/${(z.spacing * 100).toFixed(1)} cm de ${z.from.toFixed(1)} a ${z.to.toFixed(1)} m`).join('; ')})`,
      phiMm: t.phiMm, qty: count * np, unitLen: unit, totalLen: count * np * unit, kg: STEEL * area(t.phiMm) * count * np * unit,
      note: 'diâmetro de dobra ≈ 2·(D/2 − cobrimento − φt/2); pontas retas de máx[5φt; 5 cm]',
    })
  } else {
    let len = 0
    for (const z of t.zones) len += ((z.to - z.from) / z.spacing) * Math.hypot(2 * Math.PI * Rc, z.spacing)
    len += 4 * 2 * Math.PI * Rc
    rows.push({
      pos: 'N2', element: 'Estaca', description: `Armadura helicoidal (1 por estaca; ${t.zones.map((z) => `passo ${(z.spacing * 100).toFixed(1)} cm de ${z.from.toFixed(1)} a ${z.to.toFixed(1)} m`).join('; ')})`,
      phiMm: t.phiMm, qty: np, unitLen: len, totalLen: len * np, kg: STEEL * area(t.phiMm) * len * np,
      note: 'comprimento desenvolvido da hélice, incluindo 2 voltas de fechamento em cada ponta',
    })
  }

  // ---- bloco
  c.blockDesign.bars.forEach((b, i) => {
    rows.push({
      pos: `N${3 + i}`, element: 'Bloco', description: b.label, phiMm: b.phiMm, qty: b.n, unitLen: b.length, totalLen: b.n * b.length,
      kg: STEEL * (b.AsEff / 1e4) * b.length, note: 'comprimento face a face com ganchos',
    })
  })
  // armaduras complementares do bloco (pele, superior, estribos): entram na tabela com quantidade e comprimento
  const names = { pele: 'Armadura de pele (as duas faces)', superior: 'Armadura superior construtiva', estribos: 'Estribos verticais fechados' } as const
  const notes = { pele: 'barras retas, uma linha de cada lado, entre os estribos', superior: 'barras retas no topo', estribos: 'gancho a 135 graus; comprimento inclui ganchos' } as const
  let pos = 3 + c.blockDesign.bars.length
  const extras: { description: string; kg: number }[] = []
  for (const x of c.blockDesign.secondary) {
    if (x.kind && x.phiMm && x.qty && x.unitLen) {
      rows.push({
        pos: `N${pos++}`, element: 'Bloco', description: `${names[x.kind]}${x.spacing ? ` - s = ${(x.spacing * 100).toFixed(0)} cm` : ''}`, phiMm: x.phiMm, qty: x.qty,
        unitLen: x.unitLen, totalLen: x.qty * x.unitLen, kg: x.kg, note: notes[x.kind],
      })
    } else extras.push({ description: x.description, kg: x.kg })
  }

  // ---- resumo por bitola
  const map = new Map<number, BarSummary>()
  for (const r of rows) {
    const cur = map.get(r.phiMm) ?? { phiMm: r.phiMm, steel: r.phiMm === 5 ? ('CA-60' as const) : ('CA-50' as const), lengthM: 0, kg: 0 }
    cur.lengthM += r.totalLen
    cur.kg += r.kg
    map.set(r.phiMm, cur)
  }
  const summary = [...map.values()].sort((a, b) => a.phiMm - b.phiMm)
  const totalKg = rows.reduce((a, r) => a + r.kg, 0) + extras.reduce((a, x) => a + x.kg, 0)
  return { rows, extras, summary, totalKg }
}

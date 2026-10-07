/**
 * União de dois pilares num único bloco de coroamento. As cargas dos dois pilares são transportadas para o centro da caixa envolvente
 * dos dois (origem do bloco), somando forças e momentos e acrescentando os momentos das excentricidades:
 *   Mx = ΣMx_i − Σ y_i·Fz_i,   My = ΣMy_i + Σ x_i·Fz_i,   Mz = ΣMz_i + Σ (x_i·Fy_i − y_i·Fx_i)
 * (convenção vetorial do programa: Fz > 0 compressão; Mx > 0 comprime o lado de y menor; My > 0 comprime o lado de x maior).
 * O bloco é tratado como um pilar equivalente: caixa envolvente para a geometria e área total (soma das áreas) para as tensões.
 */
import type { LoadCombination } from './loads'

export interface JoinPillar {
  /** Nome do pilar, coordenadas globais do centro (m) e seção (cm): ax em X, ay em Y. */
  name: string
  x: number
  y: number
  ax: number
  ay: number
}

export interface JoinResult {
  combos: LoadCombination[]
  /** Caixa envolvente (cm) e área total dos pilares (cm²). */
  ax: number
  ay: number
  areaCm2: number
  /** Centro da caixa envolvente em coordenadas globais (m), origem do bloco. */
  origin: { x: number; y: number }
  /** Posição de cada pilar em relação à origem (m). */
  offsets: { name: string; dx: number; dy: number }[]
  warnings: string[]
}

export function joinPillars(name: string, a: JoinPillar, b: JoinPillar, combos: LoadCombination[]): JoinResult {
  const warnings: string[] = []
  const box = (p: JoinPillar) => ({ x0: p.x - p.ax / 200, x1: p.x + p.ax / 200, y0: p.y - p.ay / 200, y1: p.y + p.ay / 200 })
  const A = box(a), B = box(b)
  const x0 = Math.min(A.x0, B.x0), x1 = Math.max(A.x1, B.x1), y0 = Math.min(A.y0, B.y0), y1 = Math.max(A.y1, B.y1)
  const origin = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
  const offs = [a, b].map((p) => ({ name: p.name, dx: p.x - origin.x, dy: p.y - origin.y }))
  const overlap = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) > 1e-9 && Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) > 1e-9
  if (overlap) warnings.push('Os pilares se sobrepõem em planta: confira as coordenadas.')
  const ca = combos.filter((c) => c.pillar === a.name)
  const cb = combos.filter((c) => c.pillar === b.name)
  const out: LoadCombination[] = []
  const missing: string[] = []
  for (const c1 of ca) {
    const c2 = cb.find((c) => c.name === c1.name && c.state === c1.state)
    if (!c2) { missing.push(c1.name); continue }
    const parts = [{ c: c1, o: offs[0] }, { c: c2, o: offs[1] }]
    const sum = (f: (c: LoadCombination, o: { dx: number; dy: number }) => number) => parts.reduce((s, p) => s + f(p.c, p.o), 0)
    out.push({
      pillar: name, name: c1.name, state: c1.state,
      fx: sum((c) => c.fx), fy: sum((c) => c.fy), fz: sum((c) => c.fz),
      mx: sum((c, o) => c.mx - o.dy * c.fz),
      my: sum((c, o) => c.my + o.dx * c.fz),
      mz: sum((c, o) => c.mz + o.dx * c.fy - o.dy * c.fx),
    })
  }
  for (const c2 of cb) if (!ca.some((c) => c.name === c2.name && c.state === c2.state)) missing.push(c2.name)
  if (missing.length) warnings.push(`Combinações sem correspondente no outro pilar (mesmo nome e tipo) ficaram de fora: ${[...new Set(missing)].join(', ')}.`)
  if (out.length === 0) warnings.push('Nenhuma combinação em comum entre os dois pilares (mesmo nome e tipo ELS/ELU).')
  return {
    combos: out,
    ax: Math.round((x1 - x0) * 1000) / 10,
    ay: Math.round((y1 - y0) * 1000) / 10,
    areaCm2: a.ax * a.ay + b.ax * b.ay,
    origin, offsets: offs, warnings,
  }
}

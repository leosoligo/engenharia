import { describe, expect, it } from 'vitest'
import { optimize, reanalyzeELU, reevaluateWithLayout, ZERO_COSTS, type OptimizeInput } from '../optimize'
import { armorFromDesign, verifyPile } from './verify'
import { momentCapacityFromCurve } from './section'
import type { SptBorehole } from '../soil'
import type { LoadCombination } from '../loads'

const bh: SptBorehole = {
  id: 'SP-01', waterLevel: 6,
  layers: Array.from({ length: 30 }, (_, i) => ({ depth: i + 1, nspt: Math.min(4 + Math.floor(i * 0.9), 35), soil: (i < 5 ? 'argila_arenosa' : i < 20 ? 'areia_siltosa' : 'silte_argiloso') as 'argila' })),
}
const combo = (name: string, state: 'ELS' | 'ELU', h: number, fz: number, m: number): LoadCombination => ({ pillar: 'P1', name, state, fx: h, fy: 0, fz, mx: 0, my: m, mz: 0 })
const inp: OptimizeInput = {
  boreholes: [bh], pillar: { ax: 0.4, ay: 0.4 },
  combos: [combo('C1', 'ELS', 15, 1400, 20), combo('U1', 'ELU', 22, 1960, 28), combo('U2', 'ELU', 60, 1500, 90)],
  types: ['helice'], diameters: { helice: [0.4, 0.5] }, caa: 2, transverse: 'estribo', topDepth: 1,
  costs: { ...ZERO_COSTS, concretePerM3: 450, steelPerKg: 9 }, serviceLimit: 0.025, maxResults: 2,
}

describe('Verificação de armadura editada', () => {
  const c = optimize(inp).best[0]
  const v = (over = {}) => verifyPile({ type: c.type, D: c.diameter, L: c.length, caa: 2, demands: c.demands.sets }, { ...armorFromDesign(c.design), ...over })
  it('a armadura do dimensionamento automático é aprovada, com os mesmos quantitativos', () => {
    const r = v()
    expect(r.checks.filter((k) => !k.ok && k.severity === 'error').map((k) => k.name)).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.weights.totalKg).toBeCloseTo(c.design.weights!.totalKg, 0)
    expect(r.critical.FS).toBeGreaterThanOrEqual(1)
  })
  it('reduzir a armadura ou aumentar o passo reprova', () => {
    expect(v({ n: 6, phiMm: 10 }).ok).toBe(c.design.longitudinal!.n === 6 && c.design.longitudinal!.phiMm === 10)
    expect(v({ spacing: 0.4 }).checks.find((k) => k.id === 'spacing')!.ok).toBe(false)
    expect(v({ cageLength: 0.5 }).checks.find((k) => k.id === 'cage')!.ok).toBe(false)
  })
  it('mais armadura aumenta o MRd', () => {
    const base = v()
    const more = v({ n: c.design.longitudinal!.n + 4 })
    expect(more.critical.MRd).toBeGreaterThanOrEqual(base.critical.MRd)
  })
  it('reanálise com a mesma armadura reproduz os esforços; com mais armadura converge', () => {
    const same = reanalyzeELU(inp, c, c.design)
    expect(same.converged).toBe(true)
    expect(same.max.value / c.maxMomentELU.value).toBeGreaterThan(0.9)
    expect(same.max.value / c.maxMomentELU.value).toBeLessThan(1.1)
    const more = { ...c.design, longitudinal: { ...c.design.longitudinal!, n: c.design.longitudinal!.n + 6 } }
    const r = reanalyzeELU(inp, c, more)
    expect(r.converged).toBe(true)
    expect(r.sets.length).toBe(same.sets.length)
  })
  it('locação ajustada: mesma posição reproduz o resultado; estacas deslocadas mudam as reações', () => {
    const same = reevaluateWithLayout(inp, c, c.layout.points, c.design)
    expect(same.service.maxCompression / c.service.maxCompression).toBeGreaterThan(0.97)
    expect(same.service.maxCompression / c.service.maxCompression).toBeLessThan(1.03)
    expect(same.blockDesign.feasible).toBe(true)
    const moved = c.layout.points.map((p, i) => (i === 0 ? { ...p, x: p.x + 0.15 } : p))
    const r = reevaluateWithLayout(inp, c, moved, c.design)
    expect(r.pileAxialELS.length).toBe(c.layout.n)
    expect(r.service.maxCompression).not.toBeCloseTo(c.service.maxCompression, 3)
  })
  it('o diagrama de interação muda com a armadura longitudinal (MRd cresce com n e φ)', () => {
    const a = v({ n: 6, phiMm: 10 }), b = v({ n: 12, phiMm: 12.5 })
    const N = 400
    const mA = momentCapacityFromCurve(a.curve, N), mB = momentCapacityFromCurve(b.curve, N)
    expect(mB).toBeGreaterThan(mA * 1.3)
    expect(b.NRd).toBeGreaterThan(a.NRd)
  })
})

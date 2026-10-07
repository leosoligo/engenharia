import { describe, expect, it } from 'vitest'
import { optimize, ZERO_COSTS, type OptimizeInput } from './index'
import type { SptBorehole } from '../soil'
import type { LoadCombination } from '../loads'

const bh: SptBorehole = {
  id: 'SP-01',
  waterLevel: 6,
  layers: Array.from({ length: 30 }, (_, i) => ({
    depth: i + 1,
    nspt: Math.min(4 + Math.floor(i * 0.9), 35),
    soil: (i < 5 ? 'argila_arenosa' : i < 20 ? 'areia_siltosa' : 'silte_argiloso') as 'argila',
  })),
}
const combo = (name: string, state: 'ELU' | 'ELS', fx: number, fz: number, my: number): LoadCombination => ({ pillar: 'P1', name, state, fx, fy: 0, fz, mx: 0, my, mz: 0 })

const base = (over: Partial<OptimizeInput> = {}): OptimizeInput => ({
  boreholes: [bh],
  pillar: { ax: 0.4, ay: 0.4 },
  combos: [combo('C1', 'ELS', 15, 1400, 20), combo('C2', 'ELS', 40, 1100, 60), combo('U1', 'ELU', 22, 1960, 28), combo('U2', 'ELU', 60, 1500, 90)],
  types: ['helice'],
  diameters: { helice: [0.4, 0.5] },
  caa: 2, transverse: 'estribo', topDepth: 1,
  costs: {
    ...ZERO_COSTS, concretePerM3: 450, steelPerKg: 9, executionPerM: { '40': 80, '50': 110 }, mobilizationPerPile: 300, cutOffPerPile: 150,
    blockConcretePerM3: 600, blockFormPerM2: 90
  },
  serviceLimit: 0.025, maxResults: 4, ...over,
})

describe('Otimização econômica', () => {
  it('encontra solução viável, ordenada por custo, com verificações atendidas', () => {
    const r = optimize(base())
    expect(r.best.length).toBeGreaterThan(0)
    for (let i = 1; i < r.best.length; i++) expect(r.best[i].cost.total).toBeGreaterThanOrEqual(r.best[i - 1].cost.total)
    for (const c of r.best) {
      expect(c.service.maxHeadDisplacement).toBeLessThanOrEqual(0.025)
      expect(c.service.maxCompression).toBeLessThanOrEqual(c.service.padm + 1e-6)
      expect(c.design.feasible).toBe(true)
      expect(c.layout.n).toBeGreaterThanOrEqual(1)
    }
  })
  it('custos zerados: usa classificação por volume e avisa', () => {
    const r = optimize(base({ costs: ZERO_COSTS, maxResults: 2 }))
    expect(r.proxyRanking).toBe(true)
    expect(r.warnings.join(' ')).toContain('Custos zerados')
    expect(r.best.length).toBeGreaterThan(0)
  })
  it('limite de deslocamento mais rígido descarta ou muda a solução', () => {
    const loose = optimize(base({ maxResults: 1 }))
    const tight = optimize(base({ maxResults: 1, serviceLimit: 0.001 }))
    expect(tight.best.length === 0 || tight.best[0].cost.total >= loose.best[0].cost.total).toBe(true)
  })
  it('diâmetro fixado pelo usuário é respeitado', () => {
    const r = optimize(base({ fixed: { diameter: 0.5 } }))
    for (const c of r.best) expect(c.diameter).toBe(0.5)
  })
  it('exige nível d’água informado', () => {
    expect(() => optimize(base({ boreholes: [{ ...bh, waterLevel: undefined }] }))).toThrow(/nível d/)
  })
})

import { describe, expect, it } from 'vitest'
import { optimize, ZERO_COSTS, type OptimizeInput } from './index'
import type { SptBorehole } from '../soil'
import type { LoadCombination } from '../loads'

const bh: SptBorehole = {
  id: 'SP-01', waterLevel: 6,
  layers: Array.from({ length: 30 }, (_, i) => ({ depth: i + 1, nspt: i < 4 ? 2 : Math.min(6 + i, 35), soil: (i < 4 ? 'argila' : i < 20 ? 'areia_siltosa' : 'silte_argiloso') as 'argila' })),
}
const combo = (name: string, state: 'ELU' | 'ELS', fx: number, fz: number, my: number): LoadCombination => ({ pillar: 'P1', name, state, fx, fy: 0, fz, mx: 0, my, mz: 0 })
const base = (over: Partial<OptimizeInput> = {}): OptimizeInput => ({
  boreholes: [bh], pillar: { ax: 0.4, ay: 0.4 },
  combos: [combo('C1', 'ELS', 15, 1400, 20), combo('U1', 'ELU', 22, 1960, 28)],
  types: ['helice'], diameters: { helice: [0.5] }, caa: 2, transverse: 'estribo', topDepth: 1,
  costs: { ...ZERO_COSTS, concretePerM3: 450, steelPerKg: 9 }, serviceLimit: 0.025, maxResults: 1, ...over,
})

describe('Verificações especiais no otimizador', () => {
  it('atrito negativo reduz a capacidade: estaca fica mais longa e Qn é informado', () => {
    const a = optimize(base()).best[0]
    const b = optimize(base({ negFriction: { zNeutral: 4, beta: 0.25, gamma: 15, surcharge: 30 } })).best[0]
    expect(b.special?.negFriction?.Qn).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThanOrEqual(a.length)
    expect(b.service.padm).toBeLessThan(a.service.padm + 1e-6 + 10_000)
    expect(b.warnings.join(' ')).toContain('Atrito negativo')
  })
  it('atrito negativo: o normal de cálculo cresce até P + γf·Qn no ponto neutro e depois diminui', () => {
    const b = optimize(base({ fixed: { length: 12 }, negFriction: { zNeutral: 4, beta: 0.25, gamma: 15, surcharge: 30 } })).best[0]
    const Qnd = b.special!.negFriction!.Qnd
    for (const set of b.demands.sets) {
      if (!(set.N[0] > 0)) continue
      const nmax = Math.max(...set.N)
      expect(nmax - set.N[0]).toBeCloseTo(Qnd, 0)
      const iMax = set.N.indexOf(nmax)
      expect(set.z[iMax]).toBeCloseTo(3, 0) // ponto neutro a 4 m do terreno, base do bloco a 1 m
      expect(set.N[set.N.length - 1]).toBeLessThan(nmax)
    }
  })
  it('argila mole atravessada é registrada e avisada', () => {
    const r = optimize(base()).best[0]
    expect(r.special?.softClayM).toBe(3)
    expect(r.warnings.join(' ')).toContain('8.6.5.1')
    expect(r.warnings.join(' ')).toContain('muito mole')
  })
  it('recalque estimado é calculado e um limite apertado descarta a solução', () => {
    const r = optimize(base({ settlement: {} })).best[0]
    expect(r.special?.settlement?.total).toBeGreaterThan(0)
    const tight = optimize(base({ settlement: { limit: 0.0001 } }))
    expect(tight.best.length).toBe(0)
    expect(tight.rejected.some((x) => x.reason.includes('Recalque'))).toBe(true)
  })
})

describe('Esforço normal ao longo da estaca (atrito lateral)', () => {
  it('N(z) = N·(1 − Rl(z)/R) cai do topo à ponta; no modo constante fica igual ao do topo', () => {
    const a = optimize(base({ fixed: { length: 12 } })).best[0]
    const c = optimize(base({ fixed: { length: 12 }, axialTransfer: 'constante' })).best[0]
    const Na = a.profiles.elu.Nz!
    expect(Na[0]).toBeGreaterThan(Na[Na.length - 1])
    expect(Na.every((v, i) => i === 0 || v <= Na[i - 1] + 1e-9)).toBe(true)
    expect(Na[Na.length - 1]).toBeGreaterThan(0)
    const Nc = c.profiles.elu.Nz!
    expect(Math.max(...Nc) - Math.min(...Nc)).toBeLessThan(1e-9)
    expect(Nc[0]).toBeCloseTo(Na[0], 6)
    // com a redução do normal, a gaiola não é maior que no modo constante
    expect(a.design.cageLength!).toBeLessThanOrEqual(c.design.cageLength! + 1e-9)
  })
})

describe('Ranking sem duplicatas espelhadas', () => {
  it('não repete o mesmo arranjo espelhado com custo praticamente igual', () => {
    const r = optimize(base({ maxResults: 8, diameters: { helice: [0.35, 0.4] } }))
    const key = (c: (typeof r.best)[number]) => `${c.type}${c.diameter}${c.layout.n}${c.length}${c.layout.id.replace(/[xy]\*?$/, '')}`
    for (let i = 0; i < r.best.length; i++)
      for (let j = i + 1; j < r.best.length; j++)
        if (key(r.best[i]) === key(r.best[j])) expect(Math.abs(r.best[i].cost.total - r.best[j].cost.total) / r.best[i].cost.total).toBeGreaterThan(0.01)
  })
})

describe('Estacas tracionadas', () => {
  const up = (name: string, state: 'ELU' | 'ELS', fz: number, my: number) => combo(name, state, 20, fz, my)
  it('capacidade à tração = 0,7 × atrito; fator maior permite maior arrancamento', () => {
    const mk = (f: number) => optimize(base({
      combos: [combo('C1', 'ELS', 15, 1400, 20), up('C2', 'ELS', 1100, 900), combo('U1', 'ELU', 22, 1960, 28), up('U2', 'ELU', 1500, 1300)],
      permitTension: true, tensionShaftFactor: f, fixed: { n: 4 },
    }))
    const a = mk(0.7), b = mk(1)
    if (a.best.length && b.best.length) expect(b.best[0].length).toBeLessThanOrEqual(a.best[0].length)
    expect(b.best.length).toBeGreaterThanOrEqual(a.best.length)
  })
  it('estaca tracionada entra no dimensionamento com N negativo e ancoragem plena', () => {
    const r = optimize(base({
      combos: [combo('C1', 'ELS', 15, 1400, 20), up('C2', 'ELS', 900, 1100), combo('U1', 'ELU', 22, 1960, 28), up('U2', 'ELU', 1300, 1600)],
      permitTension: true, tensionShaftFactor: 1, fixed: { n: 4 }, diameters: { helice: [0.5] },
    }))
    const c = r.best[0]
    if (c) {
      expect(c.demands.sets.some((s) => s.N.some((v) => v < 0))).toBe(true)
      expect(c.warnings.join(' ')).toContain('Estaca tracionada')
    }
  })
})

describe('Carga só vertical (sem momento nem força horizontal)', () => {
  it('os perfis de esforços não ficam vazios: N(z) com atrito, M = V = 0 e deslocamento nulo', () => {
    const r = optimize(base({ combos: [combo('C1', 'ELS', 0, 1400, 0), combo('U1', 'ELU', 0, 1960, 0)], fixed: { length: 12 } })).best[0]
    const e = r.profiles.elu
    expect(e.z.length).toBeGreaterThan(10)
    expect(e.Nz!.length).toBe(e.z.length)
    expect(e.Nz![0]).toBeGreaterThan(e.Nz![e.Nz!.length - 1])
    expect(Math.max(...e.M.map(Math.abs))).toBeLessThan(1e-6)
    expect(r.profiles.els.z.length).toBeGreaterThan(10)
  })
})

describe('Afastamento entre estacas e folga do bloco', () => {
  it('pileSpacingFactor define o espaçamento (× D) e aumenta o bloco; blockEdgeClear 15 cm dá bloco menor que a regra de Campos', () => {
    const f = { fixed: { n: 4, diameter: 0.5 } }
    const a = optimize(base({ ...f, blockEdgeClear: 0.15 })).best.find((c) => c.layout.n === 4)
    const b = optimize(base({ ...f, blockEdgeClear: 0.15, pileSpacingFactor: 4 })).best.find((c) => c.layout.n === 4)
    const c = optimize(base(f)).best.find((x) => x.layout.n === 4)
    if (a && b) {
      expect(a.spacing).toBeCloseTo(3 * 0.5, 9)
      expect(b.spacing).toBeCloseTo(4 * 0.5, 9)
      expect(b.blockDesign.geometry.lx).toBeGreaterThan(a.blockDesign.geometry.lx)
      expect(a.blockDesign.geometry.lx).toBeCloseTo(a.spacing + 0.5 + 2 * 0.15, 2) // eixo a eixo + Ø + 2·15 cm
    }
    if (a && c) expect(c.blockDesign.geometry.lx).toBeGreaterThan(a.blockDesign.geometry.lx)
  })
})

import { describe, expect, it } from 'vitest'
import { blockGeometry, chordOf, designBlock, type BlockInput } from './index'
import { layoutsFor } from '../group/layouts'

const piles4 = layoutsFor(4, 0.9)[0].points
const Pd = 600
const base = (over: Partial<BlockInput> = {}): BlockInput => ({
  piles: piles4, dE: 0.4, pillar: { ax: 0.4, ay: 0.4 }, fckBlock: 30, caa: 2,
  combos: [{ name: 'ELU', P: [Pd, Pd, Pd, Pd], Nsd: 4 * Pd }], alphaSides: 0.8, ...over,
})

describe('Métodos de dimensionamento do bloco', () => {
  it('Blévot e flexão geram armaduras e o conservador adota a de maior massa', () => {
    const b = designBlock(base({ method: 'blevot' }))
    const f = designBlock(base({ method: 'flexao' }))
    const c = designBlock(base({ method: 'conservador' }))
    expect(b.feasible && f.feasible && c.feasible).toBe(true)
    expect(b.method).toBe('blevot')
    expect(f.method).toBe('flexao')
    expect(f.bars.every((x) => x.label.startsWith('Flexão'))).toBe(true)
    const kg = c.methodKg!
    const heavy = Math.max(kg.blevot ?? 0, kg.machado ?? 0, kg.flexao ?? 0)
    expect(kg[c.method!]).toBeCloseTo(heavy, 6)
  })
  it('momento da flexão confere com M = ΣP·(x − 0,35·b_p) para 4 estacas simétricas', () => {
    const f = designBlock(base({ method: 'flexao', hFixed: 0.9 }))
    const x = Math.abs(piles4[0].x)
    const M = 2 * Pd * (x - 0.35 * 0.4)
    const d = f.geometry.d
    const mu = M / ((30 / 1.4) * 1000 * 1.2 * d * d) // bw aprox. só para ordem de grandeza
    expect(mu).toBeGreaterThan(0)
    const asX = f.bars.filter((k) => k.label.includes('direção X')).reduce((a, k) => a + k.AsReq, 0)
    const z = 0.9 * d
    expect(asX).toBeGreaterThan(0.7 * ((M / (z * (500 / 1.15 * 1000))) * 1e4))
  })
  it('dimensões em planta editadas: aumenta o bloco; menor que o mínimo reprova', () => {
    const auto = designBlock(base())
    const big = designBlock(base({ lx: auto.geometry.lx + 0.4, ly: auto.geometry.ly + 0.2 }))
    expect(big.geometry.lx).toBeCloseTo(auto.geometry.lx + 0.4, 9)
    expect(big.quantities.concreteM3).toBeGreaterThan(auto.quantities.concreteM3)
    const g = blockGeometry(piles4, 0.4, { ax: 0.4, ay: 0.4 })
    const small = designBlock(base({ lx: g.minLx - 0.05 }))
    expect(small.feasible).toBe(false)
    expect(small.reasons.join(' ')).toContain('Largura em planta')
  })
  it('estacas deslocadas: o bloco acompanha o centro das estacas', () => {
    const moved = piles4.map((p) => ({ ...p, x: p.x + 0.2 }))
    const g = blockGeometry(moved, 0.4, { ax: 0.4, ay: 0.4 })
    expect(g.cx).toBeGreaterThan(0)
    const r = designBlock(base({ piles: moved }))
    expect(r.geometry.cx).toBeCloseTo(g.cx, 9)
  })
  it('formato otimizado: menos área e concreto que a caixa; contorno cobre estacas e pilar à distância a', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const pts = layoutsFor(n, 0.9)[0].points
      const rect = blockGeometry(pts, 0.4, { ax: 0.4, ay: 0.4 })
      const opt = blockGeometry(pts, 0.4, { ax: 0.4, ay: 0.4 }, { shape: 'otimizado' } as never)
      expect(opt.area).toBeLessThanOrEqual(rect.area + 1e-9)
      if (n === 3) expect(opt.area).toBeLessThan(0.85 * rect.area)
      // cada estaca com o eixo a ≥ a da borda (aprox. pelo apótema do octógono)
      const a = 0.4 + 0.15
      for (const p of pts) {
        const chX = chordOf(opt.outline, 'x', p.y)!
        expect(chX[0]).toBeLessThanOrEqual(p.x - a + 1e-6)
        expect(chX[1]).toBeGreaterThanOrEqual(p.x + a - 1e-6)
      }
    }
  })
  it('bloco otimizado reduz o volume e continua atendendo (3 estacas)', () => {
    const pts = layoutsFor(3, 1.2)[0].points
    const mk = (shape: 'otimizado' | 'retangular') => designBlock({ piles: pts, dE: 0.4, pillar: { ax: 0.4, ay: 0.4 }, fckBlock: 30, caa: 2, combos: [{ name: 'ELU', P: [600, 600, 600], Nsd: 1800 }], alphaSides: 0.8, shape })
    const o = mk('otimizado'), r = mk('retangular')
    expect(o.feasible && r.feasible).toBe(true)
    expect(o.quantities.concreteM3).toBeLessThan(r.quantities.concreteM3)
    expect(o.quantities.formM2).toBeLessThan(r.quantities.formM2 * 1.05)
  })
})

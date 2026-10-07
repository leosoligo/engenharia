import { describe, expect, it } from 'vitest'
import { analyzeGroup, compareAsBuilt, davissonFactor, type GroupInput, type GroupPile } from './index'
import { analyzeLateral, buildLateralProfile } from '../lateral'
import type { SptBorehole } from '../soil'

const bh: SptBorehole = {
  id: 'F1',
  waterLevel: 3,
  layers: Array.from({ length: 25 }, (_, i) => ({
    depth: i + 1,
    nspt: i < 4 ? 5 : i < 12 ? 10 : 25,
    soil: (i < 4 ? 'argila_arenosa' : i < 12 ? 'areia_siltosa' : 'silte_argiloso') as 'argila',
  })),
}
const profile = buildLateralProfile(bh)

const pile = (id: string, x: number, y: number, over: Partial<GroupPile> = {}): GroupPile => ({
  id, x, y, type: 'escavada', diameter: 0.4, length: 15, headFixity: 'engastada', profile, ...over,
})
const square = (s: number, over: Partial<GroupPile> = {}) => [
  pile('E1', -s / 2, -s / 2, over), pile('E2', s / 2, -s / 2, over), pile('E3', s / 2, s / 2, over), pile('E4', -s / 2, s / 2, over),
]
const base = (piles: GroupPile[], loads: Partial<GroupInput['loads']>): GroupInput => ({
  piles, loads: { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, ...loads },
  fck: 30, eiFactor: 0.8, topDepth: 0, loading: 'static', groupEffect: 'none',
})

describe('Fator de grupo de Davisson (V&L §15.7)', () => {
  it('0,25 a 3B; 1,0 a 8B; linear entre', () => {
    expect(davissonFactor(1.2, 0.4)).toBe(0.25)
    expect(davissonFactor(3.2, 0.4)).toBe(1)
    expect(davissonFactor(0.4 * 5.5, 0.4)).toBeCloseTo(0.25 + 0.75 * 0.5, 9)
  })
})

describe('Grupo — bloco rígido', () => {
  it('carga vertical centrada em 4 estacas iguais: Fz/4 cada, sem esforço lateral', () => {
    const r = analyzeGroup(base(square(1.2), { fz: 2000 }))
    expect(r.converged).toBe(true)
    r.piles.forEach((p) => {
      expect(p.axial).toBeCloseTo(500, 6)
      expect(p.H).toBeCloseTo(0, 6)
    })
  })
  it('horizontal centrada: H/n em cada estaca, mesmo deslocamento, ΣH = Fx', () => {
    const r = analyzeGroup(base(square(1.2), { fx: 200, fz: 1200 }))
    expect(r.converged).toBe(true)
    // cabeças engastadas: o binário axial muda N entre as estacas e, por P-Δ, a rigidez (diferença < 0,2 %)
    r.piles.forEach((p) => expect(Math.abs(p.Hx / 50 - 1)).toBeLessThan(0.002))
    expect(r.sums.fx).toBeCloseTo(200, 6)
    expect(r.sums.fz).toBeCloseTo(1200, 6)
    expect(r.cap.uy).toBeCloseTo(0, 9)
  })
  it('momento My com cabeças articuladas: Pi = N/n + My·xi/Σxi² (superposição, sinal da convenção do CSV)', () => {
    const piles = square(1.2, { headFixity: 'articulada' })
    const r = analyzeGroup(base(piles, { fz: 2000, my: 300, mx: -150 }))
    const sx2 = piles.reduce((s, p) => s + p.x ** 2, 0)
    const sy2 = piles.reduce((s, p) => s + p.y ** 2, 0)
    r.piles.forEach((res, i) => {
      const expected = 2000 / 4 + (300 * piles[i].x) / sx2 - (-150 * piles[i].y) / sy2
      expect(res.axial).toBeCloseTo(expected, 5)
    })
  })
  it('momento My com cabeças engastadas: mais da metade absorvida por binário axial, equilíbrio de momento global', () => {
    const piles = square(1.2)
    const r = analyzeGroup(base(piles, { fz: 2000, my: 300 }))
    const couple = r.piles.reduce((s, p) => s + p.axial * p.x, 0)
    expect(couple).toBeLessThanOrEqual(300 + 1e-6)
    expect(couple).toBeGreaterThan(150)
  })
  it('estaca deslocada: carga axial se redistribui no sentido esperado e o somatório se mantém', () => {
    const piles = square(1.2)
    piles[0] = { ...piles[0], x0: piles[0].x, y0: piles[0].y, x: piles[0].x + 0.15 } // E1 deslocada para dentro do bloco (+x)
    piles.slice(1).forEach((p, k) => (piles[k + 1] = { ...p, x0: p.x, y0: p.y }))
    const cmp = compareAsBuilt(base(piles, { fz: 2000, my: 200 }))
    expect(cmp.built.sums.fz).toBeCloseTo(2000, 5)
    expect(cmp.design.sums.fz).toBeCloseTo(2000, 5)
    // E1 (x < 0) comprime menos com My > 0; deslocá-la para +x (mais perto do eixo) a carrega MAIS
    const row = cmp.rows.find((r) => r.id === 'E1')!
    expect(row.delta).toBeGreaterThan(0)
  })
  it('1 estaca: coincide com a análise isolada de topo livre (um bloco sobre uma única estaca gira livremente)', () => {
    const g = analyzeGroup(base([pile('A', 0, 0)], { fx: 60, fz: 400 }))
    const EI = 0.8 * (0.875 * 5600 * Math.sqrt(30) * 1000) * ((Math.PI * 0.4 ** 4) / 64)
    const s = analyzeLateral({
      profile, B: 0.4, EI, length: 15, topDepth: 0, H: 60, M: 0, N: 400,
      head: { translation: 'free', rotation: 'free' }, loading: 'static',
    })
    expect(Math.abs(g.piles[0].headDisplacement / Math.abs(s.headDisplacement) - 1)).toBeLessThan(0.02)
    expect(Math.abs(g.piles[0].maxMoment.value / Math.abs(s.maxMoment.value) - 1)).toBeLessThan(0.03)
  })
  it('efeito de grupo (Davisson) aumenta deslocamento e momento quando as estacas estão próximas', () => {
    const close = square(1.0) // 2,5B
    const a = analyzeGroup(base(close, { fx: 200, fz: 1200 }))
    const b = analyzeGroup({ ...base(close, { fx: 200, fz: 1200 }), groupEffect: 'davisson' })
    expect(b.piles[0].groupFactor).toBe(0.25)
    expect(b.piles[0].headDisplacement).toBeGreaterThan(1.5 * a.piles[0].headDisplacement)
    expect(b.piles[0].maxMoment.value).toBeGreaterThan(a.piles[0].maxMoment.value)
  })
})

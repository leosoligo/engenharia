import { describe, expect, it } from 'vitest'
import { designBlock, type BlockInput } from './index'
import { classifyLayout, machadoDesign } from './machado'
import { layoutsFor } from '../group/layouts'

/** Exemplos resolvidos de Bastos (UNESP, "Blocos de Fundação", 2023, §14) — Exemplos 1 a 3 (Machado, 1985). */
const fyd = (500 / 1.15) * 1000 // kPa
const fcd = (f: number) => (f / 1.4) * 1000

describe('Roteiro de Machado/Bastos — exemplos resolvidos', () => {
  it('Exemplo 1 (2 estacas): As = 8,79 cm²; tensões 9,9 e 23,3 MPa; θ = 54,2°', () => {
    const piles = layoutsFor(2, 0.8)[1].points // linha em Y, e = 80 cm
    const m = machadoDesign({ piles, pillar: { ax: 0.2, ay: 0.3 }, dE: 0.3, d: 0.45, Pmax: [460.2, 460.2], fyd, fcd: fcd(25), kr: 0.95 })!
    expect(m.kind).toBe('2')
    expect(m.groups[0].AsReq).toBeCloseTo(8.79, 1)
    expect((m.theta * 180) / Math.PI).toBeCloseTo(54.16, 1)
    expect(m.dMin * 100).toBeCloseTo(32.5, 1)
    expect(m.dMax * 100).toBeCloseTo(46.2, 0)
    const [pil, est] = m.checks
    expect(pil.value / 1000).toBeCloseTo(23.3, 0) // MPa
    expect(est.value / 1000).toBeCloseTo(9.9, 0)
    expect(pil.limit / 1000).toBeCloseTo(23.8, 0)
    expect(m.checks.every((c) => c.ok)).toBe(true)
    expect(m.AsSupPerDir).toBeCloseTo(1.76, 1)
  })
  it('Exemplo 3 (4 estacas): A_s,lado = 6,10; suspensão 7,24 (1,81/face); malha 1,81; superior 2,44; pele 3,02 cm²', () => {
    const piles = layoutsFor(4, 0.8)[0].points
    const P = 1888.5 / 4
    const m = machadoDesign({ piles, pillar: { ax: 0.2, ay: 0.75 }, dE: 0.3, d: 0.54, Pmax: [P, P, P, P], fyd, fcd: fcd(20), kr: 0.95 })!
    expect(m.kind).toBe('4')
    const side = m.groups.filter((g) => g.role === 'side')
    expect(side).toHaveLength(4)
    expect(side[0].AsReq).toBeCloseTo(6.1, 1)
    expect(m.AsSuspTot).toBeCloseTo(7.24, 1)
    expect(m.groups.find((g) => g.role === 'mesh')!.AsReq).toBeCloseTo(1.81, 1)
    expect(m.AsSupPerDir).toBeCloseTo(2.44, 1)
    expect(m.AsPeleFace).toBeCloseTo(3.05, 1)
    expect((m.theta * 180) / Math.PI).toBeCloseTo(51.55, 0)
    expect(m.checks.every((c) => c.ok)).toBe(true)
  })
  it('Exemplo 2 (3 fustes de tubulão): A_s,lado = 27,43; suspensão 37,55; malha 12,52; superior 8,23; pele 10,29 cm²', () => {
    const piles = layoutsFor(3, 2.5)[0].points
    const P = 7350 / 3
    const m = machadoDesign({ piles, pillar: { ax: 0.65, ay: 0.65 }, dE: 0.7, d: 1.48, Pmax: [P, P, P], fyd, fcd: fcd(25), kr: 0.95 })!
    expect(m.kind).toBe('3')
    expect(m.groups.filter((g) => g.role === 'side')[0].AsReq).toBeCloseTo(27.43, 1)
    expect(m.AsSuspTot).toBeCloseTo(37.55, 0)
    expect(m.groups.find((g) => g.role === 'mesh')!.AsReq).toBeCloseTo(12.52, 0)
    expect(m.AsSupPerDir).toBeCloseTo(8.23, 1)
    expect(m.AsPeleFace).toBeCloseTo(10.29, 1)
    expect((m.theta * 180) / Math.PI).toBeCloseTo(49.9, 0)
  })
  it('CEB-70 no Exemplo 2: A_s,lado = 33,40 cm² e resistência local limite 4.372 kN', () => {
    const piles = layoutsFor(3, 2.5)[0].points
    const inp: BlockInput = { piles, dE: 0.7, pillar: { ax: 0.65, ay: 0.65 }, fckBlock: 25, caa: 2, combos: [{ name: 'ELU', P: [2450, 2450, 2450], Nsd: 7350 }], hFixed: 1.48 + 0.05, method: 'flexao', edgeClear: 0.35 }
    const r = designBlock(inp)
    const lado = r.bars.find((b) => b.label.includes('lado 1'))!
    expect(lado.AsReq).toBeCloseTo(33.4, 0)
    const loc = r.checks.find((c) => c.name.includes('Resistência local'))!
    expect(loc.limit).toBeCloseTo(4372.6, -1)
    expect(loc.value).toBeCloseTo(2450, 6)
    expect(loc.ok).toBe(true)
  })
  it('designBlock com o roteiro: Exemplo 1 completo (método machado) e escolha do conservador', () => {
    const piles = layoutsFor(2, 0.8)[1].points
    const inp: BlockInput = { piles, dE: 0.3, pillar: { ax: 0.2, ay: 0.3 }, fckBlock: 25, caa: 2, combos: [{ name: 'ELU', P: [460.2, 460.2], Nsd: 920.4 }], hFixed: 0.5, method: 'machado', kr: 0.95, edgeClear: 0.2 }
    const r = designBlock(inp)
    expect(r.feasible).toBe(true)
    expect(r.method).toBe('machado')
    expect(r.bars[0].AsReq).toBeCloseTo(8.79, 1)
    // o conservador usa os limites de biela de Campos (0,85·κ·fcd), mais severos que os de Blévot: com fck 30 o bloco passa
    const c = designBlock({ ...inp, fckBlock: 30, method: 'conservador' })
    expect(c.feasible).toBe(true)
    expect(c.methodKg!.machado).toBeDefined()
    const heavy = Math.max(c.methodKg!.blevot ?? 0, c.methodKg!.machado ?? 0, c.methodKg!.flexao ?? 0)
    expect(c.methodKg![c.method!]).toBeCloseTo(heavy, 6)
  })
  it('reconhece os arranjos do roteiro', () => {
    expect(classifyLayout(layoutsFor(3, 1)[0].points)?.kind).toBe('3')
    expect(classifyLayout(layoutsFor(4, 1)[0].points)?.kind).toBe('4')
    expect(classifyLayout(layoutsFor(5, 1)[0].points)?.kind).toBe('5c')
    expect(classifyLayout(layoutsFor(5, 1)[1].points)?.kind).toBe('5p')
    expect(classifyLayout(layoutsFor(6, 1)[0].points)?.kind).toBe('6h')
    expect(classifyLayout(layoutsFor(7, 1)[0].points)?.kind).toBe('7')
    expect(classifyLayout(layoutsFor(6, 1)[1].points)).toBeUndefined()
  })
})

describe('Contorno típico', () => {
  const tri = (e: number) => { const r = e / Math.sqrt(3); return [0, 1, 2].map((k) => ({ x: r * Math.cos((Math.PI / 2) + (k * 2 * Math.PI) / 3), y: r * Math.sin((Math.PI / 2) + (k * 2 * Math.PI) / 3) })) }
  it('3 estacas: triângulo truncado (6 vértices), cobre estacas e pilar, menor que a caixa', async () => {
    const { blockGeometry } = await import('./block')
    const piles = tri(0.9)
    const g = blockGeometry(piles, 0.4, { ax: 0.3, ay: 0.3 }, { shape: 'tipico', edgeMargin: 0.15 })
    expect(g.shape).toBe('tipico')
    expect(g.outline.length).toBe(6)
    const box = blockGeometry(piles, 0.4, { ax: 0.3, ay: 0.3 }, { shape: 'retangular', edgeMargin: 0.15 })
    expect(g.area).toBeLessThan(box.area)
  })
  it('4 estacas em quadrado: retangular', async () => {
    const { blockGeometry } = await import('./block')
    const g = blockGeometry([{ x: -.4, y: -.4 }, { x: .4, y: -.4 }, { x: .4, y: .4 }, { x: -.4, y: .4 }], 0.4, { ax: 0.3, ay: 0.3 }, { shape: 'tipico' })
    expect(g.shape).toBe('retangular')
  })
})

describe('Fissuração dos tirantes (NBR 6118:2026, 17.3.3.2)', () => {
  it('cálculo manual: φ16 × 4 barras, σs = 250 MPa, faixa 0,6 m, fck 30 → wk = 0,175 mm (expressão 1 governa)', async () => {
    const { crackWidth } = await import('./crack')
    const r = crackWidth({ phiMm: 16, nBars: 4, strip: 0.6, bottom: 0.07, sigma: 250, fck: 30 })
    expect(r.Acr).toBeCloseTo(0.0285, 6)
    expect(r.wk).toBeCloseTo(0.1754, 3)
  })
  it('blocos projetados trazem a verificação de fissuração', () => {
    const piles = [{ x: -0.45, y: 0 }, { x: 0.45, y: 0 }]
    const r = designBlock({ piles, dE: 0.4, pillar: { ax: 0.3, ay: 0.3 }, fckBlock: 35, caa: 2, combos: [{ name: 'U', P: [460, 460], Nsd: 920 }], serviceMaxP: 330, method: 'machado' } as BlockInput)
    expect(r.reasons).toEqual([])
    expect(r.feasible).toBe(true)
    expect(r.crack && r.crack.length).toBeGreaterThan(0)
    for (const q of r.crack!) expect(q.limit).toBe(0.3)
  })
})

describe('Pilar alongado e momento', () => {
  const piles = layoutsFor(4, 1.0)[0].points
  it('avisa pilar alongado e informa o efeito sobre a armadura', () => {
    const r = designBlock({ piles, dE: 0.4, pillar: { ax: 0.2, ay: 0.7 }, fckBlock: 35, caa: 2, combos: [{ name: 'U', P: [500, 500, 500, 500], Nsd: 2000 }], method: 'machado' } as BlockInput)
    expect(r.warnings.join(' ')).toContain('Pilar alongado')
  })
  it('avisa quando o momento desequilibra as reações e quando há tração', () => {
    const r = designBlock({ piles, dE: 0.4, pillar: { ax: 0.4, ay: 0.4 }, fckBlock: 35, caa: 2, combos: [{ name: 'U', P: [700, 600, 400, 300], Nsd: 2000 }], method: 'machado' } as BlockInput)
    expect(r.warnings.join(' ')).toContain('Momento no pilar')
    const t = designBlock({ piles, dE: 0.4, pillar: { ax: 0.4, ay: 0.4 }, fckBlock: 35, caa: 2, combos: [{ name: 'U', P: [900, 800, 100, -50], Nsd: 1750 }], method: 'machado' } as BlockInput)
    expect(t.warnings.join(' ') + t.reasons.join(' ')).toMatch(/tracionada|Pilar alongado|Momento/)
  })
})

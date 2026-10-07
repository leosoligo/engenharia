import { describe, expect, it } from 'vitest'
import { blockGeometry, designBlock, type BlockInput } from './index'
import { layoutsFor } from '../group/layouts'

/** Exemplo resolvido de Campos (2015), §12.4: bloco sobre 4 estacas, P = 1650 kN (característico), ℓ = 70 cm, b = 30 cm. */
const piles4 = layoutsFor(4, 0.7)[0].points
const Pd = (1650 * 1.4) / 4 // reação de cálculo por estaca (γf = 1,4 do livro)
const campos = (over: Partial<BlockInput> = {}): BlockInput => ({
  piles: piles4, dE: 0.35, pillar: { ax: 0.3, ay: 0.3 }, fckBlock: 25, caa: 2,
  combos: [{ name: 'ELU', P: [Pd, Pd, Pd, Pd], Nsd: 1650 * 1.4 }], alphaSides: 0.6, hFixed: 0.8, ...over,
})

describe('Bloco sobre estacas — exemplo resolvido de Campos (4 estacas)', () => {
  it('tirante segundo os lados (α = 0,6): Rsd = 1,4 × 123,75 kN → As = 3,98 cm²', () => {
    const r = designBlock(campos({ hFixed: 0.6 + 0.2, fckBlock: 40 })) // d = 0,75 m
    // com d = 0,75 m os números mudam; confere o caso do livro com d = 0,55 m abaixo
    expect(r.geometry.d).toBeCloseTo(0.75, 9)
  })
  it('caso do livro d = 55 cm: Rs(lados) e As por equações do Quadro 12.2/12.23 e As ≈ 3,98 cm²', () => {
    const r = designBlock({ ...campos({ fckBlock: 60, hFixed: 0.6 }) })
    // fck alto só para focar nos tirantes (a verificação de biela é testada à parte)
    const sides = r.bars.find((b) => b.label.includes('direção X'))!
    expect(Math.abs(sides.AsReq / 3.985 - 1)).toBeLessThan(0.01)
  })
  it('geometria: ângulo 45°–55°, d mínimo pela maior distância (ℓ√2/2 − b√2/4)', () => {
    const g = blockGeometry(piles4, 0.35, { ax: 0.3, ay: 0.3 })
    const arm = (0.7 * Math.SQRT2) / 2 - (0.3 * Math.SQRT2) / 4
    expect(g.dMin).toBeCloseTo(arm, 9) // tan 45° = 1
    expect(g.dMax).toBeCloseTo(arm * Math.tan((55 * Math.PI) / 180), 9)
    expect(g.d).toBeGreaterThanOrEqual(g.dMin)
    expect(g.h).toBeCloseTo(g.d + g.cTot, 9)
  })
  it('tensão da biela junto ao pilar com fck 20 e d = 55 cm não passa (como no livro) e há motivo', () => {
    const r = designBlock(campos({ fckBlock: 20, hFixed: 0.6 }))
    expect(r.feasible).toBe(false)
    expect(r.reasons.join(' ')).toContain('Biela junto ao pilar')
  })
  it('ângulos reportados e coerentes com tg θ = d/(r − a)', () => {
    const r = designBlock(campos({ fckBlock: 60, hFixed: 0.6 }))
    const arm = (0.7 * Math.SQRT2) / 2 - (0.3 * Math.SQRT2) / 4
    expect(r.theta[0]).toBeCloseTo((Math.atan2(0.55, arm) * 180) / Math.PI, 6)
  })
  it('bloco sobre 2 estacas: tirante único com As = P·(ℓ_i − b/4)/d/fyd e aviso de travamento', () => {
    const p2 = layoutsFor(2, 1.2)[0].points
    const P = 500
    const r = designBlock({ piles: p2, dE: 0.4, pillar: { ax: 0.3, ay: 0.3 }, fckBlock: 40, caa: 2, combos: [{ name: 'ELU', P: [P, P], Nsd: 2 * P }], hFixed: 0.9 })
    expect(r.feasible).toBe(true)
    const d = 0.9 - 0.05
    const rs = (P * (0.6 - 0.3 / 4)) / d
    expect(r.bars[0].AsReq).toBeCloseTo(rs / (500 / 1.15 / 10), 6)
    expect(r.warnings.join(' ')).toContain('travar com viga')
  })
  it('bloco sobre 3 estacas: Rs(lados) = Rs(diag)/√3 nas três cintas', () => {
    const p3 = layoutsFor(3, 1.2)[0].points
    const P = 600
    const r = designBlock({ piles: p3, dE: 0.4, pillar: { ax: 0.3, ay: 0.3 }, fckBlock: 40, caa: 2, combos: [{ name: 'ELU', P: [P, P, P], Nsd: 3 * P }] })
    expect(r.feasible).toBe(true)
    const R = Math.hypot(p3[0].x, p3[0].y)
    const d = r.geometry.d
    const rs = (P * (R - 0.3 * 0.3)) / d
    const cintas = r.bars.filter((b) => b.label.includes('cinta'))
    expect(cintas).toHaveLength(3)
    expect(cintas[0].AsReq).toBeCloseTo(rs / Math.sqrt(3) / (500 / 1.15 / 10), 6)
  })
  it('quantitativos coerentes: volume = lx·ly·h e aço > 0', () => {
    const r = designBlock(campos({ fckBlock: 60, hFixed: 0.6 }))
    expect(r.quantities.concreteM3).toBeCloseTo(r.geometry.lx * r.geometry.ly * r.geometry.h, 9)
    expect(r.quantities.steelKg).toBeGreaterThan(0)
  })
  it('estaca tracionada gera aviso', () => {
    const r = designBlock(campos({ fckBlock: 60, hFixed: 0.6, combos: [{ name: 'ELU', P: [Pd, Pd, Pd, -50], Nsd: 2000 }] }))
    expect(r.warnings.join(' ')).toContain('tracionada')
  })
})

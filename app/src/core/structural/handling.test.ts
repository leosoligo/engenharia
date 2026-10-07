import { describe, expect, it } from 'vitest'
import { handlingCheck, maxMomentTwoSupports } from './handling'

describe('Manuseio de estacas pré-moldadas (NBR 16258:2014)', () => {
  const inp = { D: 0.4, L: 12, n: 8, phiMm: 12.5, Rs: 0.15, fckDemold: 20, fckFinal: 35 }
  const q = (25 * Math.PI * 0.16) / 4
  it('estática exata: dois apoios a 0,21·L → M = q·a²/2 = 0,0221·q·L²; um ponto a 0,29·L → ≈ 0,0437·q·L²', () => {
    expect(maxMomentTwoSupports(12, 0.21 * 12, 0.79 * 12, q) / (q * 144)).toBeCloseTo(0.21 ** 2 / 2, 4)
    expect(maxMomentTwoSupports(12, 0, 0.71 * 12, q) / (q * 144)).toBeCloseTo(0.0437, 3)
  })
  it('momentos mínimos: 0,05·q·L²·α (1 ponto) e 0,02·q·L²·α (2 pontos); adotado o maior com a estática exata', () => {
    const r = handlingCheck(inp)
    expect(r.q).toBeCloseTo(q, 9)
    expect(r.cases[0].Mnorm).toBeCloseTo(0.05 * q * 144 * 1.3, 6)
    expect(r.cases[1].Mnorm).toBeCloseTo(0.02 * q * 144 * 1.3, 6)
    expect(r.cases[1].Md).toBeCloseTo(((0.21 ** 2) / 2) * q * 144 * 1.3, 2) // exato (0,0221) > 0,02
    expect(r.cases[0].Md).toBeCloseTo(r.cases[0].Mnorm, 6) // 0,05 > 0,0437
  })
  it('α mínimo 1,3 e γf editável; mais armadura aumenta MRd', () => {
    const a = handlingCheck({ ...inp, alpha: 1 })
    expect(a.cases[0].Mnorm).toBeCloseTo(0.05 * q * 144 * 1.3, 6)
    expect(handlingCheck({ ...inp, gammaF: 1.4 }).cases[0].Md).toBeCloseTo(1.4 * a.cases[0].Md, 6)
    expect(handlingCheck({ ...inp, n: 12, phiMm: 16 }).cases[0].MRd).toBeGreaterThan(a.cases[0].MRd)
  })
  it('armadura transversal: Ø5 c/10 (2 ramos) = 3,93 cm²/m ≥ 1,38 e ≥ 2,76; Ø4,2 c/15 = 1,85 cm²/m não atende nas extremidades', () => {
    const ok = handlingCheck({ ...inp, stirrup: { phiMm: 5, spacingCm: 10, endSpacingCm: 10 } }).transverse!
    expect(ok.AswCorrente).toBeCloseTo(2 * 0.19635 * 10, 3)
    expect(ok.okCorrente && ok.okExtremidade).toBe(true)
    const bad = handlingCheck({ ...inp, stirrup: { phiMm: 4.2, spacingCm: 15, endSpacingCm: 15 } }).transverse!
    expect(bad.okCorrente).toBe(true)
    expect(bad.okExtremidade).toBe(false)
  })
})

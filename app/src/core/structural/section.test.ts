import { describe, expect, it } from 'vitest'
import { barArea, concreteDesign, momentCapacity, momentCapacityAt, momentCurvature, secantEI, steelDesign, type CircularSection, type Materials } from './section'

// Seção do cálculo independente em Python (scratchpad/check_section.py, integração polar fina)
const mat: Materials = { fck: 30, gammaC: 1.4, fyk: 500, gammaS: 1.15 }
const sec: CircularSection = { D: 0.5, n: 8, phi: 0.016, Rs: 0.19 }

describe('Seção circular — interação N–M', () => {
  it('capacidades axiais: tração = −As·fyd; compressão = 0,85·fcd·Ac + As·(σs − 0,85·fcd)', () => {
    const c = momentCapacityAt(sec, mat, 0)
    const { fyd, Es } = steelDesign(mat)
    const { fcd } = concreteDesign(mat)
    const As = sec.n * barArea(sec.phi)
    expect(c.Nmin).toBeCloseTo(-As * fyd, 3)
    const sigS = Math.min(Es * 0.002, fyd)
    const Ac = (Math.PI * sec.D ** 2) / 4
    const nExp = 0.85 * fcd * Ac + As * (sigS - 0.85 * fcd)
    expect(Math.abs(c.Nmax / nExp - 1)).toBeLessThan(0.003)
    expect(Math.abs(c.Nmax / 4222.637 - 1)).toBeLessThan(0.003)
  })
  it.each([
    [0, 127.427, 0],
    [500, 192.949, 0],
    [1500, 250.166, 0],
    [2500, 215.367, 0],
  ])('MRd(N = %d kN) coincide com a integração polar independente (±1 %%)', (N, ref) => {
    const m = momentCapacity(sec, mat, N).MRd
    expect(Math.abs(m / ref - 1)).toBeLessThan(0.01)
  })
  it('N fora da faixa resistente é recusado', () => {
    expect(momentCapacity(sec, mat, 6000).ok).toBe(false)
    expect(momentCapacity(sec, mat, -2000).ok).toBe(false)
  })
  it('MRd aumenta com a armadura', () => {
    const a = momentCapacity(sec, mat, 500).MRd
    const b = momentCapacity({ ...sec, n: 12, phi: 0.02 }, mat, 500).MRd
    expect(b).toBeGreaterThan(1.5 * a)
  })
  it('MRd cresce com N até o ponto balanceado e depois decresce (formato do diagrama)', () => {
    const vals = [0, 500, 1500, 2500, 3500].map((N) => momentCapacity(sec, mat, N).MRd)
    expect(vals[2]).toBeGreaterThan(vals[0])
    expect(vals[4]).toBeLessThan(vals[2])
  })
})

describe('Momento-curvatura', () => {
  const Ec = 0.875 * 5600 * Math.sqrt(30) * 1000 // kPa (Ecs)
  const fct = 0.3 * 30 ** (2 / 3) * 1000 // fctm, kPa (NBR 6118: 0,3·fck^(2/3))
  const curve = momentCurvature(sec, mat, 500, { Ec, fct })
  it('trecho inicial ≈ rigidez do diagrama de cálculo (tangente inicial 2·0,85·fcd/εc2 < Ec) e cai com o momento', () => {
    const I = (Math.PI * sec.D ** 4) / 64
    const { fcd } = concreteDesign(mat)
    const Ed = (2 * 0.85 * fcd) / 0.002 // kPa: módulo inicial do diagrama parábola-retângulo de cálculo
    const ei0 = secantEI(curve, curve[1].M * 0.5)
    expect(ei0 / (Ed * I)).toBeGreaterThan(0.95)
    expect(ei0 / (Ed * I)).toBeLessThan(1.25) // + contribuição da armadura
    const eiHigh = secantEI(curve, 0.95 * curve[curve.length - 1].M)
    expect(eiHigh).toBeLessThan(0.5 * ei0)
  })
  it('momento máximo da curva ≈ MRd (mesmos diagramas de cálculo)', () => {
    const mmax = curve[curve.length - 1].M
    const mrd = momentCapacity(sec, mat, 500).MRd
    expect(Math.abs(mmax / mrd - 1)).toBeLessThan(0.05)
  })
})

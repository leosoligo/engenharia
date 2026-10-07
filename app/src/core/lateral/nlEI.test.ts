import { describe, expect, it } from 'vitest'
import { analyzeLateral, buildLateralProfile } from './index'
import { momentCurvature, secantEI, type CircularSection, type Materials } from '../structural/section'

const profile = buildLateralProfile({
  id: 'x',
  waterLevel: 4,
  layers: Array.from({ length: 20 }, (_, i) => ({
    depth: i + 1,
    nspt: i < 6 ? 4 : 12,
    soil: (i < 6 ? 'argila_arenosa' : 'areia_siltosa') as 'argila',
  })),
})

describe('EI não linear (momento-curvatura) acoplado à análise lateral', () => {
  const mat: Materials = { fck: 30, gammaC: 1.4, fyk: 500, gammaS: 1.15 }
  const sec: CircularSection = { D: 0.5, n: 8, phi: 0.016, Rs: 0.19 }
  const Ec = 0.875 * 5600 * Math.sqrt(30) * 1000
  const N = 500
  const curve = momentCurvature(sec, mat, N, { Ec, fct: 0.3 * 30 ** (2 / 3) * 1000 })
  const EIgross = Ec * ((Math.PI * 0.5 ** 4) / 64)
  const run = (H: number, nl: boolean) =>
    analyzeLateral({
      profile, B: 0.5, EI: EIgross, length: 15, topDepth: 0, H, M: 0, N,
      head: { translation: 'free', rotation: 'free' }, loading: 'static',
      ...(nl ? { EIfn: (M: number) => secantEI(curve, M) } : {}),
    })

  it('carga baixa: EI não linear ≈ constante e rigidez cai com o momento', () => {
    const r = run(10, true)
    expect(r.converged).toBe(true)
    expect(Math.min(...r.EIe)).toBeGreaterThan(0.5 * EIgross * 0.7) // curva usa diagrama de cálculo (E inicial < Ecs)
  })
  it('carga alta: a fissuração/plastificação reduz EI e aumenta o deslocamento no topo', () => {
    const lin = run(80, false)
    const nl = run(80, true)
    expect(nl.converged).toBe(true)
    expect(Math.min(...nl.EIe)).toBeLessThan(0.6 * Math.max(...nl.EIe))
    expect(Math.abs(nl.headDisplacement)).toBeGreaterThan(Math.abs(lin.headDisplacement))
    // equilíbrio preservado
    expect(nl.V[0]).toBeCloseTo(80, 2)
  })
})

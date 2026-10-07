import { describe, expect, it } from 'vitest'
import { analyzeLateral, apiSandC, apiSandK, pySand, pySoftClay, pyStiffClay, type LateralInput, type LateralProfile } from './index'
import type { LateralLayer } from './soilProfile'

const base: Omit<LateralLayer, 'top' | 'bottom'> = {
  soil: 'areia', nspt: 10, model: 'linear', gammaEff: 10, phi: 30, kSand: 0, su: 50, epsC: 0.01, J: 0.5, ks: 0, kc: 0, nh: 0, belowWaterTable: true,
}
const profile = (n: number, patch: Partial<LateralLayer>): LateralProfile => ({
  layers: Array.from({ length: n }, (_, i) => ({ ...base, top: i, bottom: i + 1, ...patch })),
  warnings: [],
})

describe('Winkler linear (nh·z) × Matlock & Reese (1956/1961) — V&L, Tab. 15.4: Ay = 2,435; Aθ = −1,623; By = 1,623', () => {
  const EI = 50_000 // kN·m²
  const nh = 5_000 // kN/m³ (p = nh·z·y)
  const T = (EI / nh) ** 0.2
  const mk = (over: Partial<LateralInput>): LateralInput => ({
    profile: profile(40, { nh }), B: 0.5, EI, length: 30, topDepth: 0, H: 100, M: 0, N: 0,
    head: { translation: 'free', rotation: 'free' }, loading: 'static', elementLength: 0.1, ...over,
  })
  it('topo livre, só H: y = 2,435·H·T³/EI e θ = 1,623·H·T²/EI (|Aθ|)', () => {
    const r = analyzeLateral(mk({}))
    expect(r.converged).toBe(true)
    expect(r.headDisplacement).toBeCloseTo((2.435 * 100 * T ** 3) / EI, 3)
    expect(Math.abs(r.headDisplacement / ((2.435 * 100 * T ** 3) / EI) - 1)).toBeLessThan(0.01)
    expect(Math.abs(r.headRotation / ((1.623 * 100 * T ** 2) / EI) - 1)).toBeLessThan(0.01)
  })
  it('topo livre, só M: y = 1,623·M·T²/EI', () => {
    const r = analyzeLateral(mk({ H: 0, M: 80 }))
    expect(Math.abs(r.headDisplacement / ((1.623 * 80 * T ** 2) / EI) - 1)).toBeLessThan(0.01)
  })
  it('topo com rotação impedida: y ≈ 0,93·H·T³/EI', () => {
    const r = analyzeLateral(mk({ head: { translation: 'free', rotation: 'fixed' } }))
    expect(Math.abs(r.headDisplacement / ((0.93 * 100 * T ** 3) / EI) - 1)).toBeLessThan(0.02)
    expect(Math.abs(r.headRotation)).toBeLessThan(1e-6)
  })
  it('equilíbrio: cortante no topo = H e soma das reações = H', () => {
    const r = analyzeLateral(mk({}))
    expect(r.V[0]).toBeCloseTo(100, 3)
    const dz = r.z[1] - r.z[0]
    const sum = r.p.reduce((a, p, i) => a + p * (i === 0 || i === r.p.length - 1 ? dz / 2 : dz), 0)
    expect(sum).toBeCloseTo(100, 1)
  })
})

describe('Flambagem (P-Δ)', () => {
  it('trecho livre sem solo: Euler engastado-livre Pcr = π²EI/(4L²) (solo muito mole ao fundo)', () => {
    // estaca de 10 m acima do terreno + 1 m dentro de solo muito rígido (aproxima engaste)
    const EI = 10_000
    const stiff = profile(30, { nh: 1e11 })
    const r = analyzeLateral({
      profile: stiff, B: 0.4, EI, length: 10.5, topDepth: -10, H: 1, M: 0, N: 10,
      head: { translation: 'free', rotation: 'free' }, loading: 'static', elementLength: 0.05,
    })
    const euler = (Math.PI ** 2 * EI) / (4 * 10 ** 2)
    expect(Math.abs(r.criticalLoad / euler - 1)).toBeLessThan(0.02)
  })
  it('topo com rotação impedida aumenta Pcr (≈ 2× para translação livre)', () => {
    const mk = (rot: 'free' | 'fixed') =>
      analyzeLateral({
        profile: profile(30, { nh: 1e11 }), B: 0.4, EI: 10_000, length: 10.5, topDepth: -10, H: 1, M: 0, N: 10,
        head: { translation: 'free', rotation: rot }, loading: 'static', elementLength: 0.05,
      }).criticalLoad
    // engastado-engastado com translação livre: Pcr = π²EI/L²
    expect(Math.abs(mk('fixed') / ((Math.PI ** 2 * 10_000) / 100) - 1)).toBeLessThan(0.02)
  })
  it('carga acima da crítica torna o sistema instável', () => {
    const r = analyzeLateral({
      profile: profile(30, { nh: 1e11 }), B: 0.4, EI: 10_000, length: 10.5, topDepth: -10, H: 1, M: 0, N: 500,
      head: { translation: 'free', rotation: 'free' }, loading: 'static', elementLength: 0.05,
    })
    expect(r.unstable).toBe(true)
  })
})

describe('Curvas p-y', () => {
  it('API areia: C1, C2, C3 em φ = 30° coincidem com a Fig. 15.6b de V&L (≈1,9; 2,7; ≈28)', () => {
    const c = apiSandC(30)
    expect(c.C1).toBeCloseTo(1.91, 1)
    expect(c.C2).toBeCloseTo(2.667, 2)
    expect(c.C3).toBeCloseTo(28.7, 0)
  })
  it('API areia: k(φ) — 28,8° ≈ 10 lb/in³ (2,7 MN/m³ → mínimo 5,4) e 40° acima do NA ≈ 275 lb/in³', () => {
    expect(apiSandK(28.8, false)).toBe(5400)
    expect(apiSandK(40, false) / 271.447).toBeGreaterThan(260)
    expect(apiSandK(40, false) / 271.447).toBeLessThan(300)
  })
  it('API areia: p → pu e inclinação inicial k·z', () => {
    const inp = { z: 3, B: 0.5, sigmaV: 30, phi: 32, k: 15000, loading: 'cyclic' as const }
    const small = pySand(inp, 1e-6)
    expect(small.Es).toBeCloseTo(15000 * 3, 0)
    const big = pySand(inp, 1)
    expect(big.p / (0.9 * big.pu)).toBeCloseTo(1, 6)
  })
  it('argila mole: p = 0,5·pu em y = yc; p = pu em y ≥ 8yc (estático); Np limitado a 9', () => {
    const inp = { z: 20, B: 0.5, sigmaV: 100, su: 25, epsC: 0.01, J: 0.5, loading: 'static' as const }
    const yc = 2.5 * 0.01 * 0.5
    const a = pySoftClay(inp, yc)
    expect(a.p / a.pu).toBeCloseTo(0.5, 9)
    expect(a.pu).toBeCloseTo(9 * 25 * 0.5, 9)
    expect(pySoftClay(inp, 8 * yc).p / a.pu).toBeCloseTo(1, 9)
  })
  it('argila mole cíclica: cai a 0,72·z/zr para y ≥ 15yc em z < zr; 0,72 para z ≥ zr', () => {
    const yc = 2.5 * 0.01 * 0.5
    const shallow = { z: 1, B: 0.5, sigmaV: 5, su: 25, epsC: 0.01, J: 0.5, loading: 'cyclic' as const }
    const r = pySoftClay(shallow, 20 * yc)
    expect(r.p / r.pu).toBeLessThan(0.72)
    const deep = { ...shallow, z: 30, sigmaV: 150 }
    const d = pySoftClay(deep, 20 * yc)
    expect(d.p / d.pu).toBeCloseTo(0.72, 9)
  })
  it('argila rija estática: contínua nos pontos de transição e positiva', () => {
    const inp = { z: 2, B: 0.6, su: 100, suAvg: 90, gammaAvg: 9, ks: 28 * 9806.65, kc: 11 * 9806.65, epsC: 0.005, loading: 'static' as const }
    const yc = 0.005 * 0.6
    const A = 0.55
    let prev = 0
    for (let k = 1; k <= 400; k++) {
      const y = (k / 400) * 25 * A * yc
      const p = pyStiffClay(inp, y).p
      expect(p).toBeGreaterThan(0)
      if (k > 1) expect(Math.abs(p - prev)).toBeLessThan(0.1 * pyStiffClay(inp, y).pu)
      prev = p
    }
  })
  it('argila rija cíclica: ramo final constante e positivo', () => {
    const inp = { z: 4, B: 0.6, su: 100, suAvg: 90, gammaAvg: 9, ks: 28 * 9806.65, kc: 11 * 9806.65, epsC: 0.005, loading: 'cyclic' as const }
    const a = pyStiffClay(inp, 0.5)
    const b = pyStiffClay(inp, 1.0)
    expect(a.p).toBeCloseTo(b.p, 9)
    expect(a.p).toBeGreaterThan(0)
  })
})

describe('p-y não linear com perfil derivado do SPT', () => {
  it('equilíbrio horizontal (Σp = H), P-Δ amplifica deslocamento e momento', async () => {
    const { buildLateralProfile } = await import('./soilProfile')
    const bh = {
      id: 'x',
      waterLevel: 2,
      layers: Array.from({ length: 20 }, (_, i) => ({
        depth: i + 1,
        nspt: i < 5 ? 2 : i < 10 ? 8 : 20,
        soil: (i < 5 ? 'argila' : i < 12 ? 'areia_siltosa' : 'silte_argiloso') as 'argila',
      })),
    }
    const prof = buildLateralProfile(bh)
    const run = (N: number) =>
      analyzeLateral({
        profile: prof, B: 0.5, EI: (0.8 * 26.8e6 * Math.PI * 0.5 ** 4) / 64, length: 15, topDepth: 0, H: 80, M: 0, N,
        head: { translation: 'free', rotation: 'free' }, loading: 'static',
      })
    const a = run(0)
    const dz = a.z[1] - a.z[0]
    const sum = a.p.reduce((s, p, i) => s + p * (i === 0 || i === a.p.length - 1 ? dz / 2 : dz), 0)
    expect(a.converged).toBe(true)
    expect(sum).toBeCloseTo(80, 1)
    const b = run(3000)
    expect(b.headDisplacement).toBeGreaterThan(a.headDisplacement)
    expect(b.maxMoment.value).toBeGreaterThan(a.maxMoment.value)
  })
})

describe('Comprimento equivalente de flambagem', () => {
  it('Le = π√(EI/Pcr): engastado-livre em 10 m → Le = 2L = 20 m', () => {
    const r = analyzeLateral({
      profile: profile(30, { nh: 1e11 }), B: 0.4, EI: 10_000, length: 10.5, topDepth: -10, H: 1, M: 0, N: 10,
      head: { translation: 'free', rotation: 'free' }, loading: 'static', elementLength: 0.05,
    })
    expect(Math.abs(r.bucklingLength / 20 - 1)).toBeLessThan(0.02)
  })
})

describe('Normal variável ao longo da estaca (axialShape)', () => {
  const mk = (shape?: (z: number) => number) => analyzeLateral({
    profile: profile(30, { nh: 1e11 }), B: 0.4, EI: 10_000, length: 10.5, topDepth: -10, H: 1, M: 0, N: 10,
    head: { translation: 'free', rotation: 'free' }, loading: 'static', elementLength: 0.05, axialShape: shape,
  }).criticalLoad
  it('forma constante 0,5 dobra a carga crítica do topo', () => {
    expect(mk(() => 0.5) / mk()).toBeCloseTo(2, 6)
  })
  it('normal que diminui com a profundidade: carga crítica do topo maior que a de N constante', () => {
    const p0 = mk()
    const p1 = mk((z) => Math.max(1 - z / 20, 0.2))
    expect(p1).toBeGreaterThan(p0)
  })
})

/**
 * Validação com exemplos e resultados publicados:
 *  - Campos (2015), cap. 11, Exemplo 2: reações nas cinco estacas (Ng = 985,8 kN; Nq = 540 kN; Mg = 88,14; Mq = 162 kN·m; I_E = 4,8 m²; e = 0,16 m);
 *  - Velloso & Lopes, §15 (Davisson e Robinson, 1965): flambagem de estaca totalmente enterrada em solo com k_h = n_h·z, topo livre: S_T = 1,8.
 */
import { describe, expect, it } from 'vitest'
import { analyzeGroup, type GroupInput, type GroupPile } from './group'
import { analyzeLateral, type LateralLayer, type LateralProfile } from './lateral'
import { buildLateralProfile } from './lateral'
import type { SptBorehole } from './soil'

const bh: SptBorehole = { id: 'F1', waterLevel: 3, layers: Array.from({ length: 25 }, (_, i) => ({ depth: i + 1, nspt: i < 4 ? 5 : 10, soil: 'areia_siltosa' as const })) }
const prof = buildLateralProfile(bh)
const pile = (id: string, x: number, y: number): GroupPile => ({ id, x, y, type: 'escavada', diameter: 0.4, length: 15, headFixity: 'articulada', profile: prof })

describe('Campos (2015), Exemplo 2 do cap. 11 — reações no estaqueamento', () => {
  // 3 estacas a 0,8 m do centro de gravidade e 2 estacas a 1,2 m: I_E = 3·0,8² + 2·1,2² = 4,8 m² (como no texto)
  const piles = [pile('E1', -0.8, -1), pile('E2', -0.8, 0), pile('E3', -0.8, 1), pile('E4', 1.2, -0.5), pile('E5', 1.2, 0.5)]
  const mk = (loads: Partial<GroupInput['loads']>): GroupInput => ({ piles, loads: { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, ...loads }, fck: 30, eiFactor: 0.8, topDepth: 0, loading: 'static', groupEffect: 'none' })
  const N = 985.8 + 540
  const M = 88.14 + 162
  it('momento de inércia do estaqueamento e excentricidade: I_E = 4,8 m²; e = M/N ≈ 0,16 m', () => {
    expect(piles.reduce((s, p) => s + p.x ** 2, 0)).toBeCloseTo(4.8, 9)
    expect(M / N).toBeCloseTo(0.164, 3)
  })
  it('carga excêntrica: P_i = N/n ± M·x_i/I_E (articuladas)', () => {
    const r = analyzeGroup(mk({ fz: N, my: M }))
    r.piles.forEach((p, i) => expect(p.axial).toBeCloseTo(N / 5 + (M * piles[i].x) / 4.8, 6))
    expect(Math.max(...r.piles.map((p) => p.axial))).toBeCloseTo(N / 5 + (M * 1.2) / 4.8, 6)
  })
  it('deslocando o bloco para fazer o CG coincidir com a carga (e = M/N), todas as estacas recebem N/5', () => {
    const r = analyzeGroup(mk({ fz: N, my: M - N * (M / N) }))
    r.piles.forEach((p) => expect(p.axial).toBeCloseTo(N / 5, 6))
  })
})

describe('Velloso & Lopes — flambagem de estaca em solo com k_h = n_h·z (Davisson e Robinson)', () => {
  const base: Omit<LateralLayer, 'top' | 'bottom'> = { soil: 'areia', nspt: 10, model: 'linear', gammaEff: 10, phi: 30, kSand: 0, su: 50, epsC: 0.01, J: 0.5, ks: 0, kc: 0, nh: 2000, belowWaterTable: true }
  const profile: LateralProfile = { layers: Array.from({ length: 60 }, (_, i) => ({ ...base, top: i, bottom: i + 1 })), warnings: [] }
  it('topo livre, J_T = 0: P_cr = π²EI/[4·T²·(S_T)²] com S_T ≈ 1,8 (±5 %; o modelo dá S_T ≈ 1,84)', () => {
    const EI = 50_000
    const T = (EI / 2000) ** 0.2
    const r = analyzeLateral({ profile, B: 0.5, EI, length: 40, topDepth: 0, H: 0.001, M: 0, N: 1, head: { translation: 'free', rotation: 'free' }, loading: 'static', elementLength: 0.1 })
    const pcrBook = (Math.PI ** 2 * EI) / (4 * T ** 2 * 1.8 ** 2)
    expect(Math.abs(r.criticalLoad / pcrBook - 1)).toBeLessThan(0.05)
    // comprimento equivalente de flambagem coerente com Le = π·√(EI/Pcr)
    expect(r.bucklingLength).toBeCloseTo(Math.PI * Math.sqrt(EI / r.criticalLoad), 9)
  })
})

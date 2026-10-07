import { describe, expect, it } from 'vitest'
import { aokiVelloso, decourtQuaresma, teixeira } from './capacity'
import { buildLateralProfile } from './lateral'
import { designStructural, effectiveT4 } from './structural/design'
import type { SptBorehole } from './soil'

const bh: SptBorehole = { id: 'F', waterLevel: 4, layers: Array.from({ length: 15 }, (_, i) => ({ depth: i + 1, nspt: 5 + i, soil: 'areia_siltosa' as const })) }
const pile = { type: 'helice' as const, diameter: 0.4 }

describe('Parâmetros editáveis chegam aos cálculos', () => {
  it('limite da ponta em % da lateral', () => {
    for (const f of [aokiVelloso, decourtQuaresma, teixeira]) {
      const r = f(bh, { pile, params: { tipLimitPct: 25 } }).rows.at(-1)!
      expect(r.Rp).toBeLessThanOrEqual(0.25 * r.Rl + 1e-9)
    }
  })
  it('desprezar atrito do último metro reduz a lateral', () => {
    for (const f of [aokiVelloso, decourtQuaresma, teixeira]) {
      const a = f(bh, { pile }).rows[9].Rl
      const b = f(bh, { pile, params: { ignoreLastMeter: true } }).rows[9].Rl
      expect(b).toBeLessThan(a)
    }
  })
  it('limites de N no fuste (AV e Teixeira)', () => {
    const a = aokiVelloso(bh, { pile }).rows[14].Rl
    const b = aokiVelloso(bh, { pile, params: { sptShaftLimits: { helice: { max: 8 } } } }).rows[14].Rl
    expect(b).toBeLessThan(a)
  })
  it('Su = fator·N e tabela 4 editada', () => {
    const l = buildLateralProfile({ id: 'A', waterLevel: 3, layers: [{ depth: 1, nspt: 4, soil: 'argila' }] }, { suFactor: 15 }).layers[0]
    expect(l.su).toBe(60)
    expect(effectiveT4('helice', 2, { fck: 35 })!.fck).toBe(35)
    expect(effectiveT4('helice', 2, { fck: 35 })!.gammaC).toBe(2.7)
  })
  it('taxa mínima de armadura maior exige mais aço', () => {
    const d = { z: [0, 1, 2], N: [500, 500, 500], M: [10, 5, 1], V: [5, 3, 1] }
    const base = designStructural({ type: 'helice', D: 0.4, L: 10, caa: 2, transverse: 'estribo', demands: d })
    const more = designStructural({ type: 'helice', D: 0.4, L: 10, caa: 2, transverse: 'estribo', demands: d, minRho: 0.01 })
    expect(more.longitudinal!.As).toBeGreaterThan(base.longitudinal!.As)
  })
  it('utilização de ponta/lateral e média dos métodos alteram a carga admissível da otimização', async () => {
    const { optimize, ZERO_COSTS } = await import('./optimize')
    const combo = (name: string, state: 'ELS' | 'ELU', fz: number) => ({ pillar: 'P', name, state, fx: 5, fy: 0, fz, mx: 0, my: 5, mz: 0 })
    const inp = { boreholes: [bh], pillar: { ax: 0.3, ay: 0.3 }, combos: [combo('a', 'ELS', 500), combo('b', 'ELU', 700)], types: ['helice' as const], diameters: { helice: [0.4] }, caa: 2 as const, transverse: 'estribo' as const, topDepth: 1, costs: { ...ZERO_COSTS, concretePerM3: 450 }, maxResults: 1, Lmin: 8, Lmax: 8, fixed: { length: 8 } }
    const padm = (extra: object) => optimize({ ...inp, ...extra }).best[0]?.service.padm
    const base = padm({})
    const media = padm({ capacityCombine: 'media' })
    const lat50 = padm({ shaftUsePct: 50 })
    expect(media).toBeGreaterThanOrEqual(base)
    expect(lat50).toBeLessThan(base)
  })
})

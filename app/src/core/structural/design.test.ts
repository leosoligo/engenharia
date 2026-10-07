import { describe, expect, it } from 'vitest'
import { COVER_SOIL, designStructural, table4, type Demands, type StructuralInput } from './design'

const z = Array.from({ length: 41 }, (_, i) => i * 0.25) // 0…10 m
const demands = (N: number, M0: number, V0: number): Demands => ({
  z,
  N: z.map(() => N),
  M: z.map((zz) => M0 * Math.exp(-zz / 2) * Math.cos(zz / 2.5)), // decai com a profundidade
  V: z.map((zz) => V0 * Math.exp(-zz / 2.5)),
})
const base = (over: Partial<StructuralInput> = {}): StructuralInput => ({
  type: 'helice', D: 0.5, L: 15, caa: 2, transverse: 'estribo', demands: demands(1200, 150, 70), ...over,
})

describe('NBR 6122:2022, Tab. 4', () => {
  it('valores conferidos na página', () => {
    expect(table4('helice', 2)).toMatchObject({ fck: 30, gammaC: 2.7, minArmedLength: 4, noRebarStress: 6 })
    expect(table4('helice', 3)).toMatchObject({ fck: 40, gammaC: 3.6 })
    expect(table4('escavada', 1)).toMatchObject({ fck: 25, gammaC: 3.1, minArmedLength: 2, noRebarStress: 5 })
    expect(table4('escavada', 4)).toMatchObject({ fck: 40, gammaC: 5.0 })
    expect(table4('escavada_fluido', 2)).toMatchObject({ fck: 30, gammaC: 2.7, minArmedLength: 4 })
    expect(table4('strauss', 1)).toMatchObject({ fck: 20, gammaC: 2.5 })
    expect(table4('franki', 3)).toMatchObject({ fck: 20, gammaC: 1.8, minArmedLength: 'integral' })
    expect(table4('raiz', 2)).toMatchObject({ fck: 20, gammaC: 1.6, minArmedLength: 'integral' })
    expect(table4('premoldada', 2)).toBeUndefined()
  })
  it('cobrimento NBR 6118:2026, Tab. 7.2 (contato com o solo)', () => {
    expect(COVER_SOIL).toEqual({ 1: 0.03, 2: 0.03, 3: 0.04, 4: 0.05 })
  })
})

describe('Dimensionamento estrutural', () => {
  it('caso corrente: viável, respeita taxas, bitolas e espaçamentos', () => {
    const r = designStructural(base())
    expect(r.feasible).toBe(true)
    const l = r.longitudinal!
    const Ac = (Math.PI * 0.5 ** 2) / 4
    expect(l.rho).toBeGreaterThanOrEqual(0.004 - 1e-9)
    expect(l.rho).toBeLessThanOrEqual(0.06 + 1e-9)
    expect(l.n).toBeGreaterThanOrEqual(6)
    expect(l.phiMm).toBeGreaterThanOrEqual(10)
    expect(l.phiMm).toBeLessThanOrEqual(500 / 8)
    expect(l.utilization).toBeLessThanOrEqual(1)
    expect(l.As).toBeCloseTo(l.rho * Ac, 9)
    const t = r.transverse!
    expect(t.phiMm).toBeGreaterThanOrEqual(5)
    expect(t.phiMm).toBeGreaterThanOrEqual(l.phiMm / 4 - 1e-9)
    for (const zn of t.zones) {
      expect(zn.spacing).toBeLessThanOrEqual(0.2 + 1e-9) // 18.4.3
      expect(zn.spacing).toBeLessThanOrEqual((12 * l.phiMm) / 1000 + 1e-9)
      expect(zn.spacing).toBeGreaterThanOrEqual(0.05)
    }
    // zonas contíguas e cobrindo todo o comprimento armado
    expect(t.zones[0].from).toBe(0)
    for (let i = 1; i < t.zones.length; i++) expect(t.zones[i].from).toBeCloseTo(t.zones[i - 1].to, 9)
    expect(t.zones[t.zones.length - 1].to).toBeCloseTo(r.cageLength!, 9)
    // comprimento armado ≥ mínimo da Tab. 4 (4 m para hélice)
    expect(r.cageLength!).toBeGreaterThanOrEqual(4)
    expect(r.weights!.totalKg).toBeGreaterThan(0)
  })
  it('mais momento exige mais armadura; momento enorme é inviável com mensagem', () => {
    const a = designStructural(base({ demands: demands(1200, 60, 40) }))
    const b = designStructural(base({ demands: demands(1200, 220, 40) }))
    expect(b.longitudinal!.As).toBeGreaterThan(a.longitudinal!.As)
    const c = designStructural(base({ demands: demands(1200, 5000, 40) }))
    expect(c.feasible).toBe(false)
    expect(c.reasons.join(' ')).toContain('Nenhuma armadura atende')
  })
  it('helicoidal e estribos usam o mesmo dimensionamento longitudinal; quantitativo transversal difere', () => {
    const e = designStructural(base({ transverse: 'estribo' }))
    const h = designStructural(base({ transverse: 'helicoidal' }))
    expect(h.longitudinal).toEqual(e.longitudinal)
    expect(h.weights!.transKg).not.toBeCloseTo(e.weights!.transKg, 3)
    expect(h.warnings.join(' ')).toContain('helicoidal')
  })
  it('Franki e raiz: armadura em todo o comprimento (Tab. 4: integral)', () => {
    const r = designStructural(base({ type: 'raiz', D: 0.31, demands: demands(300, 20, 15) }))
    expect(r.feasible).toBe(true)
    expect(r.cageLength).toBeCloseTo(15, 9)
  })
  it('pré-moldada: fora do escopo, com mensagem', () => {
    const r = designStructural(base({ type: 'premoldada' }))
    expect(r.feasible).toBe(false)
    expect(r.reasons.join(' ')).toContain('NBR 16258')
  })
  it('cortante grande exige estribos mais próximos', () => {
    const a = designStructural(base({ demands: demands(1200, 80, 30) }))
    const b = designStructural(base({ demands: demands(1200, 80, 250) }))
    const minS = (r: typeof a) => Math.min(...r.transverse!.zones.map((zn) => zn.spacing))
    expect(minS(b)).toBeLessThan(minS(a))
  })
})

describe('NBR 6122:2022, 8.6.3 — tensão N/A acima do limite da Tab. 4 exige armadura', () => {
  const D = 0.4 // A = 0,1257 m²; hélice: limite 6 MPa → 754 kN
  const mk = (N: (zz: number) => number) => ({ z, N: z.map(N), M: z.map(() => 5), V: z.map(() => 5) })
  it('normal constante acima do limite: armadura até a ponta', () => {
    const r = designStructural(base({ D, L: 10, demands: mk(() => 1500) }))
    expect(r.feasible).toBe(true)
    expect(r.cageLength).toBeCloseTo(10, 6)
  })
  it('normal que cai abaixo do limite: armadura só até onde N/A > 6 MPa (aqui 6 m)', () => {
    const r = designStructural(base({ D, L: 10, demands: mk((zz) => (zz <= 6 ? 1500 : 300)) }))
    expect(r.feasible).toBe(true)
    expect(r.sigmaDepth).toBeCloseTo(6, 6)
    expect(r.cageLength!).toBeGreaterThanOrEqual(6)
    expect(r.cageLength!).toBeLessThan(10)
  })
  it('coeficiente editável (Nd/1,4): dispensa armar onde Nd/A ≤ 1,4·limite', () => {
    const dem = mk(() => 1000) // 7,96 MPa de cálculo; 5,7 MPa em serviço
    const calc = designStructural(base({ D, L: 10, demands: dem }))
    const serv = designStructural(base({ D, L: 10, demands: dem, noRebarDivisor: 1.4 }))
    expect(calc.cageLength).toBeCloseTo(10, 6)
    expect(serv.cageLength!).toBeLessThan(10)
  })
})

describe('Motivo do comprimento da gaiola', () => {
  const z2 = Array.from({ length: 41 }, (_, i) => i * 0.25)
  it('informa quando o normal (tensão N/A) governa a gaiola', () => {
    const r = designStructural({ type: 'helice', D: 0.4, L: 10, caa: 2, transverse: 'estribo', demands: { z: z2, N: z2.map(() => 1500), M: z2.map(() => 5), V: z2.map(() => 5) } })
    expect(r.cageLength).toBeCloseTo(10, 6)
    expect(r.warnings.join(' ')).toMatch(/Comprimento da gaiola \(10,0 m\) governado por: (tensão N\/A|esforço normal)/)
  })
})

import { describe, expect, it } from 'vitest'
import { integralSigmaV, negativeFriction, NEG_BETA } from './negfriction'
import { softClaySection, softClayThickness } from './softsoil'
import { settlementOfGroup, soilModulus } from './settlement'
import type { SptBorehole } from '../soil'

const hole = (n: number, soil: 'argila_siltosa' | 'areia', nspt: number): SptBorehole => ({
  id: 'F1', layers: Array.from({ length: n }, (_, i) => ({ depth: i + 1, nspt, soil })),
})

describe('Atrito negativo (β·σ\'v, Velloso & Lopes §18.1)', () => {
  it('integral de σ\'v = γ z sem NA: ∫1→6 18 z dz = 315', () => {
    expect(integralSigmaV({ zNeutral: 6, beta: 0.25, gamma: 18, surcharge: 0 }, 1, 6)).toBeCloseTo(315, 9)
  })
  it('Qn = β·π·D·∫σ\'v: 0,25·π·0,4·315 = 98,96 kN', () => {
    expect(negativeFriction(0.4, 1, 10, { zNeutral: 6, beta: 0.25, gamma: 18, surcharge: 0 })).toBeCloseTo(0.25 * Math.PI * 0.4 * 315, 9)
  })
  it('com NA a 3 m a integral usa γ\' = γ − 9,81 abaixo do NA', () => {
    const v = integralSigmaV({ zNeutral: 6, beta: 0.25, gamma: 18, surcharge: 0, waterLevel: 3 }, 1, 6)
    expect(v).toBeCloseTo(72 + 3 * ((54 + (54 + 8.19 * 3)) / 2), 9)
  })
  it('sobrecarga q soma q·(b − a) à integral e o ponto neutro além da ponta é limitado à ponta', () => {
    const nf = { zNeutral: 30, beta: 0.2, gamma: 18, surcharge: 20 }
    expect(integralSigmaV(nf, 1, 6)).toBeCloseTo(315 + 20 * 5, 9)
    expect(negativeFriction(0.4, 1, 6, nf)).toBeCloseTo(0.2 * Math.PI * 0.4 * 415, 9)
  })
  it('β sugerido (Long e Healy, 1974)', () => {
    expect(NEG_BETA.argila).toEqual({ min: 0.2, max: 0.25 })
    expect(NEG_BETA.areia.max).toBe(0.5)
  })
})

describe('Argila mole (NBR 6122:2022, 8.6.5.1)', () => {
  it('espessura de argila com N ≤ 5 atravessada', () => {
    expect(softClayThickness([hole(12, 'argila_siltosa', 3)], 1, 8)).toBe(7)
    expect(softClayThickness([hole(12, 'argila_siltosa', 9)], 1, 8)).toBe(0)
    expect(softClayThickness([hole(12, 'areia', 3)], 1, 8)).toBe(0)
  })
  it('W ≥ 930 cm³ e i ≥ 5,4 / 6,4 cm', () => {
    expect(softClaySection(0.2, 10).ok).toBe(false) // W = 785 cm³
    expect(softClaySection(0.25, 25).ok).toBe(true) // i = 6,25 cm
    expect(softClaySection(0.2, 25).ok).toBe(false)
    expect(softClaySection(0.25, 32).ok).toBe(false) // i = 6,25 < 6,4
    expect(softClaySection(0.3, 32).ok).toBe(true)
  })
})

describe('Recalque de grupo (radier fictício, Teixeira e Godoy)', () => {
  it('E = α·K·N: argila siltosa N = 10 → 7·0,20·10 MPa = 14 MPa', () => {
    expect(soilModulus('argila_siltosa', 10)).toBeCloseTo(14000, 6)
    expect(soilModulus('areia', 20)).toBeCloseTo(3 * 0.9 * 20 * 1000, 6)
  })
  it('encurtamento elástico = P·L/(A·Ec)', () => {
    const r = settlementOfGroup({ boreholes: [hole(60, 'areia', 20)], topDepth: 1, L: 10, Bx: 1.2, By: 1.2, Q: 1000, Pmax: 500, D: 0.4, Ec: 2.5e7 })
    expect(r.elastic).toBeCloseTo((500 * 10) / ((Math.PI * 0.16) / 4 * 2.5e7), 9)
    expect(r.total).toBeCloseTo(r.raft + r.elastic, 12)
    expect(r.raftZ).toBeCloseTo(1 + (2 / 3) * 10, 9)
  })
  it('recalque do radier é inversamente proporcional a E e cresce com a carga', () => {
    const base = { boreholes: [hole(60, 'argila_siltosa', 8)], topDepth: 1, L: 12, Bx: 1.5, By: 1.5, Q: 1200, Pmax: 400, D: 0.4, Ec: 2.5e7 }
    const a = settlementOfGroup(base)
    const b = settlementOfGroup({ ...base, eFactor: 2 })
    const c = settlementOfGroup({ ...base, Q: 2400 })
    expect(a.raft / b.raft).toBeCloseTo(2, 9)
    expect(c.raft / a.raft).toBeCloseTo(2, 9)
    expect(a.raft).toBeGreaterThan(0)
  })
  it('radier na ponta recalca menos quando a camada mole fica acima da ponta', () => {
    const bh: SptBorehole = { id: 'F', layers: Array.from({ length: 60 }, (_, i) => ({ depth: i + 1, nspt: i + 1 >= 10 && i + 1 <= 11 ? 3 : 30, soil: 'argila_siltosa' as const })) }
    const base = { boreholes: [bh], topDepth: 1, L: 12, Bx: 1.5, By: 1.5, Q: 1200, Pmax: 400, D: 0.4, Ec: 2.5e7 }
    expect(settlementOfGroup({ ...base, raftDepth: 'ponta' }).raft).toBeLessThan(settlementOfGroup(base).raft)
  })
  it('sondagem curta é sinalizada', () => {
    const r = settlementOfGroup({ boreholes: [hole(10, 'areia', 20)], topDepth: 1, L: 12, Bx: 1.5, By: 1.5, Q: 1200, Pmax: 400, D: 0.4, Ec: 2.5e7 })
    expect(r.truncated).toBe(true)
  })
})

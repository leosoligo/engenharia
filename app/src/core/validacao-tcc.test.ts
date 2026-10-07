/**
 * Validação com um projeto publicado: Pacchioni, L. P. (2022), "Dimensionamento da fundação para um edifício de 17 pavimentos em
 * São José do Rio Preto (SP)", TCC, UNESP — Ilha Solteira. Estacas hélice contínua Ø70 cm (Aoki-Velloso; sondagem SP.03) e blocos
 * pelo roteiro das bielas de Blévot (apostila de Bastos). Valores das Tabelas 7, 9, 10, 12, 13, 15 e 16 do trabalho (kN/cm² → ×10 MPa).
 */
import { describe, expect, it } from 'vitest'
import { aokiVelloso } from './capacity'
import { machadoDesign } from './block/machado'
import { layoutsFor } from './group/layouts'
import { designStructural } from './structural/design'
import type { SptBorehole } from './soil'

const fyd = (500 / 1.15) * 1000 // kPa
const fcd = (35 / 1.4) * 1000
const deg = (r: number) => (r * 180) / Math.PI

describe('TCC Pacchioni (2022) — capacidade de carga de Aoki-Velloso, estaca hélice Ø70 (Tabela 7)', () => {
  const N = [2, 2, 2, 6, 6, 9, 34, 51, 28, 24, 20, 23, 16, 18, 20, 21, 18, 34, 60]
  const bh: SptBorehole = { id: 'SP.03', waterLevel: Infinity, layers: N.map((n, i) => ({ depth: i + 1, nspt: n, soil: i < 6 ? 'areia_argilosa' : i < 16 ? 'areia_siltoargilosa' : 'areia_siltosa' })) }
  const r = aokiVelloso(bh, { pile: { type: 'helice', diameter: 0.7 } })
  const Rp = { 7: 4579.66, 8: 6869.49, 9: 3771.48, 10: 3232.7, 11: 2693.92, 12: 3098.0, 13: 2155.13, 14: 2424.52, 15: 2693.92, 16: 2828.61, 17: 2770.88, 18: 5233.89 }
  it('resistência de ponta Rp = K·N/F1·A coincide em todas as profundidades da tabela', () => {
    for (const [z, v] of Object.entries(Rp)) expect(r.rows[+z - 1].Rp).toBeCloseTo(v, 1)
  })
  it('atrito lateral: o programa conta o trecho 6–7 m e usa N da base de cada metro; a tabela do trabalho omite 6–6,9 m e usa N do topo (diferença conhecida, menor que 11 % em Pult)', () => {
    const rl6 = r.rows[5].Rl
    const tccPult16 = 2141.89 + 2828.61
    const app16 = r.rows[15].Rl - rl6 + r.rows[15].Rp
    expect(app16 / tccPult16 - 1).toBeGreaterThan(0)
    expect(app16 / tccPult16 - 1).toBeLessThan(0.11)
  })
})

describe('TCC Pacchioni (2022) — blocos de 2 estacas (Tabelas 9 e 10): e = 2,10 m', () => {
  // [pilar, Nd kN, ap (na linha das estacas) m, bp m, d m, As cm², θ°, σ biela-pilar kN/cm², σ biela-estaca kN/cm²]
  const rows: [string, number, number, number, number, number, number, number, number][] = [
    ['P1', 3569.64, 1.4, 0.25, 0.88, 37.55, 51.5, 1.67, 0.76], ['P6', 3608.87, 1.4, 0.22, 0.88, 37.96, 51.5, 1.91, 0.77],
    ['P7', 2775.3, 1.05, 0.25, 1.08, 26.76, 53.9, 1.62, 0.55], ['P8', 4324.75, 1.0, 0.32, 1.08, 42.37, 53.47, 2.09, 0.87],
    ['P10', 4275.72, 1.8, 0.19, 0.78, 43.5, 52.43, 1.99, 0.88], ['P15', 2530.13, 1.05, 0.25, 1.08, 24.4, 53.9, 1.48, 0.5],
    ['P18', 4501.28, 1.8, 0.19, 0.78, 45.79, 52.43, 2.09, 0.93], ['P21', 4334.56, 1.0, 0.28, 1.1, 41.69, 53.97, 2.37, 0.86],
    ['P22', 2314.38, 1.05, 0.22, 1.08, 22.32, 53.9, 1.53, 0.46], ['P23', 3196.98, 1.4, 0.25, 0.98, 30.2, 54.46, 1.38, 0.63],
    ['P28', 3334.28, 1.4, 0.22, 0.98, 31.5, 54.46, 1.63, 0.65],
  ]
  for (const [p, N, ap, bp, d, As, th, sp, se] of rows) {
    it(`${p}: As (com +15 %), ângulo e tensões das bielas`, () => {
      const piles = layoutsFor(2, 2.1)[0].points
      const m = machadoDesign({ piles, pillar: { ax: ap, ay: bp }, dE: 0.7, d, Pmax: [N / 2, N / 2], fyd, fcd, kr: 0.9 })!
      expect(m.kind).toBe('2')
      expect(m.groups[0].AsReq).toBeCloseTo(As, 1)
      expect(deg(m.theta)).toBeCloseTo(th, 1)
      expect(m.checks[0].value / 10_000).toBeCloseTo(sp, 1)
      expect(m.checks[1].value / 10_000).toBeCloseTo(se, 1)
      expect(m.AsSupPerDir).toBeCloseTo(0.2 * As, 1) // armadura superior = 0,2·As (Tabela 10)
    })
  }
})

describe('TCC Pacchioni (2022) — blocos de 4 estacas (Tabelas 15 e 16): e = 2,10 m, d = 1,68 m', () => {
  // [pilar, Nd, ap, bp, As,lado cm², θ°, σ biela-pilar kN/cm²]
  const rows: [string, number, number, number, number, number, number][] = [
    ['P3', 6884.303, 1.29, 0.3, 21.11, 53.02, 2.79], ['P4', 6874.497, 1.29, 0.3, 21.08, 53.02, 2.78], ['P5', 8561.249, 2.04, 0.3, 25.08, 54.27, 2.12],
    ['P24', 8610.283, 2.04, 0.3, 25.23, 54.27, 2.13], ['P25', 7129.471, 1.29, 0.3, 21.87, 53.02, 2.89], ['P26', 6992.177, 1.29, 0.3, 21.44, 53.02, 2.83],
    ['P27', 8826.03, 2.04, 0.3, 25.86, 54.27, 2.19],
  ]
  for (const [p, N, ap, bp, As, th, sp] of rows) {
    it(`${p}: As,lado = Nd(2e − ap)/(16·d·fyd), ângulo e tensão biela-pilar`, () => {
      const piles = layoutsFor(4, 2.1)[0].points
      const aeq = Math.sqrt(ap * bp)
      const m = machadoDesign({ piles, pillar: { ax: aeq, ay: aeq }, dE: 0.7, d: 1.68, Pmax: [N / 4, N / 4, N / 4, N / 4], fyd, fcd, kr: 0.9 })!
      expect(m.kind).toBe('4')
      const side = m.groups.find((g) => g.role === 'side')!
      expect(Math.abs(side.AsReq / As - 1)).toBeLessThan(0.006) // o trabalho arredonda ap equivalente a 2 casas
      expect(deg(m.theta)).toBeCloseTo(th, 1)
      expect(m.checks[0].value / 10_000).toBeCloseTo(sp, 1)
    })
  }
})

describe('TCC Pacchioni (2022) — blocos de 3 estacas (Tabelas 12 e 13): e = 2,10 m, d = 1,38 m', () => {
  // [pilar, Nd, ap, bp, d, As,lado do trabalho, θ°, σ biela-pilar]
  const rows: [string, number, number, number, number, number, number, number][] = [
    ['P9', 5481.95, 1.8, 0.22, 1.38, 26.1, 53.43, 2.15], ['P11', 5266.2, 1.8, 0.22, 1.38, 25.07, 53.43, 2.06], ['P12', 5805.57, 1.49, 0.28, 1.38, 27.55, 53.57, 2.15],
    ['P13', 4628.76, 1.0, 0.28, 1.38, 22.48, 52.64, 2.62], ['P16', 4609.15, 1.0, 0.32, 1.38, 22.23, 52.93, 2.26], ['P17', 6188.03, 1.49, 0.28, 1.28, 29.06, 51.49, 2.42],
    ['P19', 5452.53, 1.8, 0.22, 1.38, 25.96, 53.43, 2.13], ['P20', 5462.33, 1.8, 0.22, 1.38, 26.01, 53.43, 2.14],
  ]
  for (const [p, N, ap, bp, d, AsTcc, th, sp] of rows) {
    it(`${p}: ângulo e tensão da biela coincidem; As,lado do programa = fórmula correta do roteiro`, () => {
      const piles = layoutsFor(3, 2.1)[0].points
      const aeq = Math.sqrt(ap * bp)
      const m = machadoDesign({ piles, pillar: { ax: aeq, ay: aeq }, dE: 0.7, d, Pmax: [N / 3, N / 3, N / 3], fyd, fcd, kr: 0.9 })!
      expect(m.kind).toBe('3')
      expect(deg(m.theta)).toBeCloseTo(th, 1)
      expect(m.checks[0].value / 10_000).toBeCloseTo(sp, 1)
      // roteiro de Bastos: R_s = N(e√3 − 0,9·ap)/(9d); As,lado = R_s/(√3·fyd)
      const e = 2.1
      const Rs = (N * (e * Math.sqrt(3) - 0.9 * aeq)) / (9 * d)
      const AsOk = (Rs / (Math.sqrt(3) * fyd)) * 1e4
      const side = m.groups.find((g) => g.role === 'side')!
      expect(Math.abs(side.AsReq / AsOk - 1)).toBeLessThan(0.005)
      // o trabalho obtém seus valores com (e√3 − 0,9·ap/d), isto é, dividindo só ap por d: reproduz a tabela e supera o roteiro em 33 % a 45 %, conforme d
      const RsTcc = (N / 9) * (e * Math.sqrt(3) - (0.9 * aeq) / d)
      const AsTccCalc = (RsTcc / (Math.sqrt(3) * fyd)) * 1e4
      expect(Math.abs(AsTccCalc / AsTcc - 1)).toBeLessThan(0.006)
      expect(AsTcc / side.AsReq).toBeGreaterThan(1.3)
    })
  }
})

describe('TCC Pacchioni (2022) — armadura da estaca hélice Ø70 (item 5.1.2): 13 Ø12,5 em 4 m', () => {
  const z = Array.from({ length: 39 }, (_, i) => i * 0.25)
  const dem = { z, N: z.map(() => 2450), M: z.map(() => 2), V: z.map(() => 2) }
  it('com a tensão N/A tomada na carga de serviço (coeficiente 1,4) o programa reproduz 13 Ø12,5 (15,95 cm²) e gaiola de 4 m', () => {
    const r = designStructural({ type: 'helice', D: 0.7, L: 9.5, caa: 2, transverse: 'estribo', noRebarDivisor: 1.4, demands: dem })
    expect(r.feasible).toBe(true)
    expect(r.longitudinal!.n).toBe(13)
    expect(r.longitudinal!.phiMm).toBe(12.5)
    expect(r.longitudinal!.As * 1e4).toBeCloseTo(15.95, 1)
    expect(r.cageLength).toBeCloseTo(4, 6)
    expect(r.transverse!.zones[0].spacing).toBeCloseTo(0.15, 6) // 12·φ = 15 cm
  })
  it('padrão do programa (N/A com a carga de cálculo, coeficiente 1,0): mais conservador, gaiola em todo o comprimento', () => {
    const r = designStructural({ type: 'helice', D: 0.7, L: 9.5, caa: 2, transverse: 'estribo', demands: dem })
    expect(r.cageLength).toBeCloseTo(9.5, 6)
  })
})

describe('Pilar mais largo que o espaçamento das estacas (P2 do TCC: 204 × 30 cm sobre 4 estacas Ø70)', () => {
  it('a verificação de cortante S2 do CEB-70 não gera limite absurdo quando as estacas ficam sob o pilar', async () => {
    const { designBlock } = await import('./block')
    const piles = layoutsFor(4, 2.1)[0].points
    const r = designBlock({ piles, dE: 0.7, pillar: { ax: 2.04, ay: 0.3 }, fckBlock: 35, caa: 2, combos: [{ name: 'U', P: [2047, 2047, 2047, 2047], Nsd: 8188 }], method: 'flexao' } as never)
    const s2 = r.checks.filter((k) => k.name.includes('S2'))
    for (const k of s2) expect(k.limit).toBeGreaterThan(500) // kN
    expect(r.reasons.join(' ')).not.toContain('S2')
  })
})

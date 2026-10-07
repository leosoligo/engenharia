import { describe, expect, it } from 'vitest'
import { aokiVelloso, decourtQuaresma, teixeira, admissibleLoad, xiFactors } from './index'
import type { SptBorehole } from '../soil'

/** Perfil e estaca da planilha "Capacidade Carga Estacas-SPT 12.xls" (pré-moldada, D = 40 cm, L = 8 m). */
const borehole: SptBorehole = {
  id: 'planilha',
  layers: [
    { depth: 1, nspt: 7, soil: 'argila_arenosa' },
    { depth: 2, nspt: 8, soil: 'argila_siltosa' },
    { depth: 3, nspt: 8, soil: 'areia_siltosa' },
    { depth: 4, nspt: 7, soil: 'areia_siltosa' },
    { depth: 5, nspt: 9, soil: 'areia_siltosa' },
    { depth: 6, nspt: 16, soil: 'argila_siltosa' },
    { depth: 7, nspt: 19, soil: 'argila_siltosa' },
    { depth: 8, nspt: 25, soil: 'argila_siltosa' },
  ],
}
const pile = { type: 'premoldada' as const, diameter: 0.4 }

describe('Aoki-Velloso × planilha', () => {
  const r = aokiVelloso(borehole, { pile })
  // valores da aba "Aoki-Velloso" da planilha (kN)
  const ref = [
    { depth: 1, Rp: 205.25072003453317, Rl: 24.63008640414398 },
    { depth: 2, Rp: 147.44541520848097, Rl: 54.11916944584017 },
    { depth: 3, Rp: 536.1651462126581, Rl: 107.73568406710596 },
    { depth: 4, Rp: 469.14450293607587, Rl: 154.65013436071354 },
    { depth: 5, Rp: 603.1857894892404, Rl: 214.96871330963756 },
    { depth: 6, Rp: 294.89083041696193, Rl: 273.94687939303 },
    { depth: 7, Rp: 350.18286112014226, Rl: 343.98345161705845 },
    { depth: 8, Rp: 460.76692252650304, Rl: 436.13683612235906 },
  ]
  it.each(ref)('profundidade $depth m', ({ depth, Rp, Rl }) => {
    const row = r.rows.find((x) => x.depth === depth)!
    expect(row.Rp).toBeCloseTo(Rp, 6)
    expect(row.Rl).toBeCloseTo(Rl, 6)
    expect(row.R).toBeCloseTo(Rp + Rl, 6)
  })
})

describe('Décourt-Quaresma (cálculo manual, fórmula do livro)', () => {
  it('pré-moldada, ponta em 8 m', () => {
    const r = decourtQuaresma(borehole, { pile }).rows.find((x) => x.depth === 8)!
    // Np = (19 + 25)/2 = 22 (só há 2 valores: 7 m e 8 m); argila siltosa → C = 120 kPa; α = 1
    const Ap = Math.PI * 0.4 ** 2 / 4
    expect(r.Rp).toBeCloseTo(1 * 120 * 22 * Ap, 6)
    // fuste: profundidades 1…6 (7 e 8 pertencem à ponta); N limitados a 3…50
    const nl = (7 + 8 + 8 + 7 + 9 + 16) / 6
    expect(r.Rl).toBeCloseTo(1 * 10 * (nl / 3 + 1) * Math.PI * 0.4 * 8, 6)
  })
})

describe('Teixeira (cálculo manual, fórmula do livro)', () => {
  it('pré-moldada, ponta em 8 m', () => {
    const r = teixeira(borehole, { pile }).rows.find((x) => x.depth === 8)!
    // janela [8 − 1,6 ; 8 + 0,4] → profundidades 7 e 8; α = 110 (argila siltosa, pré-moldada); β = 4
    const Ap = Math.PI * 0.4 ** 2 / 4
    expect(r.Rp).toBeCloseTo(110 * ((19 + 25) / 2) * Ap, 6)
    const nl = (7 + 8 + 8 + 7 + 9 + 16 + 19 + 25) / 8
    expect(r.Rl).toBeCloseTo(4 * nl * Math.PI * 0.4 * 8, 6)
  })
})

describe('NBR 6122:2022 — segurança', () => {
  it('ξ da Tabela 2', () => {
    expect(xiFactors(1)).toEqual({ xi1: 1.42, xi2: 1.42 })
    expect(xiFactors(12)).toEqual({ xi1: 1.27, xi2: 1.11 })
    expect(() => xiFactors(8)).toThrow()
  })
  it('um furo: Rk = R/1,42; conservador = R/2,0', () => {
    const { Rk, Padm } = admissibleLoad([1000])
    expect(Rk).toBeCloseTo(1000 / 1.42, 9)
    expect(Padm).toBeCloseTo(500, 9)
    expect(admissibleLoad([1000], { mode: 'nbr-admissivel' }).Padm).toBeCloseTo(1000 / 1.42 / 1.4, 9)
  })
})

describe('parâmetros editáveis e conjuntos de coeficientes', () => {
  it('Strauss usa por padrão o conjunto completo de Monteiro (1997)', () => {
    const r = aokiVelloso(borehole, { pile: { type: 'strauss', diameter: 0.4 } })
    const Ap = Math.PI * 0.4 ** 2 / 4
    // 1 m: argila arenosa, k = 4,4 kgf/cm² = 440 kPa, N = 7, F1 = 4,2
    expect(r.rows[0].Rp).toBeCloseTo((440 * 7 * Ap) / 4.2, 6)
    expect(r.warnings.join(' ')).toContain('Monteiro')
  })
  it('conjunto que não cobre o tipo recai no padrão e avisa', () => {
    const r = aokiVelloso(borehole, { pile: { type: 'helice', diameter: 0.4 }, params: { avSet: 'laprovitera' } })
    expect(r.warnings.join(' ')).toContain('não cobre')
  })
  it('sobrescrita de K altera o resultado e gera aviso', () => {
    const base = aokiVelloso(borehole, { pile })
    const ed = aokiVelloso(borehole, { pile, params: { avSoil: { argila_arenosa: { K: 700 } } } })
    expect(ed.rows[0].Rp).toBeCloseTo(base.rows[0].Rp * 2, 6)
    expect(ed.warnings.join(' ')).toContain('editados')
    expect(base.warnings.join(' ')).not.toContain('editados')
  })
})

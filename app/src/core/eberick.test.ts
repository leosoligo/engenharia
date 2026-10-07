import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readXlsx } from './xlsx'
import { DEFAULT_EBERICK, criticalIndexes, matchSections, parseEberick, parseEberickSections, toCombinations } from './eberick'

const file = resolve(__dirname, '../../../samples/Fundacao_Combinacoes.xlsx')
const rows = readXlsx(new Uint8Array(readFileSync(file)))
const p = parseEberick(rows)

describe('Importação do relatório de fundações do Eberick', () => {
  it('lê os 20 elementos, 13 casos simples e 26+ combinações cada', () => {
    expect(p.foundations).toHaveLength(20)
    expect(p.foundations[0].name).toBe('B1')
    expect(p.foundations[0].cases).toHaveLength(13)
    expect(p.foundations[0].combos.length).toBeGreaterThanOrEqual(26)
    expect(p.warnings).toEqual([])
  })
  it('converte unidades: tf → kN e kgf·m → kN·m', () => {
    const g1 = p.foundations[0].cases[0] // Peso próprio (G1): N 1,27 tf; Mx 55,03 kgf.m; Vx 0,07 tf
    expect(g1.N).toBeCloseTo(1.27 * 9.80665, 6)
    expect(g1.Mx).toBeCloseTo(55.03 * 0.00980665, 6)
    expect(g1.Vx).toBeCloseTo(0.07 * 9.80665, 6)
  })
  it('combinações críticas: poucas, incluem N máx. e momento máx.; ELU = γf × ELS', () => {
    const f = p.foundations[1]
    const idx = criticalIndexes(f.combos)
    expect(idx.length).toBeGreaterThanOrEqual(3)
    expect(idx.length).toBeLessThanOrEqual(9)
    const nmax = f.combos.reduce((b, r, i) => (r.N > f.combos[b].N ? i : b), 0)
    expect(idx).toContain(nmax)
    const lc = toCombinations({ foundations: [f], warnings: [] }, DEFAULT_EBERICK)
    const els = lc.filter((c) => c.state === 'ELS'), elu = lc.filter((c) => c.state === 'ELU')
    expect(els.length).toBe(idx.length)
    expect(elu[0].fz).toBeCloseTo(els[0].fz * 1.4, 9)
    expect(lc.every((c) => c.pillar === 'B2')).toBe(true)
  })
  it('opção "todas" e inversão de sinais', () => {
    const f = p.foundations[0]
    const all = toCombinations({ foundations: [f], warnings: [] }, { ...DEFAULT_EBERICK, select: 'todas', gammaF: 0, invertMx: true })
    expect(all).toHaveLength(f.combos.length)
    expect(all[0].mx).toBeCloseTo(-f.combos[0].Mx, 9)
  })
  it('relatório de cargas: seções e associação B1…B20 ↔ P1…P20 pela carga máxima', () => {
    const r = parseEberickSections(readXlsx(new Uint8Array(readFileSync(resolve(__dirname, '../../../samples/Projeto_CargasFundacao.xlsx')))))
    expect(r.warnings).toEqual([])
    expect(r.sections).toHaveLength(20)
    expect(r.sections[0]).toMatchObject({ name: 'P1', a: 14, b: 30 })
    expect(r.sections[0].Nmax).toBeCloseTo(4.03 * 9.80665, 4)
    expect(r.sections[17]).toMatchObject({ a: 150, b: 60 })
    expect(r.sections[18].a).toBeUndefined() // P19 sem seção no relatório
    const m = matchSections(p, r.sections)
    expect(Object.entries(m).every(([b, pn]) => pn === b.replace('B', 'P'))).toBe(true)
  })
})

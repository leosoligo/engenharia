import { describe, expect, it } from 'vitest'
import { parseSptCsv, SPT_CSV_TEMPLATE, sptToCsv } from './sptCsv'

describe('parseSptCsv', () => {
  it('lê o modelo com dois furos e NA', () => {
    const r = parseSptCsv(SPT_CSV_TEMPLATE)
    expect(r.errors).toEqual([])
    expect(r.boreholes.map((b) => b.id)).toEqual(['SP-01', 'SP-02'])
    expect(r.boreholes[0].layers).toHaveLength(3)
    expect(r.boreholes[0].layers[0]).toEqual({ depth: 1, nspt: 7, soil: 'argila_arenosa' })
    expect(r.boreholes[0].waterLevel).toBe(3)
    expect(r.boreholes[1].waterLevel).toBe(2.5)
  })
  it('aceita vírgula como separador, ordem livre de colunas, acentos e BOM', () => {
    const r = parseSptCsv('﻿Solo,NSPT,Profundidade,Furo\nSilte argiloarenoso,12,1,A\nareia_siltosa,14,2,A')
    expect(r.errors).toEqual([])
    expect(r.boreholes[0].layers.map((l) => l.soil)).toEqual(['silte_argiloarenoso', 'areia_siltosa'])
  })
  it('reporta erros com número de linha e descarta furo com lacuna', () => {
    const r = parseSptCsv('furo;profundidade;nspt;solo\nA;1;5;Areia\nA;3;5;Areia\nB;1;x;Areia\nB;1;5;Lama')
    expect(r.boreholes).toEqual([])
    expect(r.errors.some((e) => e.includes('consecutivas'))).toBe(true)
    expect(r.errors.some((e) => e.startsWith('Linha 4'))).toBe(true)
    expect(r.errors.some((e) => e.startsWith('Linha 5') && e.includes('solo'))).toBe(true)
  })
  it('NA "não encontrado" vira Infinity e NA inválido gera erro', () => {
    const r = parseSptCsv(['furo;profundidade;nspt;solo;na', 'A;1;5;Areia;não encontrado', 'B;1;5;Areia;abc'].join('\n'))
    expect(r.boreholes.find((b) => b.id === 'A')?.waterLevel).toBe(Infinity)
    expect(r.errors.some((e) => e.includes('nível d'))).toBe(true)
  })
  it('exige as colunas obrigatórias', () => {
    expect(parseSptCsv('furo;nspt\nA;3').errors.length).toBeGreaterThan(0)
  })
})

describe('sptToCsv', () => {
  it('exporta e reimporta as sondagens sem perda (inclui NA e "não encontrado")', () => {
    const r = parseSptCsv(SPT_CSV_TEMPLATE)
    const extra = [...r.boreholes, { id: 'X', waterLevel: Infinity, layers: [{ depth: 1, nspt: 5, soil: 'areia' as const }, { depth: 2, nspt: 7, soil: 'argila_siltosa' as const }] }]
    const back = parseSptCsv(sptToCsv(extra))
    expect(back.errors).toEqual([])
    expect(back.boreholes).toEqual(extra)
  })
})

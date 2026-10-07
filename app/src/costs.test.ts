import { describe, expect, it } from 'vitest'
import { baseline, cutOffRange, execKey, resolveCosts, UF_LIST } from './costs'
import { SINAPI } from './data/sinapi'
import { DEFAULT_SETTINGS } from './settings'

const area = (dcm: number) => (Math.PI * (dcm / 100) ** 2) / 4
const types = ['helice', 'escavada', 'escavada_fluido', 'strauss', 'franki', 'raiz'] as const
const diam = { ...DEFAULT_SETTINGS.diameters, helice: [30, 40, 50, 110], escavada: [25, 40], raiz: [31], strauss: [32], escavada_fluido: [80], franki: [40] }

describe('Dados do SINAPI (extração)', () => {
  it('cobre as 27 UFs nos dois regimes, com os itens principais', () => {
    expect(UF_LIST).toHaveLength(27)
    for (const reg of ['nao', 'des'] as const)
      for (const { uf } of UF_LIST) {
        const e = SINAPI.regimes[reg][uf]
        expect(e, `${reg}/${uf}`).toBeDefined()
        for (const k of ['concrete', 'steelPile', 'steelBlock', 'blockConcrete', 'blockForm', 'lean'] as const) expect(e[k], `${reg}/${uf}/${k}`).toBeGreaterThan(0)
        expect(Object.keys(e.pile.helice ?? {}).length).toBeGreaterThan(0)
      }
  })
  it('valores conferidos na planilha (SP, sem desoneração, 08/2026)', () => {
    const sp = SINAPI.regimes.nao.SP
    expect(sp.pile.helice!['50']).toBe(217.35)
    expect(sp.concrete).toBe(553.97)
    expect(sp.steelPile).toBe(7.92)
    expect(sp.blockConcrete).toBe(710.11)
    expect(sp.cutOff['40']).toBe(25.26)
    expect(SINAPI.reference).toBe('08/2026')
  })
})

describe('Custos-base', () => {
  it('execução + concreto teórico reproduz a composição SINAPI (hélice Ø50, SP)', () => {
    const b = baseline({ kind: 'sinapi', uf: 'SP', regime: 'nao' }, [...types], diam)
    const exec = b.costs.executionPerM[execKey('helice', 50)]
    expect(exec + area(50) * b.costs.concretePerM3).toBeCloseTo(217.35, 1)
    expect(b.estimated.has(execKey('helice', 50))).toBe(false)
  })
  it('diâmetro sem composição é estimado: interpolado dentro da faixa e escalado pela área fora dela', () => {
    const b = baseline({ kind: 'sinapi', uf: 'SP', regime: 'nao' }, [...types], diam)
    expect(b.estimated.has(execKey('helice', 40))).toBe(true)
    const total = (d: number) => b.costs.executionPerM[execKey('helice', d)] + area(d) * b.costs.concretePerM3
    expect(total(40)).toBeGreaterThan(114.47)
    expect(total(40)).toBeLessThan(217.35)
    // Ø110 > maior composição (90): escala pela área a partir de Ø90
    expect(total(110)).toBeCloseTo(540.67 * (area(110) / area(90)), 1)
  })
  it('tipos sem custo no SINAPI são sinalizados e ficam sem execução', () => {
    const b = baseline({ kind: 'sinapi', uf: 'SP', regime: 'nao' }, [...types], diam)
    expect(b.missingTypes.sort()).toEqual(['escavada_fluido', 'franki', 'strauss'])
    expect(b.costs.executionPerM[execKey('strauss', 32)]).toBeUndefined()
  })
  it('UF e regime mudam os valores', () => {
    const sp = baseline({ kind: 'sinapi', uf: 'SP', regime: 'nao' }, ['helice'], diam).costs
    const ac = baseline({ kind: 'sinapi', uf: 'AC', regime: 'nao' }, ['helice'], diam).costs
    const spd = baseline({ kind: 'sinapi', uf: 'SP', regime: 'des' }, ['helice'], diam).costs
    expect(ac.concretePerM3).not.toBe(sp.concretePerM3)
    expect(spd.steelPerKg).not.toBe(sp.steelPerKg)
  })
  it('modo manual parte de zero; sobrescritas prevalecem sobre o SINAPI', () => {
    const z = baseline({ kind: 'manual', uf: 'SP', regime: 'nao' }, ['helice'], diam).costs
    expect(z.concretePerM3).toBe(0)
    const r = resolveCosts({ kind: 'sinapi', uf: 'SP', regime: 'nao' }, ['helice'], diam, { concretePerM3: 500, executionPerM: { [execKey('helice', 50)]: 123 }, extras: [{ name: 'x', basis: 'porBloco', value: 10 }] })
    expect(r.concretePerM3).toBe(500)
    expect(r.executionPerM[execKey('helice', 50)]).toBe(123)
    expect(r.executionPerM[execKey('helice', 30)]).toBeGreaterThan(0) // mantém o SINAPI nos demais
    expect(r.extras).toHaveLength(1)
    expect(r.steelPerKg).toBe(7.92)
  })
  it('arrasamento por faixa de diâmetro', () => {
    expect([30, 40, 41, 60, 61, 80, 100, 101].map(cutOffRange)).toEqual(['40', '40', '60', '60', '80', '80', '100', '150'])
  })
})

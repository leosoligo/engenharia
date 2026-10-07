import { describe, expect, it } from 'vitest'
import { buildInput } from './buildInput'
import { exampleProject } from './project'
import { DEFAULT_SETTINGS } from '../settings'

describe('Comprimento da estaca e profundidade da sondagem', () => {
  const project = exampleProject() // SP-01 com 30 m
  it('automático: usa Lmín e Lmáx', () => {
    const r = buildInput(project, DEFAULT_SETTINGS, 'P1')
    expect(r.input?.Lmin).toBe(DEFAULT_SETTINGS.Lmin)
    expect(r.input?.fixed?.length).toBeUndefined()
  })
  it('fixo: trava o comprimento e rejeita o que excede a sondagem', () => {
    const ok = buildInput(project, { ...DEFAULT_SETTINGS, lengthMode: 'fixo', lengthFixed: 12 }, 'P1')
    expect(ok.input?.fixed?.length).toBe(12)
    expect(ok.input?.Lmax).toBe(12)
    const bad = buildInput(project, { ...DEFAULT_SETTINGS, lengthMode: 'fixo', lengthFixed: 30 }, 'P1')
    expect(bad.error).toContain('excede a sondagem')
  })
})

describe('unitText', () => {
  it('converte kN e kN·m para tf; mantém kN/m³ e não mexe em kN', async () => {
    const { unitText, unitsOf } = await import('./units')
    expect(unitText('Qn = 98,1 kN por estaca; M = 49,03 kN·m; γ = 18 kN/m³', unitsOf('tf'))).toBe('Qn = 10,0 tf por estaca; M = 5,00 tf·m; γ = 18 kN/m³')
    expect(unitText('100 kN', unitsOf('kN'))).toBe('100 kN')
  })
})

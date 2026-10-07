import { describe, expect, it } from 'vitest'
import { joinPillars } from './join'
import { designBlock, type BlockInput } from './block'
import { layoutsFor } from './group/layouts'
import type { LoadCombination } from './loads'

const c = (pillar: string, name: string, state: 'ELS' | 'ELU', v: Partial<LoadCombination>): LoadCombination => ({ pillar, name, state, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0, ...v })

describe('União de dois pilares num bloco', () => {
  it('pilares simétricos com cargas iguais: sem momento adicional e origem no meio', () => {
    const r = joinPillars('A+B', { name: 'A', x: -1, y: 0, ax: 40, ay: 40 }, { name: 'B', x: 1, y: 0, ax: 40, ay: 40 }, [c('A', 'G', 'ELS', { fz: 100 }), c('B', 'G', 'ELS', { fz: 100 })])
    expect(r.origin).toEqual({ x: 0, y: 0 })
    expect(r.combos).toHaveLength(1)
    expect(r.combos[0]).toMatchObject({ pillar: 'A+B', fz: 200, mx: 0, my: 0, mz: 0 })
    expect(r.ax).toBeCloseTo(240, 6) // 2 m entre centros + 40 cm
    expect(r.ay).toBeCloseTo(40, 6)
    expect(r.areaCm2).toBe(3200)
  })
  it('cargas diferentes: My = Σ x_i·Fz_i em torno do centro da caixa (carga mais perto do pilar mais carregado)', () => {
    const r = joinPillars('A+B', { name: 'A', x: 0, y: 0, ax: 40, ay: 40 }, { name: 'B', x: 3, y: 0, ax: 40, ay: 40 }, [c('A', 'G', 'ELS', { fz: 300 }), c('B', 'G', 'ELS', { fz: 100 })])
    expect(r.origin.x).toBeCloseTo(1.5, 9)
    // centro de carga em x = 0,75 m: excentricidade −0,75 m em relação à origem → My = −300 kN·m
    expect(r.combos[0].fz).toBe(400)
    expect(r.combos[0].my).toBeCloseTo(-300, 9)
    expect(r.combos[0].mx).toBeCloseTo(0, 9)
  })
  it('em Y: Mx = −Σ y_i·Fz_i; forças horizontais geram Mz = Σ(x·Fy − y·Fx) e momentos próprios se somam', () => {
    const r = joinPillars('A+B', { name: 'A', x: 0, y: 0, ax: 30, ay: 30 }, { name: 'B', x: 0, y: 2, ax: 30, ay: 30 }, [
      c('A', 'V', 'ELU', { fz: 100, fx: 10, mx: 5, my: 1, mz: 2 }), c('B', 'V', 'ELU', { fz: 300, fx: 20, mx: 7, my: 3, mz: 4 }),
    ])
    expect(r.origin.y).toBeCloseTo(1, 9)
    // A em y = −1, B em y = +1
    expect(r.combos[0].mx).toBeCloseTo(5 + 7 - (-1 * 100 + 1 * 300), 9)
    expect(r.combos[0].my).toBeCloseTo(4, 9)
    expect(r.combos[0].mz).toBeCloseTo(6 - (-1 * 10 + 1 * 20), 9)
    expect(r.combos[0].fx).toBe(30)
  })
  it('combinações sem correspondente e pilares sobrepostos geram aviso', () => {
    const r = joinPillars('A+B', { name: 'A', x: 0, y: 0, ax: 40, ay: 40 }, { name: 'B', x: 0.1, y: 0, ax: 40, ay: 40 }, [c('A', 'G', 'ELS', { fz: 1 }), c('A', 'Vento', 'ELS', { fz: 1 }), c('B', 'G', 'ELS', { fz: 1 })])
    expect(r.combos).toHaveLength(1)
    expect(r.warnings.join(' ')).toContain('sobrepõem')
    expect(r.warnings.join(' ')).toContain('Vento')
  })
  it('bloco com área total menor que a caixa: tensão na biela do pilar usa a área total (maior)', () => {
    const piles = layoutsFor(4, 1.6)[0].points
    const base = { piles, dE: 0.5, pillar: { ax: 1.2, ay: 0.4 }, fckBlock: 35, caa: 2, combos: [{ name: 'U', P: [800, 800, 800, 800], Nsd: 3200 }], method: 'machado' } as BlockInput
    const cheio = designBlock(base)
    const dois = designBlock({ ...base, pillarArea: 0.4 * 0.4 * 2 })
    const sp = (r: ReturnType<typeof designBlock>) => r.checks.find((k) => k.name.startsWith('Biela junto ao pilar'))!.value
    expect(sp(dois)).toBeGreaterThan(sp(cheio) * 1.4)
    expect(dois.warnings.join(' ')).toContain('Bloco comum a dois pilares')
  })
})

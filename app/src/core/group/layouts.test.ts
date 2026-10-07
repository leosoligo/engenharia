import { describe, expect, it } from 'vitest'
import { estimateBlock, initialPileCount, LAYOUT_COUNTS, layoutsFor, minDistance, minSpacing } from './layouts'

describe('Espaçamentos mínimos (Campos, Tab. 10.21)', () => {
  it('escavadas 3dE; moldadas rugosas 2,5dE (argila) / 2dE (areia); pré-moldadas 3dE em areia; piso de 60 cm', () => {
    expect(minSpacing('escavada', 0.5, 'coesivo')).toBeCloseTo(1.5, 9)
    expect(minSpacing('helice', 0.4, 'granular')).toBeCloseTo(1.2, 9)
    expect(minSpacing('franki', 0.4, 'coesivo')).toBeCloseTo(1.0, 9)
    expect(minSpacing('strauss', 0.3, 'granular')).toBeCloseTo(0.6, 9)
    expect(minSpacing('premoldada', 0.3, 'granular')).toBeCloseTo(0.9, 9)
    expect(minSpacing('raiz', 0.1, 'granular')).toBeCloseTo(0.6, 9) // piso de 60 cm
  })
})

describe('Arranjos automáticos', () => {
  const s = 1.2
  it.each(LAYOUT_COUNTS)('n = %d: todos os arranjos têm n pontos, centroide na origem e espaçamento ≥ s', (n) => {
    const ls = layoutsFor(n, s)
    expect(ls.length).toBeGreaterThan(0)
    for (const l of ls) {
      expect(l.points).toHaveLength(n)
      expect(l.points.reduce((a, p) => a + p.x, 0)).toBeCloseTo(0, 9)
      expect(l.points.reduce((a, p) => a + p.y, 0)).toBeCloseTo(0, 9)
      if (n > 1) expect(minDistance(l.points)).toBeGreaterThanOrEqual(s - 1e-9)
    }
  })
  it('arranjos conhecidos: triângulo equilátero, quadrado e hexágono', () => {
    const tri = layoutsFor(3, s)[0].points
    expect(Math.hypot(tri[0].x - tri[2].x, tri[0].y - tri[2].y)).toBeCloseTo(s, 9)
    const hex = layoutsFor(6, s)[0].points
    expect(minDistance(hex)).toBeCloseTo(s, 9)
    expect(layoutsFor(4, s)[0].points.map((p) => [Math.abs(p.x), Math.abs(p.y)])).toEqual([[0.6, 0.6], [0.6, 0.6], [0.6, 0.6], [0.6, 0.6]])
  })
  it('número inicial de estacas (Campos): +10 % sem momento, +30 % com momento', () => {
    expect(initialPileCount(1000, 400, false)).toBe(3) // 1100/400
    expect(initialPileCount(1000, 400, true)).toBe(4) // 1300/400
    expect(initialPileCount(100, 400, false)).toBe(1)
  })
})

describe('Estimativa do bloco', () => {
  it('quatro estacas Ø0,5 a 1,5 m: planta e altura rígida (a − ap)/3', () => {
    const pts = layoutsFor(4, 1.5)[0].points
    const b = estimateBlock(pts, 0.5, { ax: 0.4, ay: 0.4 })
    expect(b.lx).toBeCloseTo(1.5 + 0.5 + 0.3, 9)
    expect(b.h).toBeCloseTo(Math.max(0.5, (2.3 - 0.4) / 3), 9)
    expect(b.volume).toBeCloseTo(b.lx * b.ly * b.h, 9)
  })
})

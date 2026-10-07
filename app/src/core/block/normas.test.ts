/**
 * Auditoria de conformidade dos blocos: ângulos das bielas (45° a 55°, Campos/Blévot), cobrimento (NBR 6118:2026, Tab. 7.2),
 * armadura adotada ≥ necessária, tensões nas bielas dentro dos limites e fissuração dentro de Tab. 13.4, para vários arranjos.
 */
import { describe, expect, it } from 'vitest'
import { designBlock, type BlockInput } from './index'
import { layoutsFor } from '../group/layouts'
import { COVER_SOIL } from '../structural/design'
import { CRACK_LIMIT_MM } from './crack'

const cases: { n: number; P: number }[] = [{ n: 2, P: 450 }, { n: 3, P: 500 }, { n: 4, P: 450 }, { n: 5, P: 400 }, { n: 6, P: 400 }]
describe('Conformidade do bloco com os critérios (arranjos de 2 a 6 estacas)', () => {
  for (const { n, P } of cases) for (const caa of [1, 2, 3, 4] as const) for (const method of ['conservador', 'blevot', 'machado', 'flexao'] as const) {
    it(`${n} estacas, CAA ${caa}, ${method}`, () => {
      const piles = layoutsFor(n, 0.9)[0].points
      const r = designBlock({ piles, dE: 0.4, pillar: { ax: 0.4, ay: 0.4 }, fckBlock: 35, caa, combos: [{ name: 'U', P: piles.map(() => P), Nsd: n * P }], serviceMaxP: P / 1.4, method } as BlockInput)
      if (!r.feasible) return
      expect(r.geometry.cover).toBeGreaterThanOrEqual(COVER_SOIL[caa] - 1e-9)
      for (const b of r.bars) expect(b.AsEff).toBeGreaterThanOrEqual(b.AsReq - 1e-9)
      for (const c of r.checks) if (method !== 'flexao') expect(c.value).toBeLessThanOrEqual(c.limit * (1 + 1e-9))
      expect(r.geometry.h).toBeGreaterThan(r.geometry.d)
      if (method === 'blevot') {
        for (const th of r.theta) { expect(th).toBeGreaterThanOrEqual(45 - 0.6); expect(th).toBeLessThanOrEqual(55 + 0.6) }
      }
      for (const q of r.crack ?? []) { expect(q.limit).toBe(CRACK_LIMIT_MM[caa]); expect(q.ok).toBe(q.wk <= q.limit) }
    })
  }
})

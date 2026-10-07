/**
 * Auditoria de conformidade: o dimensionamento da estaca respeita os limites numéricos das normas em uma malha de casos
 * (tipo × diâmetro × cargas × CAA). Fontes conferidas no texto: NBR 6118:2026 (7.4 Tab. 7.2; 17.3.5.3; 18.4.2; 18.4.3) e NBR 6122:2022 (8.6.3, Tab. 4).
 */
import { describe, expect, it } from 'vitest'
import { COVER_SOIL, designStructural, table4, type Demands } from './design'
import type { PileType } from '../pile'

const z = Array.from({ length: 61 }, (_, i) => i * 0.25) // 0 … 15 m
const demands = (N: number, M0: number, V0: number): Demands => ({
  z,
  N: z.map((zz) => N * Math.max(1 - zz / 25, 0.3)), // diminui com o atrito lateral
  M: z.map((zz) => M0 * Math.exp(-zz / 2) * Math.cos(zz / 2.5)),
  V: z.map((zz) => V0 * Math.exp(-zz / 2.5)),
})

const types: PileType[] = ['helice', 'escavada', 'escavada_fluido', 'strauss', 'franki', 'raiz']
const cases: { D: number; N: number; M: number; V: number }[] = [
  { D: 0.3, N: 400, M: 15, V: 15 }, { D: 0.4, N: 1200, M: 60, V: 40 }, { D: 0.5, N: 2000, M: 150, V: 80 },
  { D: 0.6, N: 3000, M: 300, V: 120 }, { D: 0.8, N: 5000, M: 600, V: 200 },
]

describe('Conformidade do dimensionamento da estaca com as normas (malha de casos)', () => {
  for (const type of types) for (const caa of [1, 2, 3, 4] as const) for (const c of cases) {
    const t4 = table4(type, caa)
    if (!t4) continue
    it(`${type} CAA ${caa} Ø${c.D * 100} N=${c.N}`, () => {
      const r = designStructural({ type, D: c.D, L: 15, caa, transverse: 'estribo', demands: demands(c.N, c.M, c.V) })
      if (!r.feasible) return // inviável com mensagem: nada a conferir
      const l = r.longitudinal!
      const Ac = (Math.PI * c.D ** 2) / 4
      const NdMax = Math.max(...demands(c.N, c.M, c.V).N)
      const fyd = (500 / 1.15) * 1000
      // Tab. 4 (NBR 6122)
      expect(r.fck).toBeGreaterThanOrEqual(t4.fck)
      expect(r.gammaC).toBeGreaterThanOrEqual(t4.gammaC)
      expect(r.cageLength!).toBeGreaterThanOrEqual((t4.minArmedLength === 'integral' ? 15 : t4.minArmedLength) - 1e-9)
      // cobrimento (NBR 6118:2026, Tab. 7.2)
      expect(r.cover).toBeGreaterThanOrEqual(COVER_SOIL[caa] - 1e-9)
      // 18.4.2.1 e 18.4.2.2: bitola, número, espaçamentos
      expect(l.n).toBeGreaterThanOrEqual(6)
      expect(l.phiMm).toBeGreaterThanOrEqual(10)
      expect(l.phiMm).toBeLessThanOrEqual((c.D * 1000) / 8 + 1e-9)
      const free = ((2 * Math.PI * l.Rs) / l.n) * 1000 - l.phiMm // mm, entre faces (arco)
      expect(free).toBeGreaterThanOrEqual(Math.max(20, l.phiMm, 1.2 * 19) - 1e-6)
      expect(((2 * Math.PI * l.Rs) / l.n)).toBeLessThanOrEqual(Math.min(2 * c.D, 0.4) + 1e-9)
      // 17.3.5.3: taxas mínima e máxima
      expect(l.rho).toBeGreaterThanOrEqual(Math.max(0.004, (0.15 * NdMax) / fyd / Ac) - 1e-9)
      expect(l.rho).toBeLessThanOrEqual((c.D >= 0.4 ? 0.06 : 0.08) + 1e-9)
      // 18.4.3: estribos
      const tr = r.transverse!
      expect(tr.phiMm).toBeGreaterThanOrEqual(Math.max(5, l.phiMm / 4) - 1e-9)
      for (const zn of tr.zones) expect(zn.spacing).toBeLessThanOrEqual(Math.min(0.2, c.D, 0.012 * l.phiMm) + 1e-9)
      // 8.6.3: onde N/A supera o limite da Tab. 4 a estaca é armada
      if (t4.noRebarStress !== undefined) {
        const nz = demands(c.N, c.M, c.V).N
        z.forEach((zz, i) => { if (nz[i] / Ac / 1000 > t4.noRebarStress! + 1e-9) expect(r.cageLength!).toBeGreaterThanOrEqual(zz - 1e-9) })
      }
    })
  }
})

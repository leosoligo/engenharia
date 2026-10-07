import { describe, expect, it } from 'vitest'
import { optimize, ZERO_COSTS, type Candidate, type OptimizeInput } from './index'
import { SOIL_TYPES, type SptBorehole } from '../soil'
import type { LoadCombination } from '../loads'
import { PILE_TYPES } from '../pile'

/** Gerador pseudoaleatório determinístico (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const finite = (x: unknown, path: string, bad: string[]) => {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) bad.push(`${path} = ${x}`)
  } else if (Array.isArray(x)) x.forEach((v, i) => finite(v, `${path}[${i}]`, bad))
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) finite(v, `${path}.${k}`, bad)
}

describe('Robustez (cenários aleatórios)', () => {
  it('40 cenários: sem exceções, sem NaN/Infinity nos resultados e verificações respeitadas', () => {
    const problems: string[] = []
    const stats: string[] = []
    for (let s = 1; s <= 40; s++) {
      const r = rng(s)
      const nl = 14 + Math.floor(r() * 24)
      const bh: SptBorehole = {
        id: 'F', waterLevel: r() < 0.2 ? Infinity : Math.floor(r() * 10),
        layers: Array.from({ length: nl }, (_, i) => ({
          depth: i + 1, nspt: Math.max(1, Math.round(2 + i * (0.4 + r()) + r() * 6)), soil: SOIL_TYPES[Math.floor(r() * SOIL_TYPES.length)],
        })),
      }
      const fz = 300 + r() * 4000
      const combos: LoadCombination[] = ['ELS', 'ELU'].flatMap((st) =>
        [0, 1].map((k): LoadCombination => ({
          pillar: 'P', name: `${st}${k}`, state: st as 'ELS' | 'ELU', fx: (r() - 0.3) * 100, fy: (r() - 0.5) * 60, fz: fz * (st === 'ELU' ? 1.4 : 1) * (0.7 + 0.3 * k),
          mx: (r() - 0.5) * 120, my: (r() - 0.5) * 200, mz: (r() - 0.5) * 20,
        })),
      )
      const types = PILE_TYPES.filter((t) => t !== 'premoldada' && r() < 0.5)
      if (types.length === 0) types.push('helice')
      const inp: OptimizeInput = {
        boreholes: [bh], pillar: { ax: 0.25 + r() * 0.3, ay: 0.25 + r() * 0.3 }, combos, types,
        diameters: Object.fromEntries(types.map((t) => [t, [0.3, 0.4, 0.5, 0.6].filter(() => r() < 0.8)])),
        caa: (1 + Math.floor(r() * 4)) as 1 | 2 | 3 | 4, transverse: r() < 0.5 ? 'estribo' : 'helicoidal', topDepth: Math.floor(r() * 3),
        costs: { ...ZERO_COSTS, concretePerM3: 400, steelPerKg: 8 }, serviceLimit: 0.025, maxResults: 2, maxEvaluations: 6,
        permitTension: r() < 0.3, headFixity: r() < 0.8 ? 'engastada' : 'articulada', loading: r() < 0.7 ? 'static' : 'cyclic',
      }
      try {
        const t0 = performance.now()
        const res = optimize(inp)
        const why = [...new Set(res.rejected.map((x) => x.reason.slice(0, 60)))].slice(0, 2).join(' | ')
        stats.push(`s${s}: ${res.best.length} sol, ${res.evaluated} aval, ${(performance.now() - t0).toFixed(0)} ms; ${why}`)
        const bad: string[] = []
        for (const c of res.best as Candidate[]) {
          finite({ cost: c.cost, q: c.quantities, service: c.service, d: c.design.weights, b: c.blockDesign.quantities, th: c.blockDesign.theta }, 'cand', bad)
          if (c.service.maxHeadDisplacement > 0.025 + 1e-9) bad.push('deslocamento acima do limite')
          if (c.service.maxCompression > c.service.padm + 1e-6) bad.push('compressão acima de Padm')
          if (!inp.permitTension && c.service.minAxial < -1e-6) bad.push(`tração (${c.service.minAxial.toFixed(1)}) sem permissão`)
          if (c.design.longitudinal!.utilization > 1 + 1e-9) bad.push('utilização > 1')
          if (c.blockDesign.checks.some((k) => !k.ok)) bad.push('biela reprovada em solução aceita')
        }
        if (bad.length) problems.push(`semente ${s}: ${bad.slice(0, 4).join('; ')}`)
      } catch (e) {
        problems.push(`semente ${s}: exceção ${(e as Error).message.slice(0, 120)}`)
      }
    }
    void stats
    expect(problems).toEqual([])
  })
})

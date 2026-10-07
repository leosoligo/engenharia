/**
 * Custos padrão a partir do SINAPI (por UF e regime de desoneração) e edições do usuário sobre eles.
 *
 * Como cada insumo é derivado (veja `data/sinapi.ts` para a origem):
 *  - concreto das estacas: insumo 1525 (concreto usinado bombeável C30), R$/m³ — sem sobreconsumo explícito;
 *  - execução por metro = custo da composição SINAPI da estaca (que já inclui concreto, perdas e bombeamento)
 *    − volume teórico × preço do concreto; assim concreto + execução reproduzem a composição. Diâmetros que não constam
 *    do SINAPI são interpolados (dentro da faixa) ou escalados pela área (fora da faixa) e marcados como estimados;
 *  - aço da estaca e do bloco: composições de montagem de armadura (aço CA-50, corte, dobra e montagem), R$/kg;
 *  - arrasamento por faixa de diâmetro; bloco: concretagem com bomba (fck 30), fôrma de compensado (4 utilizações) e lastro;
 *  - mobilização e itens extras não existem no SINAPI: ficam em 0 para o usuário informar.
 * O SINAPI não publica custo de estaca Strauss, estacão (escavada com fluido) nem Franki: nesses tipos a execução fica em 0.
 */
import { SINAPI } from './data/sinapi'
import { ZERO_COSTS, type CostParams, type ExtraCost } from './core/optimize'
import type { PileType } from './core/pile'

export type Regime = 'nao' | 'des'

export const UF_LIST: { uf: string; name: string }[] = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AM', 'Amazonas'], ['AP', 'Amapá'], ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'],
  ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MG', 'Minas Gerais'], ['MS', 'Mato Grosso do Sul'], ['MT', 'Mato Grosso'],
  ['PA', 'Pará'], ['PB', 'Paraíba'], ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['PR', 'Paraná'], ['RJ', 'Rio de Janeiro'],
  ['RN', 'Rio Grande do Norte'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['RS', 'Rio Grande do Sul'], ['SC', 'Santa Catarina'],
  ['SE', 'Sergipe'], ['SP', 'São Paulo'], ['TO', 'Tocantins'],
].map(([uf, name]) => ({ uf, name }))

export interface CostSource {
  kind: 'sinapi' | 'manual'
  uf: string
  regime: Regime
}

export const DEFAULT_COST_SOURCE: CostSource = { kind: 'sinapi', uf: 'SP', regime: 'nao' }

/** Edições do usuário sobre os valores-base (só o que difere). */
export interface CostOverrides {
  concretePerM3?: number
  concreteOverrun?: number
  steelPerKg?: number
  blockSteelPerKg?: number
  mobilizationPerPile?: number
  cutOffPerPile?: number
  blockConcretePerM3?: number
  blockFormPerM2?: number
  leanPerM2?: number
  /** Chaves "tipo:diâmetro cm" (ex.: "helice:40"). */
  executionPerM?: Record<string, number>
  cutOffByDiameter?: Record<string, number>
  extras?: ExtraCost[]
}

export const execKey = (t: PileType, dcm: number) => `${t}:${dcm}`

const area = (dcm: number) => (Math.PI * (dcm / 100) ** 2) / 4

/** Custo da composição por metro para um diâmetro (cm): exato, interpolado ou escalado pela área. */
function compositionAt(points: Record<string, number>, d: number): { value: number; estimated: boolean } {
  const ds = Object.keys(points).map(Number).sort((a, b) => a - b)
  if (points[String(d)] !== undefined) return { value: points[String(d)], estimated: false }
  const lo = [...ds].reverse().find((x) => x < d)
  const hi = ds.find((x) => x > d)
  if (lo !== undefined && hi !== undefined) {
    const f = (d - lo) / (hi - lo)
    return { value: points[String(lo)] + f * (points[String(hi)] - points[String(lo)]), estimated: true }
  }
  const near = lo ?? hi!
  return { value: points[String(near)] * (area(d) / area(near)), estimated: true }
}

export interface Baseline {
  costs: CostParams
  /** Chaves "tipo:diâmetro" cujo valor foi estimado (interpolação/escala). */
  estimated: Set<string>
  /** Tipos de estaca sem referência no SINAPI. */
  missingTypes: PileType[]
  notes: string[]
}

export function cutOffRange(dcm: number): string {
  return dcm <= 40 ? '40' : dcm <= 60 ? '60' : dcm <= 80 ? '80' : dcm <= 100 ? '100' : '150'
}

export function baseline(src: CostSource, types: PileType[], diameters: Record<PileType, number[]>): Baseline {
  const costs: CostParams = { ...ZERO_COSTS, executionPerM: {}, cutOffByDiameter: {}, extras: [] }
  const out: Baseline = { costs, estimated: new Set(), missingTypes: [], notes: [] }
  if (src.kind !== 'sinapi') return out
  const e = SINAPI.regimes[src.regime]?.[src.uf]
  if (!e) return out
  const conc = e.concrete ?? 0
  costs.concretePerM3 = conc
  costs.steelPerKg = e.steelPile ?? 0
  costs.blockSteelPerKg = e.steelBlock ?? 0
  costs.blockConcretePerM3 = e.blockConcrete ?? 0
  costs.blockFormPerM2 = e.blockForm ?? 0
  costs.leanPerM2 = e.lean ?? 0
  const allD = new Set<number>()
  for (const t of types) {
    const pts = e.pile[t as keyof typeof e.pile]
    if (!pts) {
      if (t !== 'premoldada') out.missingTypes.push(t)
      continue
    }
    for (const d of diameters[t]) {
      allD.add(d)
      const c = compositionAt(pts, d)
      costs.executionPerM[execKey(t, d)] = Math.max(0, Math.round((c.value - area(d) * conc) * 100) / 100)
      if (c.estimated) out.estimated.add(execKey(t, d))
    }
  }
  for (const t of types) for (const d of diameters[t]) allD.add(d)
  for (const d of allD) {
    const v = e.cutOff[cutOffRange(d)]
    if (v) costs.cutOffByDiameter[String(d)] = v
  }
  out.notes.push(`SINAPI ${SINAPI.reference} (${src.regime === 'nao' ? 'sem desoneração' : 'com desoneração'}) — ${UF_LIST.find((u) => u.uf === src.uf)?.name ?? src.uf}.`)
  return out
}

/** Custos efetivos = valores-base (SINAPI ou zeros) + edições do usuário. */
export function resolveCosts(src: CostSource, types: PileType[], diameters: Record<PileType, number[]>, ov: CostOverrides): CostParams {
  const b = baseline(src, types, diameters).costs
  return {
    ...b,
    ...Object.fromEntries(Object.entries(ov).filter(([k, v]) => v !== undefined && !['executionPerM', 'cutOffByDiameter', 'extras'].includes(k))),
    executionPerM: { ...b.executionPerM, ...(ov.executionPerM ?? {}) },
    cutOffByDiameter: { ...b.cutOffByDiameter, ...(ov.cutOffByDiameter ?? {}) },
    extras: ov.extras ?? [],
  } as CostParams
}

export const SINAPI_INFO = { reference: SINAPI.reference, issued: SINAPI.issued, source: SINAPI.source }

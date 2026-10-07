/** Aoki-Velloso (1975), Décourt-Quaresma (1978/1996) e Teixeira (1996). Unidades: kN, kPa, m. */
import { pileArea, pilePerimeter } from '../pile'
import { soilClass3, type SptBorehole, type SptLayer } from '../soil'
import { avEffective, dqEffective, hasOverrides, txEffective } from './params'
import type { CapacityInput, CapacityResult, CapacityRow } from './types'

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function sorted(b: SptBorehole): SptLayer[] {
  return [...b.layers].sort((x, y) => x.depth - y.depth)
}

function row(depth: number, Rp: number, Rl: number, input: CapacityInput): CapacityRow {
  let p = Rp * (input.tipFactor ?? 1)
  const l = Rl * (input.shaftFactor ?? 1)
  const lim = input.params?.tipLimitPct
  if (lim !== undefined && lim > 0) p = Math.min(p, (lim / 100) * l)
  return { depth, Rp: p, Rl: l, R: p + l }
}

/** N_SPT do fuste limitado pelos limites do usuário (se houver). */
const shaftN = (input: CapacityInput, n: number) => {
  const lim = input.params?.sptShaftLimits?.[input.pile.type]
  return Math.min(Math.max(n, lim?.min ?? -Infinity), lim?.max ?? Infinity)
}
const skipLast = (input: CapacityInput) => input.params?.ignoreLastMeter === true

/** R = Rp + Rl;  Rp = K·Np/F1·Ap;  Rl = U·Σ(α·K·NL/F2·Δl)  (Cintra & Aoki, 2010, §1.2.1). */
export function aokiVelloso(b: SptBorehole, input: CapacityInput): CapacityResult {
  const { pile } = input
  const Ap = pileArea(pile.diameter)
  const U = pilePerimeter(pile.diameter)
  const av = avEffective(input.params, pile.type, pile.diameter)
  const { F1, F2 } = av
  const warnings: string[] = []
  if (av.note) warnings.push(av.note)
  if (hasOverrides(input.params)) warnings.push('Parâmetros editados pelo usuário em uso.')

  const rows: CapacityRow[] = []
  let RlAcum = 0
  for (const l of sorted(b)) {
    const { K, alpha } = av.soilValue(l.soil)
    const before = RlAcum
    RlAcum += (U * alpha * K * shaftN(input, l.nspt)) / F2 // trechos de 1 m: Δl = 1
    const Rp = (K * l.nspt * Ap) / F1
    rows.push(row(l.depth, Rp, skipLast(input) ? before : RlAcum, input))
  }
  return { method: 'aoki-velloso', rows, warnings }
}

/**
 * R = α·C·Np·Ap + β·10·(NL/3 + 1)·U·L   (Cintra & Aoki, 2010, §1.2.2; Décourt, 1996).
 * Np: média dos N na cota da ponta, imediatamente acima e imediatamente abaixo.
 * NL: média dos N ao longo do fuste, limitados a 3 ≤ N ≤ nlMax, sem os valores usados em Np.
 */
export function decourtQuaresma(b: SptBorehole, input: CapacityInput): CapacityResult {
  const { pile } = input
  const Ap = pileArea(pile.diameter)
  const U = pilePerimeter(pile.diameter)
  const ab = dqEffective(input.params, pile.type)
  const warnings: string[] = []
  if (ab.source === 'orientativo')
    warnings.push('Décourt-Quaresma: os fatores α e β deste tipo de estaca são apenas orientativos (Cintra & Aoki, 2010, Tabs. 1.7 e 1.8).')
  if (ab.source === 'adaptado')
    warnings.push('Décourt-Quaresma: Strauss tratada como "escavada em geral" (conservador; Velloso & Lopes admitem α = β = 1).')
  if (hasOverrides(input.params)) warnings.push('Parâmetros editados pelo usuário em uso.')

  const ls = sorted(b)
  const byDepth = new Map(ls.map((l) => [l.depth, l]))
  const rows: CapacityRow[] = []
  let usedAdaptedC = false
  for (const tip of ls) {
    const z = tip.depth
    const tipDepths = [z - 1, z, z + 1].filter((d) => byDepth.has(d))
    const Np = mean(tipDepths.map((d) => byDepth.get(d)!.nspt))
    const { C, source } = ab.C(tip.soil)
    if (source === 'adaptado') usedAdaptedC = true
    const cls = soilClass3(tip.soil)
    const Rp = ab.alpha(cls) * C * Np * Ap

    // Fuste: camadas de 1 a z, cada uma com o fator β do seu próprio solo → média ponderada em Rl.
    const zl = skipLast(input) ? z - 1 : z // comprimento do fuste considerado
    const shaft = ls.filter((l) => l.depth <= zl && !tipDepths.includes(l.depth))
    let Rl = 0
    if (shaft.length > 0) {
      const nl = mean(shaft.map((l) => Math.min(Math.max(l.nspt, 3), ab.nlMax)))
      // β depende do solo; com N_L único, usa-se a média de β ponderada pelo comprimento (camadas de 1 m).
      const beta = mean(ls.filter((l) => l.depth <= zl).map((l) => ab.beta(soilClass3(l.soil))))
      Rl = beta * 10 * (nl / 3 + 1) * U * zl
    }
    rows.push(row(z, Rp, Rl, input))
  }
  if (usedAdaptedC)
    warnings.push('Décourt-Quaresma: o coeficiente C de alguns solos mistos foi associado por analogia às 4 classes de Décourt & Quaresma (Cintra & Aoki, 2010, Tab. 1.6).')
  return { method: 'decourt-quaresma', rows, warnings }
}

/**
 * R = α·Np·Ap + β·NL·U·L   (Teixeira, 1996; Cintra & Aoki, 2010, §1.2.3).
 * Np: média dos N de 4 diâmetros acima a 1 diâmetro abaixo da ponta; NL: média ao longo do fuste.
 * Domínio de validade do método: 4 < N_SPT < 40.
 */
export function teixeira(b: SptBorehole, input: CapacityInput): CapacityResult {
  const { pile } = input
  const D = pile.diameter
  const Ap = pileArea(D)
  const U = pilePerimeter(D)
  const warnings: string[] = []
  const ls = sorted(b)
  const rows: CapacityRow[] = []
  let adapted = false
  let outOfDomain = false
  for (const tip of ls) {
    const z = tip.depth
    const win = ls.filter((l) => l.depth >= z - 4 * D && l.depth <= z + D)
    const Np = mean(win.map((l) => l.nspt))
    const zl = skipLast(input) ? z - 1 : z
    const shaft = ls.filter((l) => l.depth <= zl)
    const NL = shaft.length ? mean(shaft.map((l) => shaftN(input, l.nspt))) : 0
    const { alpha, beta, source } = txEffective(input.params, pile.type, tip.soil)
    if (source === 'adaptado') adapted = true
    if (win.concat(shaft).some((l) => l.nspt <= 4 || l.nspt >= 40)) outOfDomain = true
    rows.push(row(z, alpha * Np * Ap, beta * NL * U * zl, input))
  }
  if (adapted)
    warnings.push('Teixeira: parte dos α/β não consta de Teixeira (1996) para este tipo de estaca/solo; usados valores adaptados (Cintra & Aoki, 2010).')
  if (outOfDomain)
    warnings.push('Teixeira: há N_SPT fora do domínio 4 < N < 40 do método.')
  if (hasOverrides(input.params)) warnings.push('Parâmetros editados pelo usuário em uso.')
  return { method: 'teixeira', rows, warnings }
}

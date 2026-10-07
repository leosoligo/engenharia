/**
 * Verificação de uma armadura de estaca ESCOLHIDA PELO USUÁRIO (n, φ longitudinal, φ e passo da transversal,
 * comprimento da gaiola) contra os esforços de cálculo (ELU) já obtidos na análise.
 *
 * Usa as mesmas formulações e hipóteses de `designStructural` (design.ts): envoltória N–M da NBR 6118:2026 17.2,
 * cortante modelo I com a interpretação de seção circular, limites de detalhamento de 18.3–18.4 e Tab. 4 da NBR 6122:2022.
 * Os esforços NÃO são recalculados com a nova armadura (a rigidez EI(M) da análise vem da armadura sugerida): a
 * diferença é pequena para variações moderadas, mas é um aviso mostrado ao usuário.
 */
import {
  interactionCurve,
  momentCapacityFromCurve,
  barArea,
  type CircularSection,
  type InteractionCurve,
  type Materials,
} from './section'
import { COVER_SOIL, effectiveT4, type Table4Row, type Caa, type Demands, type StructuralDesign, type TransverseType } from './design'
import type { PileType } from '../pile'
import { fx } from '../format'

export interface PileArmor {
  n: number
  phiMm: number
  /** Diâmetro da armadura transversal (mm). */
  phitMm: number
  transverse: TransverseType
  /** Espaçamento (estribo) ou passo (helicoidal), m. */
  spacing: number
  /** Comprimento da gaiola a partir do topo (m). */
  cageLength: number
  /** Prolongamento da armadura longitudinal dentro do bloco (m); 0 = sem ancoragem no bloco. */
  anchorage: number
}

export interface VerifyInput {
  type: PileType
  D: number
  L: number
  caa: Caa
  fck?: number
  gammaC?: number
  fyk?: number
  gammaS?: number
  cover?: number
  dmax?: number
  sacrificial?: boolean
  t4?: Partial<Table4Row>
  minRho?: number
  noRebarDivisor?: number
  demands: Demands[]
}

export interface Check {
  id: string
  group: 'normal' | 'flexao' | 'cortante' | 'detalhamento'
  name: string
  value: number
  limit: number
  unit: string
  /** 'max': valor deve ser ≤ limite; 'min': valor deve ser ≥ limite. */
  kind: 'max' | 'min'
  ok: boolean
  /** 'warn': recomendação prática, não reprova a armadura. */
  severity: 'error' | 'warn'
  ref: string
}

export interface NodeRow {
  z: number
  N: number
  M: number
  V: number
  MRd: number
  /** MRd/|M| (Infinity se M ≈ 0). */
  FS: number
  /** Espaçamento máximo de estribo exigido neste nó (m). */
  sReq: number
}

export interface PileVerification {
  ok: boolean
  checks: Check[]
  /** Linhas por conjunto de esforços (combinação × estaca), na mesma ordem de `demands`. */
  perSet: NodeRow[][]
  /** Conjunto e nó com menor FS à flexão. */
  critical: { set: number; node: number; N: number; M: number; MRd: number; FS: number }
  curve: InteractionCurve
  mat: Materials
  Rs: number
  cover: number
  As: number
  rho: number
  NdMax: number
  NRd: number
  shear: { set: number; node: number; Vd: number; VRd2: number; AswCalc: number; AswEf: number; sReqMin: number }
  required: { cageLength: number; zReq: number; lbNec: number; minArmedLength: number; sMax: number }
  weights: { longKg: number; transKg: number; totalKg: number; kgPerM3: number }
  fck: number
  gammaC: number
}

const STEEL_DENSITY = 7850
const mm = (x: number) => x / 1000

/** Armadura inicial = a sugerida pelo dimensionamento automático (espaçamento = o menor dos trechos). */
export function armorFromDesign(d: StructuralDesign): PileArmor {
  const t = d.transverse!
  return {
    n: d.longitudinal!.n,
    phiMm: d.longitudinal!.phiMm,
    phitMm: t.phiMm,
    transverse: t.type,
    spacing: Math.min(...t.zones.map((z) => z.spacing)),
    cageLength: d.cageLength!,
    anchorage: d.anchorage ?? 0,
  }
}

export function verifyPile(inp: VerifyInput, a: PileArmor): PileVerification {
  const t4 = effectiveT4(inp.type, inp.caa, inp.t4)
  const fck = inp.fck ?? t4?.fck ?? 30
  const gammaC = inp.gammaC ?? t4?.gammaC ?? 2.7
  const cover = inp.cover ?? COVER_SOIL[inp.caa]
  const fyk = inp.fyk ?? 500
  const gammaS = inp.gammaS ?? 1.15
  const mat: Materials = { fck, gammaC, fyk, gammaS }
  const fyd = (fyk / gammaS) * 1000
  const D = inp.D
  const Ac = (Math.PI * D * D) / 4
  const dmax = inp.dmax ?? 0.019
  const sacr = inp.sacrificial ?? true
  const phi = mm(a.phiMm)
  const phit = mm(a.phitMm)
  const n = a.n
  const Rs = D / 2 - cover - phit - phi / 2
  const sets = inp.demands
  const checks: Check[] = []
  const add = (c: Omit<Check, 'ok'> & { ok?: boolean }) => {
    const ok = c.ok ?? (c.kind === 'max' ? c.value <= c.limit + 1e-9 : c.value >= c.limit - 1e-9)
    checks.push({ ...c, ok })
  }

  const phiRes = sacr ? Math.max(phi - 0.002, 0.005) : phi
  const sec: CircularSection = { D, n, phi: phiRes, Rs: Math.max(Rs, 0.01) }
  const curve = interactionCurve(sec, mat)
  const NRd = Math.max(...curve.a.map((p) => p.N), ...curve.b.map((p) => p.N))
  const NdMax = Math.max(0, ...sets.flatMap((d) => d.N))
  const VdMax = Math.max(0, ...sets.flatMap((d) => d.V.map(Math.abs)))

  // ---- flexo-compressão em todos os nós
  const perSet: NodeRow[][] = sets.map((d) =>
    d.z.map((z, i) => {
      const mrd = momentCapacityFromCurve(curve, d.N[i])
      const m = Math.abs(d.M[i])
      const ok = mrd > 0
      return { z, N: d.N[i], M: d.M[i], V: d.V[i], MRd: ok ? mrd : 0, FS: !ok ? 0 : m < 1e-6 ? Infinity : mrd / m, sReq: Infinity }
    }),
  )
  let critical = { set: 0, node: 0, N: 0, M: 0, MRd: 0, FS: Infinity }
  perSet.forEach((rows, k) => rows.forEach((r, i) => { if (r.FS < critical.FS) critical = { set: k, node: i, N: r.N, M: r.M, MRd: r.MRd, FS: r.FS } }))
  const umax = Number.isFinite(critical.FS) && critical.FS > 0 ? 1 / critical.FS : 0

  // ---- comprimento da gaiola (mesmo critério do dimensionamento automático)
  const minCurve = interactionCurve({ D, n: 6, phi: sacr ? 0.008 : 0.01, Rs: Math.max(Rs, 0.01) }, mat, 30)
  let zReq = 0
  sets.forEach((d) => d.z.forEach((z, i) => {
    const capMin = momentCapacityFromCurve(minCurve, d.N[i])
    if (!(capMin > 0) || Math.abs(d.M[i]) > capMin) zReq = Math.max(zReq, z)
  }))
  const fctmMPa = 0.3 * fck ** (2 / 3)
  const fctd = (0.7 * fctmMPa * 1000) / gammaC
  const fctkInf = 0.7 * fctmMPa * 1000
  const fcd = (fck / gammaC) * 1000
  const fbd = 2.25 * 1.0 * 1.0 * fctd
  const lb = (phi / 4) * (fyd / fbd)
  const lbMin = Math.max(0.3 * lb, 10 * phi, 0.1)
  const tensioned = sets.some((d) => d.N.some((v) => v < -1e-6))
  const lbNec = tensioned ? Math.max(lb, lbMin) : Math.max(lb * Math.min(1, Math.max(umax, 0.01)), lbMin)
  const minLen = t4?.minArmedLength === 'integral' ? inp.L : (t4?.minArmedLength ?? 0)
  // NBR 6122:2022, 8.6.3: onde N/A supera o limite da Tab. 4 a estaca é armada
  let zSig = 0
  if (t4?.noRebarStress !== undefined) {
    const Ac = (Math.PI * D * D) / 4
    const div = inp.noRebarDivisor && inp.noRebarDivisor > 0 ? inp.noRebarDivisor : 1
    for (const d of sets) d.z.forEach((z, i) => { if (Math.max(d.N[i], 0) / div / Ac / 1000 > t4.noRebarStress!) zSig = Math.max(zSig, z) })
  }
  const cageReq = Math.min(inp.L, Math.max(minLen, zReq + lbNec, zSig))

  // ---- cortante e espaçamento exigido por nó (modelo I, mesma interpretação do design.ts)
  const bw = D
  const d_ = D / 2 + (2 * Math.max(Rs, 0)) / Math.PI
  const vrd2 = 0.27 * (1 - fck / 250) * fcd * bw * d_
  const fywd = Math.min((a.phitMm === 5 ? 600 : fyk) / gammaS, 435) * 1000
  const Ast = (Math.PI * phit ** 2) / 4
  const W = (Math.PI * D ** 3) / 32
  const sRule = Math.min(0.2, D, 12 * phi)
  let aswCalcMax = 0
  let shear = { set: 0, node: 0, Vd: 0 }
  let sReqMin = sRule
  let vsdOverVrd2 = 0
  sets.forEach((d, k) => d.z.forEach((z, i) => {
    const Vsd = Math.abs(d.V[i])
    const Md = Math.abs(d.M[i])
    const Nd = d.N[i]
    if (Vsd > shear.Vd) shear = { set: k, node: i, Vd: Vsd }
    vsdOverVrd2 = Math.max(vsdOverVrd2, Vsd / vrd2)
    const vc0 = 0.6 * fctd * bw * d_
    const m0 = (Math.max(Nd, 0) * D) / 8
    const vc = Md > 0 ? Math.min(vc0 * (1 + m0 / Md), 2 * vc0) : 2 * vc0
    const sigmaT = Md / W - Nd / Ac
    const exempt = Nd > 0 && sigmaT <= fctkInf && Vsd <= vc
    let sReq = sRule
    if (!exempt) {
      const vsw = Math.max(Vsd - vc, 0)
      const aswMin = ((0.2 * fctmMPa) / fyk) * bw
      const aswOverS = Math.max(vsw / (0.9 * d_ * fywd), aswMin)
      aswCalcMax = Math.max(aswCalcMax, aswOverS)
      const sShear = (2 * Ast) / aswOverS
      const sShearMax = Vsd <= 0.67 * vrd2 ? Math.min(0.6 * d_, 0.3) : Math.min(0.3 * d_, 0.2)
      sReq = Math.min(sRule, sShear, sShearMax)
    }
    perSet[k][i].sReq = sReq
    if (z <= a.cageLength + 1e-9) sReqMin = Math.min(sReqMin, sReq)
  }))
  const aswEf = (2 * Ast) / a.spacing

  // ---- limites de detalhamento
  const As = n * barArea(phi)
  const aMin = Math.max((inp.minRho ?? 0.004) * Ac, (0.15 * NdMax) / fyd)
  const aMaxRatio = D >= 0.4 ? 0.06 : 0.08
  const sc = n > 0 && Rs > 0 ? 2 * Rs * Math.sin(Math.PI / n) : 0
  const clearMin = Math.max(0.02, phi, 1.2 * dmax)

  add({ id: 'nrd', group: 'normal', name: 'Esforço normal máximo Nd ≤ NRd (compressão)', value: NdMax, limit: NRd, unit: 'kN', kind: 'max', severity: 'error', ref: 'NBR 6118, 17.2' })
  add({ id: 'flex', group: 'flexao', name: 'Flexo-compressão: Md ≤ MRd(Nd) em todos os nós e combinações', value: umax * 100, limit: 100, unit: '%', kind: 'max', severity: 'error', ref: 'NBR 6118, 17.2.2' })
  add({ id: 'vrd2', group: 'cortante', name: 'Biela comprimida: Vd ≤ VRd2', value: VdMax, limit: vrd2, unit: 'kN', kind: 'max', severity: 'error', ref: 'NBR 6118, 17.4.2.2 (interpretação circular)' })
  add({ id: 'asw', group: 'cortante', name: 'Armadura transversal efetiva ≥ necessária (Asw/s)', value: aswEf * 1e4, limit: aswCalcMax * 1e4, unit: 'cm²/m', kind: 'min', severity: 'error', ref: 'NBR 6118, 17.4.2.2' })
  add({ id: 'spacing', group: 'cortante', name: a.transverse === 'estribo' ? 'Espaçamento dos estribos ≤ exigido' : 'Passo da helicoidal ≤ exigido', value: a.spacing * 100, limit: sReqMin * 100, unit: 'cm', kind: 'max', severity: 'error', ref: 'NBR 6118, 18.4.3 e 17.4.1.1.1' })
  add({ id: 'cage', group: 'detalhamento', name: 'Comprimento da gaiola ≥ necessário (momento + ancoragem; mínimo e tensão N/A da Tab. 4)', value: a.cageLength, limit: cageReq, unit: 'm', kind: 'min', severity: 'error', ref: 'NBR 6122, Tab. 4; NBR 6118, 9.4' })
  if (a.anchorage > 0) add({ id: 'anchor', group: 'detalhamento', name: 'Ancoragem no bloco ≥ l_b,nec (armadura prolongada acima do topo da estaca)', value: a.anchorage * 100, limit: lbNec * 100, unit: 'cm', kind: 'min', severity: 'error', ref: 'NBR 6118, 9.4; 22.7.4.1.1' })
  add({ id: 'cageL', group: 'detalhamento', name: 'Gaiola não excede o comprimento da estaca', value: a.cageLength, limit: inp.L, unit: 'm', kind: 'max', severity: 'error', ref: '' })
  add({ id: 'nbars', group: 'detalhamento', name: 'Número de barras ≥ 6 (seção circular)', value: n, limit: 6, unit: '', kind: 'min', severity: 'error', ref: 'NBR 6118, 18.4.2.1' })
  add({ id: 'phimin', group: 'detalhamento', name: 'Diâmetro da barra longitudinal ≥ 10 mm', value: a.phiMm, limit: 10, unit: 'mm', kind: 'min', severity: 'error', ref: 'NBR 6118, 18.4.2.1' })
  add({ id: 'phimax', group: 'detalhamento', name: 'Diâmetro da barra ≤ D/8', value: a.phiMm, limit: (D * 1000) / 8, unit: 'mm', kind: 'max', severity: 'error', ref: 'NBR 6118, 18.4.2.1' })
  add({ id: 'asmin', group: 'detalhamento', name: 'Armadura mínima As ≥ máx[0,4 % Ac; 0,15·Nd/fyd]', value: As * 1e4, limit: aMin * 1e4, unit: 'cm²', kind: 'min', severity: 'error', ref: 'NBR 6122, Tab. 4; NBR 6118, 17.3.5.3' })
  add({ id: 'asmax', group: 'detalhamento', name: `Armadura máxima As ≤ ${aMaxRatio * 100} % Ac`, value: As * 1e4, limit: aMaxRatio * Ac * 1e4, unit: 'cm²', kind: 'max', severity: 'error', ref: 'NBR 6122, Tab. 4, nota c' })
  add({ id: 'clear', group: 'detalhamento', name: 'Espaçamento livre entre barras ≥ máx[20 mm; φ; 1,2·dmáx]', value: (sc - phi) * 1000, limit: clearMin * 1000, unit: 'mm', kind: 'min', severity: 'error', ref: 'NBR 6118, 18.3.3.2' })
  add({ id: 'axis', group: 'detalhamento', name: 'Espaçamento entre eixos das barras ≤ mín[2·D; 400 mm]', value: sc * 1000, limit: Math.min(2 * D, 0.4) * 1000, unit: 'mm', kind: 'max', severity: 'error', ref: 'NBR 6118, 18.3.3.2' })
  add({ id: 'phit', group: 'detalhamento', name: 'Diâmetro da transversal ≥ máx[5 mm; φ/4]', value: a.phitMm, limit: Math.max(5, a.phiMm / 4), unit: 'mm', kind: 'min', severity: 'error', ref: 'NBR 6118, 18.4.3' })
  add({ id: 'rs', group: 'detalhamento', name: 'Gaiola cabe na seção (raio dos centros das barras > 5 cm)', value: Rs * 100, limit: 5, unit: 'cm', kind: 'min', severity: 'error', ref: 'cobrimento + φt + φ/2' })
  add({ id: 'sprac', group: 'detalhamento', name: 'Espaçamento da transversal ≥ 5 cm (execução)', value: a.spacing * 100, limit: 5, unit: 'cm', kind: 'min', severity: 'warn', ref: 'recomendação prática (vibração/concretagem)' })
  if (t4 && fck < t4.fck - 1e-9) add({ id: 'fck', group: 'detalhamento', name: 'fck ≥ mínimo da Tab. 4', value: fck, limit: t4.fck, unit: 'MPa', kind: 'min', severity: 'warn', ref: 'NBR 6122, Tab. 4' })

  // ---- quantitativos
  const zEnd = Math.min(inp.L, a.cageLength)
  const Rc = D / 2 - cover - phit / 2
  const hook = 2 * Math.max(5 * phit, 0.05)
  let transLength: number
  if (a.transverse === 'estribo') transLength = (Math.ceil(zEnd / a.spacing) + 1) * (2 * Math.PI * Rc + hook)
  else transLength = (zEnd / a.spacing) * Math.hypot(2 * Math.PI * Rc, a.spacing) + 4 * 2 * Math.PI * Rc
  const longKg = STEEL_DENSITY * As * (zEnd + a.anchorage)
  const transKg = STEEL_DENSITY * Ast * transLength

  return {
    ok: checks.every((c) => c.ok || c.severity === 'warn'),
    checks, perSet, critical, curve, mat, Rs, cover, As, rho: As / Ac, NdMax, NRd,
    shear: { ...shear, VRd2: vrd2, AswCalc: aswCalcMax * 1e4, AswEf: aswEf * 1e4, sReqMin },
    required: { cageLength: cageReq, zReq, lbNec, minArmedLength: minLen, sMax: sRule },
    weights: { longKg, transKg, totalKg: longKg + transKg, kgPerM3: (longKg + transKg) / (Ac * inp.L) },
    fck, gammaC,
  }
}

/** Projeto estrutural equivalente à armadura do usuário (para DXF, memorial e quadros), com o resultado da verificação. */
export function designFromArmor(base: StructuralDesign, v: PileVerification, a: PileArmor): StructuralDesign {
  const fails = v.checks.filter((c) => !c.ok && c.severity === 'error').map((c) => c.name)
  const cage = a.cageLength
  const crit = v.critical.FS
  return {
    ...base,
    feasible: v.ok,
    reasons: fails,
    warnings: [...new Set([...base.warnings, `Armadura definida pelo usuário (${a.n}Ø${a.phiMm}; ${a.transverse === 'estribo' ? 'estribos' : 'helicoidal'} Ø${a.phitMm} c/${fx((a.spacing * 100), 1)} cm; gaiola ${fx(cage, 2)} m) — ${v.ok ? 'verificada: atende' : 'NÃO ATENDE: ' + fails.join('; ')}. Esforços não reanalisados com esta armadura.`])],
    longitudinal: { n: a.n, phiMm: a.phiMm, As: v.As, rho: v.rho, Rs: v.Rs, utilization: Number.isFinite(crit) && crit > 0 ? 1 / crit : 0 },
    cageLength: cage,
    lbNec: v.required.lbNec,
    anchorage: a.anchorage,
    transverse: { type: a.transverse, phiMm: a.phitMm, zones: [{ from: 0, to: cage, spacing: a.spacing }], AswOverS: v.shear.AswEf / 1e4 },
    weights: v.weights,
    shear: { VSdMax: v.shear.Vd, VRd2: v.shear.VRd2, Vc: base.shear?.Vc ?? 0, ok: v.shear.AswEf >= v.shear.AswCalc - 1e-9 },
    maxUtilization: Number.isFinite(crit) && crit > 0 ? 1 / crit : 0,
  }
}

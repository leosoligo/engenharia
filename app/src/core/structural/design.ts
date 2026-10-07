/**
 * Dimensionamento estrutural de estaca circular moldada in loco: armadura longitudinal, armadura transversal
 * (estribos ou helicoidal), comprimento da gaiola e quantitativos.
 *
 * Normas:
 *  - ABNT NBR 6122:2022, 8.6.2–8.6.3 e Tab. 4 (concreto mínimo, γc, armadura mínima 0,4 %, comprimento útil mínimo
 *    da armadura, taxa máxima 8 %/6 %, espaçamento ≥ 20 mm, redução de 2 mm no diâmetro das barras como espessura
 *    de sacrifício; diâmetro externo do revestimento em Strauss, Franki e raiz);
 *  - ABNT NBR 6118:2026: 7.4 (Tab. 7.2: cobrimento nominal de elementos em contato com o solo: 30/30/40/50 mm
 *    para CAA I/II/III/IV), 9.3–9.4 (ancoragem), 17.2 (flexão composta), 17.3.5.3 (As,mín = máx[0,15·Nd/fyd; 0,004·Ac];
 *    As,máx = 0,08·Ac), 17.4.1.1.1 e 17.4.2.2 (cortante, modelo I), 18.3.3.2 e 18.4 (detalhamento de pilares:
 *    φ ≥ 10 mm, φ ≤ D/8, ≥ 6 barras em seção circular, espaçamento livre ≥ máx[20 mm; φ; 1,2·dmáx],
 *    espaçamento entre eixos ≤ mín[2D; 400 mm], φt ≥ máx[5 mm; φ/4], s ≤ mín[200 mm; D; 12φ (CA-50)]).
 *
 * Hipóteses/INTERPRETAÇÕES do Estakalc (sinalizadas ao usuário):
 *  - todas as resistências do concreto usam o γc da Tab. 4 da NBR 6122 (inclusive fctd e ancoragem): conservador;
 *  - cortante em seção circular: largura bw = D e altura útil d = D/2 + 2·Rs/π (centroide da meia-coroa de barras
 *    tracionada) — a NBR 6118 não trata seção circular explicitamente;
 *  - estribo circular fechado ⇒ 2 ramos por seção (Asw = 2·Ast); helicoidal: mesma área por passo;
 *  - NBR 6118 não detalha helicoidal; adotam-se os mesmos limites de passo que para estribos;
 *  - ganchos/traspasse: 2 pontas retas de máx[5φt; 50 mm] por estribo; helicoidal: 2 voltas de fechamento em cada ponta.
 */
import {
  interactionCurve,
  barArea,
  momentCapacityFromCurve,
  type CircularSection,
  type Materials,
} from './section'
import type { PileType } from '../pile'
import { fx } from '../format'

export type Caa = 1 | 2 | 3 | 4
export type TransverseType = 'estribo' | 'helicoidal'

export const LONG_BARS_MM = [10, 12.5, 16, 20, 25, 32] as const
export const TRANS_BARS_MM = [5, 6.3, 8, 10, 12.5] as const

/** NBR 6118:2026, Tab. 7.2 — cobrimento nominal (m) de elementos em contato com o solo. */
export const COVER_SOIL: Record<Caa, number> = { 1: 0.03, 2: 0.03, 3: 0.04, 4: 0.05 }

export interface Table4Row {
  /** Concreto mínimo (MPa). */
  fck: number
  gammaC: number
  /** Comprimento mínimo armado (m) ou 'integral'. */
  minArmedLength: number | 'integral'
  /** Tensão de compressão simples abaixo da qual não é necessário armar (MPa), se existir. */
  noRebarStress?: number
}

/** NBR 6122:2022, Tab. 4 (conferida visualmente). Pré-moldada: fora do escopo (NBR 16258). */
export function table4(type: PileType, caa: Caa): Table4Row | undefined {
  const hi = caa >= 3
  switch (type) {
    case 'helice':
      return { fck: hi ? 40 : 30, gammaC: hi ? 3.6 : 2.7, minArmedLength: 4, noRebarStress: 6 }
    case 'escavada':
      return { fck: hi ? 40 : 25, gammaC: hi ? 5.0 : 3.1, minArmedLength: 2, noRebarStress: 5 }
    case 'escavada_fluido':
      return { fck: hi ? 40 : 30, gammaC: hi ? 3.6 : 2.7, minArmedLength: 4, noRebarStress: 6 }
    case 'strauss':
      return caa >= 3 ? undefined : { fck: 20, gammaC: 2.5, minArmedLength: 2, noRebarStress: 5 }
    case 'franki':
      return { fck: 20, gammaC: 1.8, minArmedLength: 'integral' }
    case 'raiz':
      return { fck: 20, gammaC: 1.6, minArmedLength: 'integral' }
    case 'premoldada':
      return undefined
  }
}

/** Tab. 4 com as edições do usuário por cima (se não há linha da norma, exige fck e γc). */
export function effectiveT4(type: PileType, caa: Caa, ov?: Partial<Table4Row>): Table4Row | undefined {
  const base = table4(type, caa)
  if (!ov || Object.keys(ov).length === 0) return base
  if (base) return { ...base, ...ov }
  return ov.fck !== undefined && ov.gammaC !== undefined ? { minArmedLength: 2, ...ov } as Table4Row : undefined
}

/** Opções estruturais editáveis (tela "Parâmetros"): sobrescrevem os padrões da NBR/literatura. */
export interface StructuralOptions {
  t4?: Partial<Record<PileType, Partial<Table4Row>>>
  cover?: number
  fyk?: number
  gammaS?: number
  dmax?: number
  sacrificial?: boolean
  /** Taxa mínima de armadura longitudinal (Tab. 4 da NBR 6122: 0,004). */
  minRho?: number
  /** Prolonga a armadura longitudinal para dentro do bloco (ancoragem l_b,nec). Padrão: sim. */
  anchorBlock?: boolean
  /** Coeficiente que divide Nd na tensão N/A comparada ao limite da Tab. 4 (padrão 1 = carga de cálculo, conservador; 1,4 = carga de serviço). */
  noRebarDivisor?: number
}

/** Esforços de cálculo ao longo da estaca (ELU), por nó. M = momento resultante incluindo a excentricidade executiva. */
export interface Demands {
  /** Distância (m) ao topo da estaca (0 = topo). */
  z: number[]
  N: number[]
  M: number[]
  V: number[]
}

export interface StructuralInput {
  type: PileType
  /** Diâmetro (m): nominal; para Strauss/Franki/raiz o externo do revestimento. */
  D: number
  /** Comprimento da estaca (m). */
  L: number
  caa: Caa
  /** fck (MPa) e γc: padrão = Tab. 4; o usuário pode adotar fck maior. */
  fck?: number
  gammaC?: number
  fyk?: number
  gammaS?: number
  cover?: number
  /** Dimensão máxima característica do agregado graúdo (m). */
  dmax?: number
  transverse: TransverseType
  /** Reduz 2 mm do diâmetro das barras longitudinais (NBR 6122, 8.6.2). */
  sacrificial?: boolean
  /** Um ou mais conjuntos de esforços (combinações × estacas); todos na mesma malha de profundidades. */
  demands: Demands | Demands[]
  /** Barra em boa aderência (vertical): η2 = 1,0; caso contrário 0,7. */
  goodBond?: boolean
  /** Edições da Tab. 4 para este tipo e taxa mínima de armadura. */
  t4?: Partial<Table4Row>
  minRho?: number
  anchorBlock?: boolean
  noRebarDivisor?: number
}

export interface LongitudinalDesign {
  n: number
  phiMm: number
  As: number
  rho: number
  Rs: number
  utilization: number
}

export interface TransverseZone {
  /** Trecho (m) a partir do topo. */
  from: number
  to: number
  spacing: number
}

export interface StructuralDesign {
  feasible: boolean
  reasons: string[]
  warnings: string[]
  fck: number
  gammaC: number
  cover: number
  longitudinal?: LongitudinalDesign
  cageLength?: number
  lbNec?: number
  /** Prolongamento da armadura longitudinal dentro do bloco (m), acima do topo da estaca; 0 = sem. */
  anchorage?: number
  /** Profundidade (m) até onde N/A supera o limite da Tab. 4 (0 = não supera ou sem limite). */
  sigmaDepth?: number
  transverse?: { type: TransverseType; phiMm: number; zones: TransverseZone[]; AswOverS: number }
  weights?: { longKg: number; transKg: number; totalKg: number; kgPerM3: number }
  shear?: { VSdMax: number; VRd2: number; Vc: number; ok: boolean }
  /** Maior razão Md/MRd na região armada. */
  maxUtilization?: number
}

const STEEL_DENSITY = 7850 // kg/m³
const mm = (x: number) => x / 1000

const fctm = (fck: number) => 0.3 * fck ** (2 / 3) // MPa

export function designStructural(inp: StructuralInput): StructuralDesign {
  const t4 = effectiveT4(inp.type, inp.caa, inp.t4)
  const reasons: string[] = []
  const warnings: string[] = []
  const fck = inp.fck ?? t4?.fck ?? NaN
  const gammaC = inp.gammaC ?? t4?.gammaC ?? NaN
  const cover = inp.cover ?? COVER_SOIL[inp.caa]
  const base: StructuralDesign = { feasible: false, reasons, warnings, fck, gammaC, cover }
  if (!t4 && (inp.fck === undefined || inp.gammaC === undefined)) {
    reasons.push(
      inp.type === 'premoldada'
        ? 'Estaca pré-moldada: dimensionamento pela NBR 16258 / dados do fabricante (fora desta rotina).'
        : 'Este tipo de estaca não consta da Tab. 4 da NBR 6122:2022 para a CAA informada: informe fck e γc.',
    )
    return base
  }
  if (fck < (t4?.fck ?? 0)) warnings.push(`fck adotado (${fck} MPa) menor que o mínimo da Tab. 4 da NBR 6122 (${t4?.fck} MPa).`)
  if (fck > 50) {
    reasons.push('Rotina implementada para fck ≤ 50 MPa.')
    return base
  }
  const fyk = inp.fyk ?? 500
  const gammaS = inp.gammaS ?? 1.15
  const mat: Materials = { fck, gammaC, fyk, gammaS }
  const fyd = (fyk / gammaS) * 1000 // kPa
  const D = inp.D
  const Ac = (Math.PI * D * D) / 4
  const dmax = inp.dmax ?? 0.019
  const sacr = inp.sacrificial ?? true
  const sets: Demands[] = Array.isArray(inp.demands) ? inp.demands : [inp.demands]
  const demands = sets[0] // malha comum (z)
  const NdMax = Math.max(...sets.flatMap((d) => d.N), 0)
  const MdMax = Math.max(...sets.flatMap((d) => d.M.map(Math.abs)))
  const VdMax = Math.max(...sets.flatMap((d) => d.V.map(Math.abs)))

  // -------- armadura transversal: diâmetro mínimo depende da barra longitudinal → escolhida junto
  const aMin = Math.max((inp.minRho ?? 0.004) * Ac, (0.15 * NdMax) / fyd)
  const aMaxRatio = D >= 0.4 ? 0.06 : 0.08
  const aMax = aMaxRatio * Ac
  if (D > 0.31 && D < 0.4) warnings.push('NBR 6122, Tab. 4, nota c: taxa máxima de 8 % (≤ 310 mm) ou 6 % (≥ 400 mm); entre 310 e 400 mm foi adotado 6 % (conservador).')

  type Cand = { n: number; phi: number; phit: number; Rs: number; sec: CircularSection; As: number }
  const cands: Cand[] = []
  for (const phiMmL of LONG_BARS_MM) {
    const phi = mm(phiMmL)
    if (phi > D / 8) continue
    for (const phiMmT of TRANS_BARS_MM) {
      const phit = mm(phiMmT)
      if (phit < Math.max(0.005, phi / 4) - 1e-9) continue
      const Rs = D / 2 - cover - phit - phi / 2
      if (Rs <= 0.05) continue
      for (let n = 6; n <= 40; n++) {
        const sc = 2 * Rs * Math.sin(Math.PI / n)
        if (sc - phi < Math.max(0.02, phi, 1.2 * dmax)) break // espaçamento livre mínimo
        if (sc > Math.min(2 * D, 0.4)) continue // espaçamento máximo entre eixos
        const phiRes = sacr ? Math.max(phi - 0.002, 0.005) : phi
        const sec: CircularSection = { D, n, phi: phiRes, Rs }
        const As = n * barArea(phi) // área nominal: usada nos limites de taxa
        if (As < aMin || As > aMax) continue
        cands.push({ n, phi, phit, Rs, sec, As })
      }
    }
  }
  if (cands.length === 0) {
    reasons.push('Nenhuma combinação de barras atende aos limites de taxa e espaçamento (NBR 6118/6122).')
    return base
  }
  // ordena por massa longitudinal por metro (A_s) e depois pelo diâmetro do estribo
  cands.sort((a, b) => a.As - b.As || a.phit - b.phit)

  const fctmMPa = fctm(fck)
  const fctd = (0.7 * fctmMPa * 1000) / gammaC // kPa
  const fctkInf = 0.7 * fctmMPa * 1000 // kPa
  const fcd = (fck / gammaC) * 1000
  const eta2 = inp.goodBond === false ? 0.7 : 1.0
  const fbd = 2.25 * eta2 * 1.0 * fctd
  const W = (Math.PI * D ** 3) / 32 // módulo resistente da seção bruta
  const nz = demands.z.length
  // nó/conjunto crítico (maior |M|) avaliado primeiro, para descartar candidatos rapidamente
  let sMax = 0
  let iMax = 0
  sets.forEach((d, k) => d.M.forEach((m, i) => { if (Math.abs(m) > Math.abs(sets[sMax].M[iMax])) { sMax = k; iMax = i } }))

  const evaluate = (c: Cand): StructuralDesign | undefined => {
    const curve = interactionCurve(c.sec, mat)
    // flexão composta: razão Md/MRd (nó crítico primeiro, depois os demais, em todos os conjuntos)
    let umax = 0
    const checks: [number, number][] = [[sMax, iMax]]
    sets.forEach((_, k) => demands.z.forEach((__, i) => { if (!(k === sMax && i === iMax)) checks.push([k, i]) }))
    for (const [k, i] of checks) {
      const mrd = momentCapacityFromCurve(curve, sets[k].N[i])
      if (!(mrd > 0)) return undefined
      const u = Math.abs(sets[k].M[i]) / mrd
      if (u > 1) return undefined
      umax = Math.max(umax, u)
    }

    // comprimento armado: até onde Md excede a capacidade da seção com a armação mínima (6 barras de 10 mm)
    const minCurve = interactionCurve({ D, n: 6, phi: sacr ? 0.008 : 0.01, Rs: c.Rs }, mat, 30)
    let zReq = 0
    let zAxial = 0 // até onde o normal supera a capacidade da seção com a armação mínima
    for (const d of sets)
      for (let i = 0; i < nz; i++) {
        const capMin = momentCapacityFromCurve(minCurve, d.N[i])
        if (!(capMin > 0)) zAxial = Math.max(zAxial, d.z[i])
        if (!(capMin > 0) || Math.abs(d.M[i]) > capMin) zReq = Math.max(zReq, d.z[i])
      }
    const lb = (c.phi / 4) * (fyd / fbd)
    const lbMin = Math.max(0.3 * lb, 10 * c.phi, 0.1)
    const tensioned = sets.some((d) => d.N.some((v) => v < -1e-6))
    // estaca tracionada: ancoragem plena (l_b), sem redução por folga de armadura
    const lbNec = tensioned ? Math.max(lb, lbMin) : Math.max(lb * Math.min(1, Math.max(umax, 0.01)), lbMin) // As,calc/As,ef ≈ utilização
    const minLen = t4?.minArmedLength === 'integral' ? inp.L : (t4?.minArmedLength ?? 0)
    // NBR 6122:2022, 8.6.3 e Tab. 4: onde a tensão de compressão simples N/A supera o limite da tabela, a estaca deve ser armada
    // (a armadura de flexão pode terminar antes; o esforço normal diminui com o atrito lateral)
    const sigLim = t4?.noRebarStress
    let zSig = 0
    if (sigLim !== undefined) {
      const div = inp.noRebarDivisor && inp.noRebarDivisor > 0 ? inp.noRebarDivisor : 1
      for (const d of sets) for (let i = 0; i < nz; i++) if (Math.max(d.N[i], 0) / div / Ac / 1000 > sigLim) zSig = Math.max(zSig, d.z[i])
    }
    const cageLength = Math.min(inp.L, Math.max(minLen, zReq + lbNec, zSig))

    // cortante (modelo I) e espaçamentos
    const bw = D
    const d_ = D / 2 + (2 * c.Rs) / Math.PI
    const vrd2 = 0.27 * (1 - fck / 250) * fcd * bw * d_
    const fywd = Math.min((c.phit === 0.005 ? 600 : fyk) / gammaS, 435) * 1000
    const Ast = (Math.PI * c.phit ** 2) / 4
    const sRule = Math.min(0.2, D, 12 * c.phi) // 18.4.3 (CA-50)
    const sMinVib = 0.05 // espaçamento mínimo prático (não normativo)
    const raw: number[] = new Array<number>(nz).fill(sRule)
    for (const d of sets)
      for (let i = 0; i < nz; i++) {
        const Vsd = Math.abs(d.V[i])
        const Md = Math.abs(d.M[i])
        const Nd = d.N[i]
        if (Vsd > vrd2) return undefined
        const vc0 = 0.6 * fctd * bw * d_
        const m0 = (Math.max(Nd, 0) * D) / 8 // M0 = N·W/A para seção circular
        const vc = Md > 0 ? Math.min(vc0 * (1 + m0 / Md), 2 * vc0) : 2 * vc0
        // 17.4.1.1.2-c: pilares/estacas predominantemente comprimidos, em estádio I sem ultrapassar fctk e Vsd ≤ Vc:
        // dispensa a armadura mínima de cortante (vale então a Seção 18)
        const sigmaT = Md / W - Nd / Ac
        const exempt = Nd > 0 && sigmaT <= fctkInf && Vsd <= vc
        if (exempt) continue
        const vsw = Math.max(Vsd - vc, 0)
        const aswMin = ((0.2 * fctmMPa) / fyk) * bw // ρsw,mín · bw (α = 90°)
        const aswOverS = Math.max(vsw / (0.9 * d_ * fywd), aswMin)
        const sShear = (2 * Ast) / aswOverS
        const sShearMax = Vsd <= 0.67 * vrd2 ? Math.min(0.6 * d_, 0.3) : Math.min(0.3 * d_, 0.2)
        if (sShear < sMinVib) return undefined
        raw[i] = Math.min(raw[i], sShear, sShearMax, sRule)
      }
    const quant = raw.map((s) => Math.max(Math.floor(s / 0.025) * 0.025, sMinVib))
    const zEnd = Math.min(inp.L, cageLength)
    const zones: TransverseZone[] = []
    let curFrom = 0
    let curS = quant[0]
    for (let i = 1; i < nz; i++) {
      if (quant[i] !== curS) {
        const to = Math.min(demands.z[i], zEnd)
        if (to > curFrom) zones.push({ from: curFrom, to, spacing: curS })
        curFrom = Math.max(curFrom, to)
        curS = quant[i]
      }
    }
    if (zEnd > curFrom) zones.push({ from: curFrom, to: zEnd, spacing: curS })

    // quantitativos
    const Rc = D / 2 - cover - c.phit / 2
    let transLength = 0
    const hook = 2 * Math.max(5 * c.phit, 0.05)
    zones.forEach((zn, k) => {
      const len = zn.to - zn.from
      if (inp.transverse === 'estribo') {
        const count = Math.ceil(len / zn.spacing) + (k === 0 ? 1 : 0)
        transLength += count * (2 * Math.PI * Rc + hook)
      } else {
        transLength += (len / zn.spacing) * Math.hypot(2 * Math.PI * Rc, zn.spacing)
      }
    })
    if (inp.transverse === 'helicoidal') transLength += 4 * 2 * Math.PI * Rc // 2 voltas de fechamento em cada ponta
    const AsNom = c.n * ((Math.PI * c.phi ** 2) / 4)
    const anchorage = inp.anchorBlock === false ? 0 : Math.ceil(lbNec * 20 - 1e-9) / 20 // múltiplo de 5 cm
    const longKg = STEEL_DENSITY * AsNom * (cageLength + anchorage)
    const transKg = STEEL_DENSITY * Ast * transLength
    const vol = Ac * inp.L
    const maxSpacing = Math.max(...zones.map((zn) => zn.spacing))
    const w = [...warnings]
    if (inp.transverse === 'helicoidal') w.push('NBR 6118 não detalha armadura helicoidal: usados os limites de passo dos estribos (18.4.3 e 18.3.3.2).')
    w.push('Cortante em seção circular: bw = D e d = D/2 + 2·Rs/π (interpretação; a norma não trata seção circular).')
    w.push('Resistências do concreto (inclusive fctd e ancoragem) com o γc da Tab. 4 da NBR 6122 — conservador.')
    if (cageLength > minLen + 1e-9) {
      const flex = zReq + lbNec
      const why = zSig >= flex - 1e-9 && zSig > 0 ? `tensão N/A acima do limite da Tab. 4 até ${fx(zSig, 1)} m`
        : zAxial >= zReq - 1e-9 && zAxial > 0 ? `esforço normal acima da capacidade da seção com a armação mínima até ${fx(zAxial, 1)} m (mais a ancoragem)`
          : `momento fletor acima da capacidade da seção com a armação mínima até ${fx(zReq, 1)} m (mais a ancoragem)`
      w.push(`Comprimento da gaiola (${fx(cageLength, 1)} m) governado por: ${why}.`)
    }
    if (zSig > Math.max(minLen, zReq + lbNec) + 1e-9) w.push(`Armadura estendida até ${fx(zSig, 1)} m: a tensão de compressão N/A supera ${sigLim} MPa (NBR 6122:2022, Tab. 4) até essa profundidade.`)
    if (tensioned) w.push(`Estaca tracionada em alguma combinação: flexo-tração dimensionada com a tração constante ao longo do fuste e ancoragem plena da armadura no bloco (l_b = ${fx(lbNec * 100, 0)} cm); verifique emendas e a altura do bloco (NBR 6118, 9.4; NBR 6122, 5.8).`)
    if (sacr) w.push('Redução de 2 mm no diâmetro das barras longitudinais (NBR 6122:2022, 8.6.2) aplicada.')
    return {
      feasible: true, reasons: [], warnings: [...new Set(w)], fck, gammaC, cover,
      longitudinal: { n: c.n, phiMm: c.phi * 1000, As: AsNom, rho: AsNom / Ac, Rs: c.Rs, utilization: umax },
      cageLength, lbNec, anchorage, sigmaDepth: zSig,
      transverse: { type: inp.transverse, phiMm: c.phit * 1000, zones, AswOverS: (2 * Ast) / maxSpacing },
      weights: { longKg, transKg, totalKg: longKg + transKg, kgPerM3: (longKg + transKg) / vol },
      shear: { VSdMax: VdMax, VRd2: vrd2, Vc: 0.6 * fctd * bw * d_, ok: true },
      maxUtilization: umax,
    }
  }

  // varre as combinações viáveis e escolhe a de menor massa de aço (longitudinal + transversal)
  let best: StructuralDesign | undefined
  for (const c of cands) {
    // poda: a massa longitudinal já excede a melhor solução
    if (best && STEEL_DENSITY * c.As * Math.min(inp.L, 4) > best.weights!.totalKg * 3) break
    const r = evaluate(c)
    if (r && (!best || r.weights!.totalKg < best.weights!.totalKg)) best = r
  }
  if (best) return best
  reasons.push(
    `Nenhuma armadura atende: Md máx = ${fx(MdMax, 0)} kN·m, Nd máx = ${fx(NdMax, 0)} kN, Vd máx = ${fx(VdMax, 0)} kN. Aumente o diâmetro ou a classe do concreto.`,
  )
  return base
}

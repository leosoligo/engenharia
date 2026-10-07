/**
 * Estaca vertical carregada lateralmente: viga-coluna de elementos finitos (Hermite, 2 GDL por nó: y e θ)
 * sobre molas não lineares de Winkler (curvas p-y), com efeito P-Δ (matriz de rigidez geométrica) e
 * condições de apoio do topo definidas pelo usuário.
 *
 * Convenções (z para baixo a partir da superfície do terreno; y horizontal, positivo no sentido de H):
 *   M(z) = EI·y''  (M(topo) = momento aplicado, positivo quando acompanha H > 0, como M = H·e);
 *   V(z) = EI·y''' + N·y'  (V(topo) = H);  rotação θ = −dy/dz (positiva quando o topo tende a ir para +y).
 *   N > 0 = compressão (constante ao longo da estaca: hipótese conservadora, ignora o alívio por atrito lateral).
 * Unidades: kN, m.
 */
import { layerAt, stressesAt, type LateralLayer, type LateralProfile } from './soilProfile'
import { pyLinear, pySand, pySoftClay, pyStiffClay, type Loading, type PyResult } from './pyCurves'
import { fx } from '../format'

export type Restraint = 'free' | 'fixed' | { spring: number }

export interface HeadCondition {
  /** Deslocamento horizontal do topo: livre, impedido (viga de travamento) ou mola (kN/m). */
  translation: Restraint
  /** Rotação do topo: livre (articulada), impedida (engastada no bloco rígido) ou mola (kN·m/rad). */
  rotation: Restraint
}

export interface LateralInput {
  profile: LateralProfile
  /** Diâmetro (m) da estaca (largura carregada B da curva p-y). */
  B: number
  /** Rigidez à flexão EI (kN·m²). */
  EI: number
  /** EI por elemento (sobrepõe EI) — preenchido pela iteração de rigidez não linear. */
  EIe?: number[]
  /** Rigidez secante EI(M) (kN·m²) em função do momento (kN·m), p.ex. da curva momento-curvatura. */
  EIfn?: (M: number) => number
  /** Comprimento total da estaca, do topo à ponta (m). */
  length: number
  /** Profundidade do topo abaixo do terreno (m). Negativa = topo acima do terreno (trecho livre). */
  topDepth: number
  /** Cargas no topo: H (kN), M (kN·m), N de compressão (kN). */
  H: number
  M: number
  N: number
  head: HeadCondition
  loading: Loading
  /** Forma do esforço normal ao longo da estaca: N(z)/N_topo em função da profundidade z abaixo do topo (m). Padrão: constante (1). */
  axialShape?: (z: number) => number
  /** Fator multiplicador da reação do solo (efeito de grupo). Padrão 1. */
  pScale?: number
  /** Comprimento alvo dos elementos (m). Padrão min(0,25; B/2). */
  elementLength?: number
}

export interface LateralResult {
  z: number[] // profundidade a partir do terreno (m)
  y: number[]
  theta: number[]
  M: number[]
  V: number[]
  p: number[] // kN/m
  /** Mobilização p/pu (0–1+); NaN no modelo linear. */
  mobilization: number[]
  headDisplacement: number
  headRotation: number
  maxMoment: { value: number; z: number }
  maxShear: { value: number; z: number }
  maxDisplacement: { value: number; z: number }
  /** Carga axial crítica de flambagem (kN) com a rigidez secante do solo no estado calculado. */
  criticalLoad: number
  /** λ = Pcr/N (∞ se N = 0). */
  bucklingFactor: number
  /** Comprimento equivalente de flambagem Le = π·√(EI/Pcr) (m): comprimento de uma haste biarticulada com a mesma carga crítica (0 se Pcr infinita). */
  bucklingLength: number
  converged: boolean
  unstable: boolean
  iterations: number
  warnings: string[]
  /** Rigidez secante do solo em cada nó (kN/m²), já com o fator de grupo. */
  Es: number[]
  /** EI usado em cada elemento (kN·m²) — varia com o momento quando EIfn é informado. */
  EIe: number[]
}

// ------------------------------------------------------------------ álgebra banda (Cholesky)

/** Matriz simétrica em banda: a[i][d] = A(i, i−d), d = 0…bw. */
class Band {
  readonly n: number
  readonly bw: number
  a: Float64Array[]
  constructor(n: number, bw: number) {
    this.n = n
    this.bw = bw
    this.a = Array.from({ length: n }, () => new Float64Array(bw + 1))
  }
  add(i: number, j: number, v: number) {
    if (j > i) [i, j] = [j, i]
    this.a[i][i - j] += v
  }
  copy(): Band {
    const b = new Band(this.n, this.bw)
    b.a = this.a.map((r) => Float64Array.from(r))
    return b
  }
  /** Fatora in-place (A = L·Lᵀ). Retorna false se a matriz não for positiva definida. */
  cholesky(): boolean {
    const { n, bw, a } = this
    for (let i = 0; i < n; i++) {
      for (let j = Math.max(0, i - bw); j <= i; j++) {
        let s = a[i][i - j]
        for (let k = Math.max(0, i - bw, j - bw); k < j; k++) s -= a[i][i - k] * a[j][j - k]
        if (i === j) {
          if (!(s > 0) || !Number.isFinite(s)) return false
          a[i][0] = Math.sqrt(s)
        } else a[i][i - j] = s / a[j][0]
      }
    }
    return true
  }
  /** Resolve L·Lᵀ x = b (após cholesky()). */
  solve(b: Float64Array): Float64Array {
    const { n, bw, a } = this
    const x = Float64Array.from(b)
    for (let i = 0; i < n; i++) {
      let s = x[i]
      for (let k = Math.max(0, i - bw); k < i; k++) s -= a[i][i - k] * x[k]
      x[i] = s / a[i][0]
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = x[i]
      for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= a[k][k - i] * x[k]
      x[i] = s / a[i][0]
    }
    return x
  }
}

// ------------------------------------------------------------------ elemento

function elementStiffness(EI: number, L: number): number[][] {
  const c = EI / L ** 3
  return [
    [12 * c, 6 * L * c, -12 * c, 6 * L * c],
    [6 * L * c, 4 * L * L * c, -6 * L * c, 2 * L * L * c],
    [-12 * c, -6 * L * c, 12 * c, -6 * L * c],
    [6 * L * c, 2 * L * L * c, -6 * L * c, 4 * L * L * c],
  ]
}

/** Matriz de rigidez geométrica para N = 1 (compressão positiva reduz a rigidez: K − N·kG). */
function geometricStiffness(L: number): number[][] {
  const c = 1 / (30 * L)
  return [
    [36 * c, 3 * L * c, -36 * c, 3 * L * c],
    [3 * L * c, 4 * L * L * c, -3 * L * c, -L * L * c],
    [-36 * c, -3 * L * c, 36 * c, -3 * L * c],
    [3 * L * c, -L * L * c, -3 * L * c, 4 * L * L * c],
  ]
}

// ------------------------------------------------------------------ solo

export function soilReaction(profile: LateralProfile, layer: LateralLayer, z: number, B: number, y: number, loading: Loading): PyResult {
  if (z <= 0) return { p: 0, pu: 0, Es: 0 }
  const { sigmaV, gammaAvg, suAvg } = stressesAt(profile, z)
  switch (layer.model) {
    case 'sand':
      return pySand({ z, B, sigmaV, phi: layer.phi, k: layer.kSand, loading }, y)
    case 'softClay':
      return pySoftClay({ z, B, sigmaV, su: layer.su, epsC: layer.epsC, J: layer.J, loading }, y)
    case 'stiffClay':
      return pyStiffClay(
        { z, B, su: layer.su, suAvg, gammaAvg, ks: layer.ks, kc: layer.kc, epsC: layer.epsC, loading },
        y,
      )
    case 'linear':
      return pyLinear({ z, B, nh: layer.nh }, y)
  }
}

// ------------------------------------------------------------------ análise

export interface Model {
  ne: number
  dz: number
  zNode: number[] // profundidade a partir do terreno
  trib: number[] // comprimento tributário de cada nó
  layers: (LateralLayer | null)[]
}

export function buildModel(inp: LateralInput): Model {
  const target = inp.elementLength ?? Math.min(0.25, inp.B / 2)
  const ne = Math.max(4, Math.ceil(inp.length / target))
  const dz = inp.length / ne
  const zNode = Array.from({ length: ne + 1 }, (_, i) => inp.topDepth + i * dz)
  const trib = zNode.map((_, i) => (i === 0 || i === ne ? dz / 2 : dz))
  const layers = zNode.map((z) => (z > 0 ? layerAt(inp.profile, z) : null))
  return { ne, dz, zNode, trib, layers }
}

/** Fração do N do topo em cada elemento (no ponto médio); 1 se não há perfil de normal. */
export function elementShapes(inp: LateralInput, m: Model): number[] {
  return Array.from({ length: m.ne }, (_, e) => (inp.axialShape ? inp.axialShape((m.zNode[e] + m.zNode[e + 1]) / 2 - inp.topDepth) : 1))
}

export function assemble(inp: LateralInput, m: Model, Es: number[], nFactor: number, shapes?: number[]): Band {
  const nn = m.ne + 1
  const K = new Band(2 * nn, 3)
  const kg = geometricStiffness(m.dz)
  const sh = shapes ?? elementShapes(inp, m)
  for (let e = 0; e < m.ne; e++) {
    const ke = elementStiffness(inp.EIe?.[e] ?? inp.EI, m.dz)
    const dof = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3]
    for (let a = 0; a < 4; a++)
      for (let b = 0; b <= a; b++) K.add(dof[a], dof[b], ke[a][b] - nFactor * sh[e] * kg[a][b])
  }
  for (let i = 0; i < nn; i++) if (Es[i] > 0) K.add(2 * i, 2 * i, Es[i] * m.trib[i])
  const big = (kind: 'y' | 'r') => (kind === 'y' ? 1e8 * inp.EI / m.dz ** 3 : 1e8 * inp.EI / m.dz)
  const apply = (dof: number, r: Restraint, kind: 'y' | 'r') => {
    if (r === 'fixed') K.add(dof, dof, big(kind))
    else if (r !== 'free') K.add(dof, dof, r.spring)
  }
  apply(0, inp.head.translation, 'y')
  apply(1, inp.head.rotation, 'r')
  return K
}

/** Comprimento equivalente de flambagem Le = π·√(EI/Pcr) (m). */
export function effectiveBucklingLength(EI: number, Pcr: number): number {
  return Pcr > 0 && Number.isFinite(Pcr) ? Math.PI * Math.sqrt(EI / Pcr) : 0
}

/** Maior N (kN) para o qual K_base − N·K_G ainda é positiva definida (rigidez do solo congelada em Es). */
export function criticalLoad(inp: LateralInput, m: Model, Es: number[]): number {
  const shapes = elementShapes(inp, m)
  const pd = (f: number) => assemble(inp, m, Es, f, shapes).cholesky()
  if (!pd(0)) return 0
  let hi = 1
  while (pd(hi) && hi < 1e10) hi *= 2
  if (hi >= 1e10) return Infinity
  let lo = hi / 2
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (lo + hi)
    if (pd(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** Reação do solo em todos os nós para um campo de deslocamentos (com o fator de grupo `pScale`). */
export function evalSoilNodes(inp: LateralInput, m: Model, yv: ArrayLike<number>): PyResult[] {
  const f = inp.pScale ?? 1
  return m.zNode.map((z, i) => {
    const layer = m.layers[i]
    if (!layer) return { p: 0, pu: 0, Es: 0 }
    const r = soilReaction(inp.profile, layer, z, inp.B, yv[i], inp.loading)
    return { p: r.p * f, pu: r.pu * f, Es: r.Es * f }
  })
}

/** Resolve com a rigidez do solo congelada (Es) para cargas de topo H e M (convenção do módulo). */
export function solveFrozen(inp: LateralInput, m: Model, Es: number[], H: number, M: number, N = inp.N) {
  const K = assemble({ ...inp, N }, m, Es, N)
  if (!K.cholesky()) return undefined
  const nn = m.ne + 1
  const F = new Float64Array(2 * nn)
  F[0] = H
  F[1] = -M
  const u = K.solve(F)
  return {
    u,
    y: Array.from({ length: nn }, (_, i) => u[2 * i]),
    theta: Array.from({ length: nn }, (_, i) => -u[2 * i + 1]),
  }
}

/** Momento M(z) e cortante V(z) nos nós, pelas forças nodais dos elementos (convenção do módulo). */
export function memberForces(inp: LateralInput, m: Model, u: ArrayLike<number>, N = inp.N) {
  const nn = m.ne + 1
  const Mn = new Array<number>(nn).fill(0)
  const Vn = new Array<number>(nn).fill(0)
  const cnt = new Array<number>(nn).fill(0)
  const kg = geometricStiffness(m.dz)
  const sh = elementShapes(inp, m)
  for (let e = 0; e < m.ne; e++) {
    const ke = elementStiffness(inp.EIe?.[e] ?? inp.EI, m.dz)
    const ue = [u[2 * e], u[2 * e + 1], u[2 * e + 2], u[2 * e + 3]]
    const f = [0, 0, 0, 0]
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) f[a] += (ke[a][b] - N * sh[e] * kg[a][b]) * ue[b]
    Vn[e] += f[0]
    Mn[e] += -f[1]
    Vn[e + 1] += -f[2]
    Mn[e + 1] += f[3]
    cnt[e]++
    cnt[e + 1]++
  }
  for (let i = 0; i < nn; i++) {
    Mn[i] /= cnt[i]
    Vn[i] /= cnt[i]
  }
  return { M: Mn, V: Vn }
}

export function analyzeLateral(inp: LateralInput): LateralResult {
  const warnings: string[] = []
  const m = buildModel(inp)
  const nn = m.ne + 1
  const ndof = 2 * nn
  const y = new Float64Array(nn)
  const Es = new Array<number>(nn).fill(0)
  const evalSoil = (yv: Float64Array | number[]) => evalSoilNodes(inp, m, yv)

  // chute inicial: deslocamento de referência pequeno → rigidez inicial das curvas
  const y0 = new Float64Array(nn).fill(1e-4)
  evalSoil(y0).forEach((r, i) => (Es[i] = Number.isFinite(r.Es) ? r.Es : (r.pu / 1e-4) * 0.5))

  const F = new Float64Array(ndof)
  F[0] = inp.H
  F[1] = -inp.M // M > 0 acompanha H > 0 (M = H·e): tende a deslocar o topo para +y

  let converged = false
  let unstable = false
  let iter = 0
  let u = new Float64Array(ndof)
  const MAXIT = 200
  let relax = 1
  let prevDelta = Infinity
  let EIe: number[] | undefined = inp.EIfn ? Array.from({ length: m.ne }, () => inp.EIfn!(0)) : inp.EIe
  let work: LateralInput = EIe ? { ...inp, EIe } : inp
  for (iter = 1; iter <= MAXIT; iter++) {
    const K = assemble(work, m, Es, inp.N)
    if (!K.cholesky()) {
      unstable = true
      break
    }
    const uNew = K.solve(F)
    let delta = 0
    let scale = 1e-6
    for (let i = 0; i < nn; i++) {
      delta = Math.max(delta, Math.abs(uNew[2 * i] - u[2 * i]))
      scale = Math.max(scale, Math.abs(uNew[2 * i]))
    }
    if (delta > prevDelta * 0.98 && iter > 5) relax = Math.max(0.2, relax * 0.7)
    prevDelta = delta
    for (let i = 0; i < ndof; i++) u[i] = u[i] + relax * (uNew[i] - u[i])
    for (let i = 0; i < nn; i++) y[i] = u[2 * i]
    evalSoil(y).forEach((r, i) => {
      const e = Number.isFinite(r.Es) ? r.Es : (r.pu / Math.max(Math.abs(y[i]), 1e-6)) * 0.5
      Es[i] = Math.max(e, 0)
    })
    let dEI = 0
    if (inp.EIfn && EIe) {
      const { M: Mn0 } = memberForces(work, m, u)
      EIe = EIe.map((prev, e) => {
        const nw = inp.EIfn!(0.5 * (Math.abs(Mn0[e]) + Math.abs(Mn0[e + 1])))
        const val = 0.5 * prev + 0.5 * nw
        dEI = Math.max(dEI, Math.abs(val - prev) / prev)
        return val
      })
      work = { ...inp, EIe }
    }
    if (delta < 1e-9 + 1e-6 * scale && dEI < 1e-4) {
      converged = true
      break
    }
  }
  if (!converged && !unstable) warnings.push('A iteração das curvas p-y não convergiu em 200 passos; resultados indicativos.')
  if (unstable)
    warnings.push(
      'Matriz de rigidez perdeu positividade: o sistema estaca-solo é instável (flambagem/ruptura) para as cargas e condições de apoio informadas.',
    )

  const { M: Mn, V: Vn } = memberForces(work, m, u)

  const soil = evalSoil(y)
  const theta = Array.from({ length: nn }, (_, i) => -u[2 * i + 1]) // positiva quando o topo tende a ir para +y
  const pArr = soil.map((s) => s.p)
  const mob = soil.map((s, i) => (m.layers[i] && Number.isFinite(s.pu) && s.pu > 0 ? Math.abs(s.p) / s.pu : NaN))

  const argmax = (arr: number[]) => {
    let k = 0
    for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i]) > Math.abs(arr[k])) k = i
    return { value: arr[k], z: m.zNode[k] }
  }
  const yArr = Array.from(y)

  // flambagem (rigidez secante do solo no estado calculado)
  const Pcr = unstable ? 0 : criticalLoad(work, m, Es)
  const lambda = inp.N > 0 ? Pcr / inp.N : Infinity
  if (inp.N > 0 && lambda < 3)
    warnings.push(`Coeficiente de segurança à flambagem λ = ${fx(lambda, 2)} (< 3): efeitos de 2ª ordem relevantes — verifique (NBR 6122:2022, 8.6.1).`)

  // estaca curta / comportamento rígido
  const ymax = Math.max(...yArr.map(Math.abs), 1e-12)
  if (Math.abs(yArr[nn - 1]) > 0.1 * ymax)
    warnings.push('Deslocamento na ponta > 10 % do máximo: estaca curta (comportamento rígido); a condição de ponta influencia o resultado.')
  const mobMax = Math.max(...mob.filter((v) => Number.isFinite(v)), 0)
  if (mobMax >= 0.99) warnings.push('Solo plastificado (p = pu) em parte do fuste: resultados sensíveis ao carregamento.')

  return {
    z: m.zNode,
    y: yArr,
    theta,
    M: Mn,
    V: Vn,
    p: pArr,
    mobilization: mob,
    headDisplacement: yArr[0],
    headRotation: theta[0],
    maxMoment: argmax(Mn),
    maxShear: argmax(Vn),
    maxDisplacement: argmax(yArr),
    criticalLoad: Pcr,
    bucklingFactor: lambda,
    bucklingLength: effectiveBucklingLength(inp.EI, Pcr),
    converged,
    unstable,
    iterations: iter,
    warnings,
    Es: Array.from(Es),
    EIe: work.EIe ? [...work.EIe] : new Array(m.ne).fill(inp.EI),
  }
}

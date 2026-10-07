/**
 * Grupo de estacas verticais sob bloco de coroamento rígido (método geral de rigidez).
 *
 * Hipóteses:
 *  - bloco infinitamente rígido, com 6 graus de liberdade no eixo do pilar (origem das coordenadas);
 *  - estacas verticais; cabeça engastada no bloco (rotação compatível com o bloco) ou articulada;
 *  - cada estaca: mola axial kv e comportamento lateral não linear (curvas p-y) em duas direções;
 *    a rigidez do solo (secante) é única por estaca e depende do deslocamento RESULTANTE |y| = √(yx² + yy²);
 *  - efeito de grupo lateral: redução da reação do solo pelo espaçamento ao vizinho mais próximo (Davisson, 1970,
 *    conforme Velloso & Lopes, §15.7: 25 % a 3B, 100 % a 8B ou mais, interpolação linear);
 *  - a solução usa as coordenadas REAIS das estacas — desvios de locação entram só alterando x, y.
 *
 * Eixos e sinais: ver `core/loads.ts` (X, Y em planta, Z para cima, mão direita; fz de compressão positivo).
 * Unidades: kN, m.
 */
import type { PileType } from '../pile'
import { pileArea } from '../pile'
import {
  buildModel,
  criticalLoad,
  effectiveBucklingLength,
  evalSoilNodes,
  memberForces,
  solveFrozen,
  type LateralInput,
  type LateralProfile,
  type Loading,
} from '../lateral'
import { fx } from '../format'

export interface GroupPile {
  id: string
  /** Coordenadas reais (executadas), m, relativas ao eixo do pilar. */
  x: number
  y: number
  /** Coordenadas de projeto (opcionais) — só para comparar com o executado. */
  x0?: number
  y0?: number
  type: PileType
  diameter: number
  /** Comprimento da estaca abaixo do bloco (m). */
  length: number
  headFixity: 'engastada' | 'articulada'
  /** Perfil de solo desta estaca (furo escolhido para a fundação). */
  profile: LateralProfile
  /** Rigidez axial kv (kN/m). Padrão E_cs·A/L (ponta indeslocável; ver aviso). */
  kv?: number
  /** Carga axial admissível/resistente de cálculo (kN), se disponível — para as verificações. */
  axialCapacity?: number
  /** Esforço normal N(z) (kN) a z metros do topo da estaca, dado o normal N do topo; sem ele o normal é constante. */
  axialProfile?: (z: number, N: number) => number
}

export interface GroupLoads {
  fx: number
  fy: number
  /** Compressão positiva. */
  fz: number
  mx: number
  my: number
  mz: number
}

export interface GroupInput {
  piles: GroupPile[]
  loads: GroupLoads
  /** fck (MPa) e fator de rigidez à flexão (EI = fator·Ecs·I). */
  fck: number
  eiFactor: number
  /** Profundidade do topo das estacas (base do bloco) abaixo do terreno (m). */
  topDepth: number
  loading: Loading
  groupEffect: 'davisson' | 'none'
  /**
   * Rigidez à flexão não linear: dado N (kN) e a estaca, devolve EI(M) secante (kN·m²) da curva momento-curvatura.
   * Quando ausente, EI = eiFactor·Ecs·I constante.
   */
  eiModel?: (N: number, pile: GroupPile) => ((M: number) => number) | undefined
}

export interface PileResult {
  id: string
  x: number
  y: number
  /** Carga axial de compressão (kN); negativa = tração. */
  axial: number
  Hx: number
  Hy: number
  H: number
  /** Momento no topo da estaca (kN·m), resultante dos dois planos. */
  headMoment: number
  groupFactor: number
  /** Perfis resultantes ao longo da estaca. */
  z: number[]
  y_res: number[]
  M_res: number[]
  V_res: number[]
  maxMoment: { value: number; z: number }
  maxShear: number
  headDisplacement: number
  mobilizationMax: number
  /** Carga crítica de flambagem (kN) e λ = Pcr/N (∞ se N ≤ 0). */
  criticalLoad: number
  bucklingFactor: number
  /** Le = π·√(EI/Pcr) (m). */
  bucklingLength: number
  axialRatio?: number
}

export interface GroupResult {
  piles: PileResult[]
  cap: { ux: number; uy: number; uz: number; rx: number; ry: number; rz: number }
  converged: boolean
  iterations: number
  warnings: string[]
  /** Somas de verificação (devem coincidir com as cargas aplicadas). */
  sums: { fx: number; fy: number; fz: number }
}

// ------------------------------------------------------------------ utilidades

export function concreteProps(fck: number) {
  const eci = 5600 * Math.sqrt(fck) // MPa, αE = 1,0 (granito/gnaisse) — NBR 6118:2026, 8.2.8
  const ai = Math.min(0.8 + 0.2 * (fck / 80), 1)
  return { Ecs: ai * eci * 1000 } // kPa
}

/** Fator de grupo de Davisson (1970): 0,25 em s ≤ 3B; 1,0 em s ≥ 8B; linear entre. */
export function davissonFactor(spacing: number, B: number): number {
  const r = spacing / B
  if (r <= 3) return 0.25
  if (r >= 8) return 1
  return 0.25 + (0.75 * (r - 3)) / 5
}

function solveLinear(A: number[][], b: number[]): number[] | undefined {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return undefined
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

// ------------------------------------------------------------------ análise

export function analyzeGroup(inp: GroupInput): GroupResult {
  const warnings: string[] = []
  const n = inp.piles.length
  if (n === 0) throw new Error('Grupo sem estacas')
  const { Ecs } = concreteProps(inp.fck)

  // fator de grupo pelo vizinho mais próximo
  const gf = inp.piles.map((p, i) => {
    if (inp.groupEffect === 'none' || n === 1) return 1
    let s = Infinity
    inp.piles.forEach((q, j) => {
      if (i !== j) s = Math.min(s, Math.hypot(p.x - q.x, p.y - q.y))
    })
    return davissonFactor(s, p.diameter)
  })
  const overlap = inp.piles.some((p, i) => inp.piles.some((q, j) => j > i && Math.hypot(p.x - q.x, p.y - q.y) < 0.5 * Math.min(p.diameter, q.diameter)))
  if (overlap) warnings.push('Há estacas com centros praticamente coincidentes.')

  // modelos laterais
  const lat: LateralInput[] = inp.piles.map((p, i) => ({
    profile: p.profile,
    B: p.diameter,
    EI: inp.eiFactor * Ecs * ((Math.PI * p.diameter ** 4) / 64),
    length: p.length,
    topDepth: inp.topDepth,
    H: 0, M: 0, N: 0,
    head: { translation: 'free', rotation: 'free' },
    loading: inp.loading,
    pScale: gf[i],
  }))
  const models = lat.map((l) => buildModel(l))
  lat.forEach((l, i) => {
    if (inp.eiModel) l.EIe = new Array<number>(models[i].ne).fill(l.EI)
  })
  const kv = inp.piles.map((p) => p.kv ?? (Ecs * pileArea(p.diameter)) / p.length)
  if (inp.piles.some((p) => p.kv === undefined))
    warnings.push('Rigidez axial kv = E_cs·A/L (ponta indeslocável): desconsidera a deformação do solo; só influi se as estacas tiverem rigidezes diferentes.')

  // chute inicial da rigidez do solo
  const Es: number[][] = lat.map((l, i) =>
    evalSoilNodes(l, models[i], new Array(models[i].ne + 1).fill(1e-4)).map((r) => (Number.isFinite(r.Es) ? r.Es : (r.pu / 1e-4) * 0.5)),
  )
  const N = new Array<number>(n).fill(0)
  // perfil do esforço normal ao longo da estaca (atrito lateral / atrito negativo): N(z)/N_topo usado no P-Δ
  lat.forEach((l, i) => {
    const ap = inp.piles[i].axialProfile
    if (ap) l.axialShape = (z) => (N[i] > 1e-6 ? Math.max(ap(z, N[i]) / N[i], 0) : 1)
  })

  const F = [inp.loads.fx, inp.loads.fy, -inp.loads.fz, inp.loads.mx, inp.loads.my, inp.loads.mz]
  let u = new Array<number>(6).fill(0)
  let converged = false
  let iter = 0
  let lastState: {
    k: number[][][]
    heads: { dx: number; tx: number; dy: number; ty: number; Hx: number; Msx: number; Hy: number; Msy: number }[]
    P: number[]
  } | undefined

  for (iter = 1; iter <= 100; iter++) {
    // rigidez de cabeça (2×2) de cada estaca, com Es congelado e N atual
    const kPile: number[][][] = []
    let unstable = false
    for (let i = 0; i < n; i++) {
      const c1 = solveFrozen(lat[i], models[i], Es[i], 1, 0, N[i])
      const c2 = solveFrozen(lat[i], models[i], Es[i], 0, 1, N[i])
      if (!c1 || !c2) {
        unstable = true
        break
      }
      const C = [
        [c1.y[0], c2.y[0]],
        [c1.theta[0], c2.theta[0]],
      ]
      if (inp.piles[i].headFixity === 'articulada') kPile.push([[1 / C[0][0], 0], [0, 0]])
      else {
        const det = C[0][0] * C[1][1] - C[0][1] * C[1][0]
        kPile.push([[C[1][1] / det, -C[0][1] / det], [-C[1][0] / det, C[0][0] / det]])
      }
    }
    if (unstable) {
      warnings.push('Instabilidade (flambagem) em alguma estaca: a matriz de rigidez perdeu positividade para as cargas informadas.')
      break
    }

    // rigidez do bloco 6×6 — gdl: ux, uy, uz(↑), rx, ry, rz
    const K = Array.from({ length: 6 }, () => new Array<number>(6).fill(0))
    const addOuter = (a: number[], b: number[], k: number) => {
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) K[r][c] += k * a[r] * b[c]
    }
    inp.piles.forEach((p, i) => {
      const a = [0, 0, 1, p.y, -p.x, 0]
      addOuter(a, a, kv[i])
      const ax = [[1, 0, 0, 0, 0, -p.y], [0, 0, 0, 0, 1, 0]]
      const ay = [[0, 1, 0, 0, 0, p.x], [0, 0, 0, -1, 0, 0]]
      for (const dirs of [ax, ay])
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) addOuter(dirs[r], dirs[c], kPile[i][r][c])
    })
    // movimento sem rigidez (ex.: torção de estaca única): fixa o gdl; só é problema se houver carga nele
    const kmax = Math.max(...K.map((r, i) => r[i]))
    for (let d = 0; d < 6; d++) {
      if (K[d][d] < 1e-9 * kmax) {
        if (Math.abs(F[d]) > 1e-9) warnings.push('Há carga em um movimento do bloco sem rigidez nas estacas (ex.: torção em estaca única).')
        K[d][d] = kmax
      }
    }
    const uNew = solveLinear(K, F)
    if (!uNew) {
      warnings.push('Sistema do bloco singular (sem rigidez em algum movimento).')
      break
    }
    u = uNew

    // deslocamentos e esforços de cabeça
    const heads = inp.piles.map((p, i) => {
      const dx = u[0] - u[5] * p.y
      const dy = u[1] + u[5] * p.x
      const tx = u[4] // rotação no plano XZ (positiva: topo tende a +x)
      const ty = -u[3] // no plano YZ
      const fx = kPile[i][0][0] * dx + kPile[i][0][1] * tx
      const msx = kPile[i][1][0] * dx + kPile[i][1][1] * tx
      const fy = kPile[i][0][0] * dy + kPile[i][0][1] * ty
      const msy = kPile[i][1][0] * dy + kPile[i][1][1] * ty
      return { dx, tx, dy, ty, Hx: fx, Msx: msx, Hy: fy, Msy: msy }
    })
    const P = inp.piles.map((p, i) => -kv[i] * (u[2] + u[3] * p.y - u[4] * p.x))
    lastState = { k: kPile, heads, P }

    // atualização do solo: campos de deslocamento em cada plano → resultante → rigidez secante
    let change = 0
    for (let i = 0; i < n; i++) {
      const h = heads[i]
      const sx = solveFrozen(lat[i], models[i], Es[i], h.Hx, h.Msx, N[i])
      const sy = solveFrozen(lat[i], models[i], Es[i], h.Hy, h.Msy, N[i])
      if (!sx || !sy) continue
      const yres = sx.y.map((v, j) => Math.hypot(v, sy.y[j]))
      const soil = evalSoilNodes(lat[i], models[i], yres)
      soil.forEach((r, j) => {
        const e = Number.isFinite(r.Es) ? r.Es : (r.pu / Math.max(yres[j], 1e-6)) * 0.5
        const nw = 0.5 * Es[i][j] + 0.5 * Math.max(e, 0)
        change = Math.max(change, Math.abs(nw - Es[i][j]) / Math.max(Es[i][j], 1))
        Es[i][j] = nw
      })
      const nNew = Math.max(P[i], 0)
      change = Math.max(change, Math.abs(nNew - N[i]) / Math.max(Math.abs(nNew), 100))
      N[i] = nNew
      if (inp.eiModel) {
        const fn = inp.eiModel(N[i], inp.piles[i])
        if (fn) {
          const fxm = memberForces(lat[i], models[i], sx.u, N[i])
          const fym = memberForces(lat[i], models[i], sy.u, N[i])
          const Mres = fxm.M.map((v, j) => Math.hypot(v, fym.M[j]))
          lat[i].EIe = lat[i].EIe!.map((prev, e) => {
            const nw = fn(0.5 * (Mres[e] + Mres[e + 1]))
            const val = 0.5 * prev + 0.5 * nw
            change = Math.max(change, Math.abs(val - prev) / prev)
            return val
          })
        }
      }
    }
    if (change < 1e-4) {
      converged = true
      break
    }
  }
  if (!converged) warnings.push('A iteração do grupo não convergiu; resultados indicativos.')

  // resultados por estaca
  const piles: PileResult[] = inp.piles.map((p, i) => {
    const h = lastState?.heads[i]
    const base: PileResult = {
      id: p.id, x: p.x, y: p.y, axial: lastState?.P[i] ?? 0, Hx: h?.Hx ?? 0, Hy: h?.Hy ?? 0,
      H: Math.hypot(h?.Hx ?? 0, h?.Hy ?? 0), headMoment: Math.hypot(h?.Msx ?? 0, h?.Msy ?? 0), groupFactor: gf[i],
      z: models[i].zNode, y_res: [], M_res: [], V_res: [], maxMoment: { value: 0, z: 0 }, maxShear: 0,
      headDisplacement: 0, mobilizationMax: 0, criticalLoad: 0, bucklingFactor: Infinity, bucklingLength: 0,
    }
    if (!h) return base
    const sx = solveFrozen(lat[i], models[i], Es[i], h.Hx, h.Msx, N[i])
    const sy = solveFrozen(lat[i], models[i], Es[i], h.Hy, h.Msy, N[i])
    if (!sx || !sy) return base
    const fx = memberForces(lat[i], models[i], sx.u, N[i])
    const fy = memberForces(lat[i], models[i], sy.u, N[i])
    base.y_res = sx.y.map((v, j) => Math.hypot(v, sy.y[j]))
    base.M_res = fx.M.map((v, j) => Math.hypot(v, fy.M[j]))
    base.V_res = fx.V.map((v, j) => Math.hypot(v, fy.V[j]))
    let k = 0
    base.M_res.forEach((v, j) => { if (v > base.M_res[k]) k = j })
    base.maxMoment = { value: base.M_res[k], z: models[i].zNode[k] }
    base.maxShear = Math.max(...base.V_res)
    base.headDisplacement = base.y_res[0]
    const soil = evalSoilNodes(lat[i], models[i], base.y_res)
    base.mobilizationMax = Math.max(0, ...soil.map((r) => (Number.isFinite(r.pu) && r.pu > 0 ? Math.abs(r.p) / r.pu : 0)))
    base.criticalLoad = criticalLoad({ ...lat[i], N: N[i] }, models[i], Es[i])
    base.bucklingLength = effectiveBucklingLength(lat[i].EI, base.criticalLoad)
    base.bucklingFactor = N[i] > 0 ? base.criticalLoad / N[i] : Infinity
    if (p.axialCapacity) base.axialRatio = base.axial / p.axialCapacity
    return base
  })
  piles.forEach((r) => {
    if (r.axial < 0) warnings.push(`Estaca ${r.id} tracionada (${fx(r.axial, 1)} kN): verifique atrito à tração e emenda/ancoragem.`)
    if (Number.isFinite(r.bucklingFactor) && r.bucklingFactor < 3) warnings.push(`Estaca ${r.id}: λ de flambagem = ${fx(r.bucklingFactor, 2)} (< 3).`)
    if (r.mobilizationMax >= 0.99) warnings.push(`Estaca ${r.id}: solo plastificado em parte do fuste.`)
  })

  return {
    piles,
    cap: { ux: u[0], uy: u[1], uz: u[2], rx: u[3], ry: u[4], rz: u[5] },
    converged,
    iterations: iter,
    warnings: [...new Set(warnings)],
    sums: { fx: piles.reduce((s, p) => s + p.Hx, 0), fy: piles.reduce((s, p) => s + p.Hy, 0), fz: piles.reduce((s, p) => s + p.axial, 0) },
  }
}

/** Compara projeto × executado: variação percentual da carga axial em cada estaca (mesma carga e mesmas estacas). */
export function compareAsBuilt(inp: GroupInput) {
  const design = analyzeGroup({ ...inp, piles: inp.piles.map((p) => ({ ...p, x: p.x0 ?? p.x, y: p.y0 ?? p.y })) })
  const built = analyzeGroup(inp)
  return {
    design,
    built,
    rows: built.piles.map((b, i) => {
      const d = design.piles[i]
      return { id: b.id, axialDesign: d.axial, axialBuilt: b.axial, delta: b.axial - d.axial, ratio: d.axial !== 0 ? b.axial / d.axial : NaN }
    }),
  }
}

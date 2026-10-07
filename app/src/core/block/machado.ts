/**
 * Método das bielas de Blévot, roteiro de Machado (1985) e Bastos (UNESP, "Blocos de Fundação", 2023), com as
 * formulações por tipo de arranjo (1 a 7 estacas) das seções 5 a 11 do roteiro.
 *
 * Premissas do roteiro (todas reproduzidas aqui):
 *  - pilar tratado como quadrado equivalente a_p,eq = √(a_p·b_p) (blocos de 3 ou mais estacas); no bloco de 2 estacas, a_p é a
 *    dimensão do pilar na direção da linha das estacas;
 *  - carregamento não centrado: todas as estacas com a maior carga (N_eff = n·P_máx), a favor da segurança;
 *  - ângulo das bielas entre 45° e 55° (Machado); dentro dessa faixa as bielas só precisam ser verificadas em blocos de
 *    2, 3, 4 estacas e 5 com central (tensões limite de Blévot: 1,4; 1,75; 2,1; 2,6/2,1 × K_R·f_cd, K_R = 0,90 a 0,95);
 *  - armadura principal paralela aos lados + malha inferior (≥ 0,2·A_s,lado em 3 estacas; ≥ 0,25·A_s,lado nos demais) e
 *    armadura de suspensão A_s,susp,tot = N_d/(1,5·n_e·f_yd), que a malha deve atender; superior = 0,2·A_s,total e pele
 *    = A_s,total/8 por face (3 ou mais estacas); 2 estacas: A_s majorada em 15 % (ensaios de Blévot);
 *  - 1 estaca: estribos horizontais para T_d = 0,25·P_d (fendilhamento).
 * Arranjos que não são nenhum dos acima (malhas retangulares 3×2, 3×3…) não são cobertos pelo roteiro.
 */
import type { LayoutPoint } from '../group/layouts'
import { fx } from '../format'

export type MachadoKind = '1' | '2' | '3' | '4' | '5c' | '5p' | '6h' | '7'

export interface Classified {
  kind: MachadoKind
  /** Distância entre eixos de estacas vizinhas (m) — o "e" do roteiro. */
  e: number
  /** Distância do centro do pilar ao eixo da estaca de canto (m). */
  r: number
}

const dist = (a: LayoutPoint, b: LayoutPoint) => Math.hypot(a.x - b.x, a.y - b.y)

/** Reconhece os arranjos do roteiro a partir das coordenadas (o centro do pilar é a origem). */
export function classifyLayout(piles: LayoutPoint[]): Classified | undefined {
  const n = piles.length
  if (n === 1) return { kind: '1', e: 0, r: 0 }
  const near = (a: number, b: number, tol = 0.04) => Math.abs(a - b) <= tol * Math.max(a, b, 1e-9)
  if (n === 2) return { kind: '2', e: dist(piles[0], piles[1]), r: dist(piles[0], piles[1]) / 2 }
  const cx = piles.reduce((s, p) => s + p.x, 0) / n, cy = piles.reduce((s, p) => s + p.y, 0) / n
  const center = piles.filter((p) => Math.hypot(p.x - cx, p.y - cy) < 1e-6)
  const outer = piles.filter((p) => Math.hypot(p.x - cx, p.y - cy) >= 1e-6)
  const radii = outer.map((p) => Math.hypot(p.x - cx, p.y - cy))
  const equi = radii.every((q) => near(q, radii[0]))
  const minD = Math.min(...piles.flatMap((p, i) => piles.slice(i + 1).map((q) => dist(p, q))))
  if (n === 3 && center.length === 0 && equi) return { kind: '3', e: minD, r: radii[0] }
  if (n === 4 && center.length === 0 && equi) {
    // quadrado (as 4 estacas equidistantes do centro e lados iguais)
    const sides = piles.flatMap((p, i) => piles.slice(i + 1).map((q) => dist(p, q))).sort((a, b) => a - b)
    if (near(sides[0], sides[3]) && near(sides[4], sides[5]) && near(sides[4], sides[0] * Math.SQRT2)) return { kind: '4', e: sides[0], r: radii[0] }
  }
  if (n === 5 && center.length === 1 && equi) {
    const sides = outer.flatMap((p, i) => outer.slice(i + 1).map((q) => dist(p, q))).sort((a, b) => a - b)
    if (near(sides[0], sides[3]) && near(sides[4], sides[5]) && near(sides[4], sides[0] * Math.SQRT2)) return { kind: '5c', e: sides[0], r: radii[0] }
  }
  if (n === 5 && center.length === 0 && equi) return { kind: '5p', e: minD, r: radii[0] }
  if (n === 6 && center.length === 0 && equi && near(minD, radii[0])) return { kind: '6h', e: minD, r: radii[0] }
  if (n === 7 && center.length === 1 && equi && near(minD, radii[0])) return { kind: '7', e: minD, r: radii[0] }
  return undefined
}

/** Posição do nó da biela no pilar a partir do centro (m), por arranjo (Machado/Bastos). */
export function attachOffsetFor(kind: MachadoKind | undefined, ap: number, n: number): number {
  switch (kind) {
    case '2': return ap / 4
    case '3': return 0.3 * ap
    case '4': case '5c': return (ap * Math.SQRT2) / 4
    case '5p': case '6h': case '7': return 0.25 * ap
    default: return n === 2 ? ap / 4 : n === 3 ? 0.3 * ap : n === 4 ? (ap * Math.SQRT2) / 4 : 0.3 * ap
  }
}

/** Pilar efetivo do roteiro: 2 estacas → dimensão na direção da linha das estacas; 3 ou mais → quadrado equivalente. */
export function pillarEffective(piles: LayoutPoint[], pillar: { ax: number; ay: number }): number {
  if (piles.length === 2) {
    const dx = piles[1].x - piles[0].x, dy = piles[1].y - piles[0].y
    const L = Math.hypot(dx, dy) || 1
    return (Math.abs(dx) / L) * pillar.ax + (Math.abs(dy) / L) * pillar.ay
  }
  return Math.sqrt(pillar.ax * pillar.ay)
}

export interface MachadoGroup {
  label: string
  /** Área de aço necessária (cm²) em cada barra/faixa listada. */
  AsReq: number
  /** 'tie2' = tirante do bloco de 2 estacas; 'side' = paralela ao lado (i → i+1); 'diag' = na direção de uma diagonal; 'ring' = cinta; 'mesh' = malha inferior. */
  role: 'tie2' | 'side' | 'diag' | 'ring' | 'mesh' | 'stirrup1'
  /** Para 'side', 'diag' e 'ring': índices das estacas ligadas (ou a estaca de canto da diagonal). */
  piles?: [number, number]
  dir?: 'x' | 'y'
  /** Número de barras/faixas iguais (ex.: 3 lados iguais). */
  count: number
}

export interface MachadoResult {
  kind: MachadoKind
  /** Faixa admissível de d (m) para bielas de 45° a 55° e d adotado. */
  dMin: number
  dMax: number
  theta: number
  groups: MachadoGroup[]
  /** A_s,total (cm²) = soma das armaduras principais; base das armaduras superior e de pele. */
  AsTotal: number
  AsSupPerDir: number
  AsPeleFace: number
  /** Armadura de suspensão total (cm²). */
  AsSuspTot: number
  /** Verificações das bielas (tensões em kPa) com os limites de Blévot, ou vazio se o roteiro dispensa. */
  checks: { name: string; value: number; limit: number; ok: boolean }[]
  notes: string[]
}

export interface MachadoInput {
  piles: LayoutPoint[]
  pillar: { ax: number; ay: number }
  dE: number
  d: number
  /** Reação de cálculo máxima por estaca (kN). */
  Pmax: number[]
  fyd: number // kPa
  fcd: number // kPa
  /** K_R do efeito Rüsch (0,90 a 0,95 no roteiro). */
  kr: number
}

const KAPPA: Partial<Record<MachadoKind, [number, number]>> = { '2': [1.4, 1.4], '3': [1.75, 1.75], '4': [2.1, 2.1], '5c': [2.6, 2.1] }

/** Armaduras e verificações do método das bielas (roteiro de Machado/Bastos). `undefined` se o arranjo não é coberto. */
export function machadoDesign(inp: MachadoInput): MachadoResult | undefined {
  const cls = classifyLayout(inp.piles)
  if (!cls) return undefined
  const { kind, r } = cls
  const n = inp.piles.length
  const ap = pillarEffective(inp.piles, inp.pillar)
  const a = attachOffsetFor(kind, ap, n)
  const arm = Math.max(r - a, 0.05)
  const d = inp.d
  const Pm = Math.max(...inp.Pmax)
  const Neff = n * Pm
  const theta = Math.atan2(d, arm)
  const cm2 = (F: number) => (F / inp.fyd) * 1e4 // kN → cm²
  const notes: string[] = []
  const groups: MachadoGroup[] = []
  let sides = 0
  let AsSide = 0
  let meshFactor = 0.25
  let faces = 0

  if (kind === '1') {
    // T = 0,25·P (fendilhamento), estribos horizontais
    const T = 0.25 * Pm
    groups.push({ label: 'Estribos horizontais (T = 0,25·P_d)', AsReq: cm2(T), role: 'stirrup1', count: 1 })
    return { kind, dMin: 1.0 * inp.dE, dMax: 1.2 * inp.dE, theta, groups, AsTotal: cm2(T), AsSupPerDir: 0, AsPeleFace: 0, AsSuspTot: 0, checks: [], notes: ['Bloco de 1 estaca: d entre 1,0 e 1,2 dE; estribos verticais construtivos nas duas direções (iguais à armadura principal).'] }
  }

  if (kind === '2') {
    const Rs = (Neff / 2) * (arm / d)
    groups.push({ label: 'Tirante inferior (Blévot, A_s majorada em 15 %)', AsReq: cm2(1.15 * Rs), role: 'tie2', count: 1 })
    AsSide = cm2(1.15 * Rs)
    sides = 1
    notes.push('2 estacas: R_s majorada em 15 % (ensaios de Blévot).')
  } else if (kind === '3') {
    const Rs = (Neff / 3) * (arm / d)
    AsSide = cm2(Rs / Math.sqrt(3))
    sides = 3
    meshFactor = 0.2
    faces = 3
    for (let i = 0; i < 3; i++) groups.push({ label: `Tirante paralelo ao lado ${i + 1}`, AsReq: AsSide, role: 'side', piles: [i, (i + 1) % 3], count: 1 })
  } else if (kind === '4' || kind === '5c') {
    const Neff2 = kind === '5c' ? (4 / 5) * Neff : Neff
    const Rs = (Neff2 / 4) * (arm / d)
    AsSide = cm2(Rs / Math.SQRT2)
    sides = 4
    faces = 4
    // lados do quadrado: pares de estacas de canto vizinhas
    const corners = kind === '5c' ? inp.piles.map((p, i) => ({ p, i })).filter(({ p }) => Math.hypot(p.x, p.y) > 1e-6) : inp.piles.map((p, i) => ({ p, i }))
    const eSide = cls.e
    let k = 0
    corners.forEach(({ p, i }, ia) => corners.slice(ia + 1).forEach(({ p: q, i: j }) => { if (Math.abs(dist(p, q) - eSide) < 0.04 * eSide) groups.push({ label: `Tirante paralelo ao lado ${++k}`, AsReq: AsSide, role: 'side', piles: [i, j], count: 1 }) }))
  } else if (kind === '5p') {
    const Rs = (Neff / 5) * (arm / d)
    AsSide = cm2(0.85 * Rs) // R's = Rs·sen54°/sen72° ≈ 0,85·Rs
    sides = 5
    faces = 5
    const order = inp.piles.map((p, i) => ({ i, t: Math.atan2(p.y, p.x) })).sort((u, v) => u.t - v.t)
    for (let k = 0; k < 5; k++) groups.push({ label: `Tirante paralelo ao lado ${k + 1}`, AsReq: AsSide, role: 'side', piles: [order[k].i, order[(k + 1) % 5].i], count: 1 })
  } else if (kind === '6h') {
    const Rs = (Neff / 6) * (arm / d)
    AsSide = cm2(Rs) // lei dos senos: R's = Rs
    sides = 6
    faces = 6
    const order = inp.piles.map((p, i) => ({ i, t: Math.atan2(p.y, p.x) })).sort((u, v) => u.t - v.t)
    for (let k = 0; k < 6; k++) groups.push({ label: `Tirante paralelo ao lado ${k + 1}`, AsReq: AsSide, role: 'side', piles: [order[k].i, order[(k + 1) % 6].i], count: 1 })
  } else if (kind === '7') {
    const Rs = (Neff / 7) * (arm / d)
    const k = 0.5 // 2/5 ≤ k ≤ 3/5 (ponto médio)
    const diag = cm2((1 - k) * Rs), ring = cm2(k * Rs)
    groups.push({ label: 'Tirante na direção das diagonais', AsReq: diag, role: 'diag', count: 6 }, { label: 'Cinta paralela aos lados', AsReq: ring, role: 'ring', count: 6 })
    AsSide = diag + ring
    sides = 6
    faces = 6
    notes.push('7 estacas: A_s,diag = (1−k)·N_d(e−a_p/4)/(7·d·f_yd) e A_s,cinta = k·(...), k = 0,5 (faixa 2/5 a 3/5).')
  }

  const AsTotal = sides * AsSide
  const AsSuspTot = ((Neff / (1.5 * n)) / inp.fyd) * 1e4 // N_d/(1,5·n_e·f_yd)
  if (kind !== '2' && kind !== '7') {
    const AsMesh = Math.max(meshFactor * AsSide, AsSuspTot / faces)
    for (const dir of ['x', 'y'] as const) groups.push({ label: `Malha inferior ${dir.toUpperCase()}`, AsReq: AsMesh, role: 'mesh', dir, count: 1 })
    if (AsSuspTot / faces > meshFactor * AsSide) notes.push(`Malha inferior dimensionada pela suspensão: A_s,susp/face = ${fx((AsSuspTot / faces), 2)} cm² > ${meshFactor}·A_s,lado (os ganchos verticais da malha inferior e da superior podem compor a suspensão).`)
  }
  if (kind === '7') {
    for (const dir of ['x', 'y'] as const) groups.push({ label: `Malha inferior ${dir.toUpperCase()}`, AsReq: Math.max(0.2 * AsSide, AsSuspTot / faces), role: 'mesh', dir, count: 1 })
  }
  const AsSupPerDir = kind === '2' ? 0.2 * AsSide : (0.2 * AsTotal) / 2
  const AsPeleFace = AsTotal / 8

  // verificação das bielas (Blévot): σ_pil = N/(A_p·sen²θ); σ_est = P_máx/(A_e·sen²θ)
  const checks: MachadoResult['checks'] = []
  const lim = KAPPA[kind]
  if (lim) {
    const s2 = Math.sin(theta) ** 2
    const Acp = inp.pillar.ax * inp.pillar.ay
    const AcE = (Math.PI * inp.dE ** 2) / 4
    const sp = Neff / (Acp * s2), se = Pm / (AcE * s2)
    checks.push({ name: `Biela junto ao pilar (Blévot, ${lim[0]}·K_R·f_cd)`, value: sp, limit: lim[0] * inp.kr * inp.fcd, ok: sp <= lim[0] * inp.kr * inp.fcd })
    checks.push({ name: `Biela junto à estaca (Blévot, ${lim[1]}·K_R·f_cd)`, value: se, limit: lim[1] * inp.kr * inp.fcd, ok: se <= lim[1] * inp.kr * inp.fcd })
  } else notes.push('Arranjo sem verificação de bielas no roteiro: basta d entre d_mín e d_máx (45° ≤ θ ≤ 55°).')

  return { kind, dMin: arm * Math.tan((45 * Math.PI) / 180), dMax: arm * Math.tan((55 * Math.PI) / 180), theta, groups, AsTotal, AsSupPerDir, AsPeleFace, AsSuspTot, checks, notes }
}

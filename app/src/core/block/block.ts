/**
 * Dimensionamento de bloco rígido sobre estacas pelo método das bielas e tirantes (Blévot e Frémy, 1967), conforme
 *   Campos, J. C., Elementos de Fundações em Concreto (2015), §12.2 (Quadro 12.2, Eqs. 12.4–12.12), §12.3.4 (ângulo
 *   das bielas), Quadro 12.5 (limites de tensão nas bielas), §12.4 (detalhamento, Eqs. 12.22–12.28 e exemplo resolvido
 *   do bloco sobre 4 estacas) e ABNT NBR 6118:2026, 22.7 (bloco rígido, armadura de flexão > 85 % nas faixas das estacas,
 *   armadura lateral/superior, ancoragem 9.4.2).
 *
 * Generalização (necessária para cargas excêntricas e arranjos livres): para cada estaca i com reação de cálculo P_i
 * (compressão) a biela liga o ponto de aplicação no pilar — a distância a_i do centro do pilar na direção da estaca —
 * ao eixo da estaca no plano médio da armadura; com r_i a distância horizontal do eixo da estaca ao centro do pilar:
 *      tg θ_i = d / (r_i − a_i);   R_s,i = P_i · (r_i − a_i)/d  (tração no tirante, radial);   R_c,i = P_i / sen θ_i.
 * Para carga centrada e 2, 3 ou 4 estacas iguais isso reproduz exatamente o Quadro 12.2 (a_i = b/4, 0,3b, b·√2/4).
 * Para 5 ou mais estacas não há fórmula tabelada em Campos (2015): adota-se a_i = 0,3b (INTERPRETAÇÃO sinalizada).
 *
 * Unidades: kN, m, MPa onde indicado. O pilar é tratado como quadrado de lado b = menor dimensão (Campos, §12.2).
 */
import type { LayoutPoint } from '../group/layouts'
import { crackWidth, CRACK_LIMIT_MM } from './crack'
import { attachOffsetFor, classifyLayout, machadoDesign, pillarEffective } from './machado'
import { fx } from '../format'

export interface BlockInput {
  piles: LayoutPoint[]
  /** Diâmetro das estacas (m). */
  dE: number
  pillar: { ax: number; ay: number }
  /** Área total dos pilares (m²) quando o bloco recebe mais de um pilar (caixa envolvente em `pillar`); padrão ax·ay. */
  pillarArea?: number
  /** fck do concreto do bloco (MPa) e classe de agressividade (cobrimento: contato com o solo, NBR 6118 Tab. 7.2). */
  fckBlock: number
  caa: 1 | 2 | 3 | 4
  /** Reações de cálculo (ELU) por combinação e por estaca (kN, compressão +), e a carga do pilar de cada combinação. */
  combos: { name: string; P: number[]; Nsd: number }[]
  /** Maior reação em serviço (ELS) por estaca (kN), para o limite 0,43·fck/γn junto à estaca (opcional). */
  serviceMaxP?: number
  fyk?: number
  gammaS?: number
  gammaC?: number
  /** Fração α da armadura segundo os lados em blocos de 4 estacas (3/4 ≤ α ≤ 6/7; Campos recomenda 0,8). */
  alphaSides?: number
  /** Acréscimo (m) à dE para a distância do eixo da estaca à borda: a = dE + margem (Campos, Fig. 12.21). */
  edgeMargin?: number
  /** Ângulos-limite das bielas (graus). */
  thetaMin?: number
  thetaMax?: number
  /** Altura do bloco fixada pelo usuário (m). */
  hFixed?: number
  /** Dimensões em planta fixadas pelo usuário (m). */
  lx?: number
  ly?: number
  /** Altura mínima do bloco (m) e, para 1 estaca, d mínimo = fator × dE. */
  hMin?: number
  d1Factor?: number
  /** Método de dimensionamento das armaduras: 'conservador' = o que dá maior massa de tirantes entre os implementados. */
  method?: BlockMethod
  /** K_R do efeito Rüsch nas tensões-limite de Blévot do roteiro de Machado/Bastos (0,90 a 0,95; padrão 0,90). */
  kr?: number
  /** Folga (m) entre a face da estaca e a borda do bloco (Bastos: ≥ 15 cm em edifícios de grande porte, 5 cm em pequeno porte). Sobrepõe `edgeMargin`. */
  edgeClear?: number
  /** uso interno: já foi aumentada a folga para ancorar a armadura */
  retry?: boolean
  /** Formato em planta (padrão do núcleo: retangular; a interface usa 'otimizado'). */
  shape?: BlockShape
}

export type BlockMethod = 'conservador' | 'blevot' | 'machado' | 'flexao'
/** 'otimizado': contorno poligonal (casco convexo das estacas afastado de a, cantos chanfrados); 'retangular': caixa envolvente. */
export type BlockShape = 'tipico' | 'otimizado' | 'retangular'
export const BLOCK_SHAPE_LABEL: Record<BlockShape, string> = { tipico: 'Típico por arranjo (retângulo para 1, 2 e 4 estacas; triângulo truncado, pentágono e hexágono)', otimizado: 'Otimizado (contorno poligonal acompanhando as estacas)', retangular: 'Retangular (caixa envolvente)' }
export const BLOCK_METHOD_LABEL: Record<BlockMethod, string> = {
  conservador: 'Conservador (adota o método com maior armadura)',
  blevot: 'Bielas e tirantes — Blévot e Frémy (Campos, cap. 12)',
  machado: 'Bielas de Blévot — roteiro de Machado e Bastos (UNESP, 2023)',
  flexao: 'Método do CEB-70 (flexão) — Bastos (2023) e Campos §13.4',
}

export interface BarSet {
  /** Descrição (ex.: "Tirante X, faixa y = +0,35 m"). */
  label: string
  AsReq: number // cm²
  n: number
  phiMm: number
  /** Comprimento de cada barra (m), face a face com ganchos. */
  length: number
  AsEff: number // cm²
}

export interface BlockResult {
  feasible: boolean
  reasons: string[]
  warnings: string[]
  /** (cx, cy) = centro do bloco em planta (origem = eixo do pilar). */
  geometry: { lx: number; ly: number; cx: number; cy: number; h: number; d: number; a: number; cover: number; fck: number; /** contorno em planta (m, origem no eixo do pilar) */ outline: [number, number][]; /** área em planta (m²) */ area: number; shape: BlockShape }
  /** Ângulos das bielas (graus) por estaca. */
  theta: number[]
  /** Verificações; `unit` 'kN' para forças (cortante), omitido para tensões em kPa. */
  checks: { name: string; value: number; limit: number; ok: boolean; unit?: 'kN' }[]
  /** Abertura característica de fissuras dos tirantes no ELS (mm), NBR 6118:2026, 17.3.3.2. */
  crack?: { name: string; wk: number; limit: number; sigma: number; ok: boolean }[]
  /** Tração máxima nos tirantes radiais de cada estaca (kN). */
  Rs: number[]
  bars: BarSet[]
  /** Armadura de pele/lateral, superior e estribos (resumo em texto e quantidade de aço). */
  /** Armaduras complementares; os campos estruturados permitem detalhar e tabelar (qty barras de unitLen m). */
  secondary: { description: string; kg: number; kind?: 'pele' | 'superior' | 'estribos'; phiMm?: number; qty?: number; unitLen?: number; spacing?: number; perFace?: number }[]
  quantities: { concreteM3: number; formM2: number; steelKg: number; leanConcreteM2: number }
  /** Método que definiu as armaduras e a massa de tirantes de cada método (kg), quando calculados. */
  method?: 'blevot' | 'machado' | 'flexao'
  methodKg?: { blevot?: number; machado?: number; flexao?: number }
}

const R5 = (x: number) => Math.ceil(x * 20 - 1e-9) / 20 // para cima, múltiplos de 5 cm
const STEEL = 7850
const BAR_SIZES = [10, 12.5, 16, 20, 25] as const

const area = (phiMm: number) => (Math.PI * phiMm ** 2) / 4 / 100 // cm²

/** Offset a do ponto de aplicação da biela no pilar (Campos, Quadro 12.2; Machado/Bastos): ver `attachOffsetFor`. */
const attachOffset = (n: number, b: number, piles?: LayoutPoint[]) => attachOffsetFor(piles ? classifyLayout(piles)?.kind : undefined, b, n)

/** κ do Quadro 12.5 (junto ao pilar): 2 estacas 1,4; 3 estacas 1,75; 4 estacas 2,11. Demais: sem majoração (κ = 1). */
function kappa(n: number): number {
  return n === 2 ? 1.4 : n === 3 ? 1.75 : n === 4 ? 2.11 : 1
}

export function coverBlock(caa: 1 | 2 | 3 | 4): number {
  return { 1: 0.03, 2: 0.03, 3: 0.04, 4: 0.05 }[caa] // NBR 6118:2026, Tab. 7.2, contato com o solo
}

type P2 = [number, number]

/**
 * Contorno típico por arranjo (Bastos 2023 / Campos, Fig. 12.21): 3 estacas = triângulo com os vértices truncados (A ≈ 1,154·a),
 * 5 (pentágono) e 6 ou 7 (hexágono) = polígono das estacas afastado de a, com cantos em esquadria; demais arranjos: retângulo (undefined).
 * O pilar (+15 cm) é sempre coberto.
 */
/** Pilar equivalente para as fórmulas: caixa envolvente reduzida pela razão entre a área total e a da caixa (mesma proporção). */
export function scaledPillar(pillar: { ax: number; ay: number }, area?: number): { ax: number; ay: number } {
  if (!area || area >= pillar.ax * pillar.ay - 1e-9) return pillar
  const s = Math.sqrt(area / (pillar.ax * pillar.ay))
  return { ax: pillar.ax * s, ay: pillar.ay * s }
}

export function typicalOutline(piles: LayoutPoint[], a: number, pillar: { ax: number; ay: number }): P2[] | undefined {
  const kind = classifyLayout(piles)?.kind
  if (kind !== '3' && kind !== '5p' && kind !== '6h' && kind !== '7') return undefined
  const cx = piles.reduce((s, p) => s + p.x, 0) / piles.length, cy = piles.reduce((s, p) => s + p.y, 0) / piles.length
  const hull = convexHull(piles.map((p) => [p.x, p.y] as P2)) // anti-horário
  const m = hull.length
  // retas deslocadas de a para fora e interseção das vizinhas
  const lines = hull.map((p, i) => {
    const q = hull[(i + 1) % m]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    const nx = (q[1] - p[1]) / L, ny = -(q[0] - p[0]) / L // normal externa (anti-horário)
    return { nx, ny, c: nx * p[0] + ny * p[1] + a }
  })
  let poly: P2[] = hull.map((_, i) => {
    const l1 = lines[(i + m - 1) % m], l2 = lines[i]
    const det = l1.nx * l2.ny - l1.ny * l2.nx
    return [(l1.c * l2.ny - l2.c * l1.ny) / det, (l1.nx * l2.c - l2.nx * l1.c) / det] as P2
  })
  if (kind === '3') {
    // trunca cada vértice: mantém (x − estaca)·u ≤ a, u = direção radial da estaca
    const out: P2[] = []
    hull.forEach((p, i) => {
      const ux = (p[0] - cx), uy = (p[1] - cy), ul = Math.hypot(ux, uy)
      const u: P2 = [ux / ul, uy / ul]
      const v = poly[i]
      const t = (v[0] - p[0]) * u[0] + (v[1] - p[1]) * u[1] // distância radial do vértice além da estaca
      if (t <= a + 1e-9) { out.push(v); return }
      const prev = poly[(i + m - 1) % m], next = poly[(i + 1) % m]
      const cut = (w: P2): P2 => {
        const tw = (w[0] - p[0]) * u[0] + (w[1] - p[1]) * u[1]
        const s = (t - a) / (t - tw)
        return [v[0] + (w[0] - v[0]) * s, v[1] + (w[1] - v[1]) * s]
      }
      out.push(cut(prev), cut(next))
    })
    poly = out
  }
  const hx = pillar.ax / 2 + 0.15, hy = pillar.ay / 2 + 0.15
  const inside = (q: P2) => {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], r = poly[(i + 1) % poly.length]
      if ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0]) < -1e-9) return false
    }
    return true
  }
  const corners: P2[] = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]
  return corners.every(inside) ? convexHull(poly) : convexHull([...poly, ...corners])
}

/** Casco convexo (cadeia monótona de Andrew), anti-horário. */
function convexHull(pts: P2[]): P2[] {
  const p = [...pts].sort((u, v) => u[0] - v[0] || u[1] - v[1])
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: P2[] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop(); lo.push(q) }
  const up: P2[] = []
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop(); up.push(q) }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

/**
 * Contorno otimizado: soma de Minkowski das estacas com um octógono de apótema a (distância do eixo da estaca à borda,
 * Campos §12.4.1: "o maior entre 1,0 a 1,5·dE e dE + 15 cm") — o bloco acompanha o arranjo (triângulo para 3 estacas,
 * "pista" para estacas alinhadas, cantos chanfrados) em vez de uma caixa. O pilar sempre fica coberto (+15 cm).
 */
export function optimizedOutline(piles: LayoutPoint[], a: number, pillar: { ax: number; ay: number }): P2[] {
  const r = a / Math.cos(Math.PI / 8)
  const pts: P2[] = []
  for (const p of piles) for (let k = 0; k < 8; k++) { const t = Math.PI / 8 + (k * Math.PI) / 4; pts.push([p.x + r * Math.cos(t), p.y + r * Math.sin(t)]) }
  const hx = pillar.ax / 2 + 0.15, hy = pillar.ay / 2 + 0.15
  pts.push([-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy])
  return convexHull(pts)
}
export const polyArea = (o: P2[]) => Math.abs(o.reduce((s, p, i) => s + (p[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * p[1]), 0)) / 2
export const polyPerimeter = (o: P2[]) => o.reduce((s, p, i) => s + Math.hypot(o[(i + 1) % o.length][0] - p[0], o[(i + 1) % o.length][1] - p[1]), 0)
/** Corda do contorno (convexo) numa reta x = coord (dir 'y') ou y = coord (dir 'x'): [mín, máx] da outra coordenada. */
export function chordOf(o: P2[], dir: 'x' | 'y', coord: number): [number, number] | undefined {
  const i = dir === 'x' ? 1 : 0, j = dir === 'x' ? 0 : 1
  const hits: number[] = []
  o.forEach((p, k) => {
    const q = o[(k + 1) % o.length]
    const lo = Math.min(p[i], q[i]), hi = Math.max(p[i], q[i])
    if (coord < lo - 1e-12 || coord > hi + 1e-12 || Math.abs(q[i] - p[i]) < 1e-12) return
    hits.push(p[j] + ((coord - p[i]) / (q[i] - p[i])) * (q[j] - p[j]))
  })
  return hits.length ? [Math.min(...hits), Math.max(...hits)] : undefined
}

/** Geometria em planta e altura mínima de d pelo ângulo; usada também pelo otimizador antes da análise. */
export function blockGeometry(piles: LayoutPoint[], dE: number, pillar: { ax: number; ay: number }, opts: { pillarArea?: number; edgeMargin?: number; thetaMin?: number; thetaMax?: number; caa?: 1 | 2 | 3 | 4; lx?: number; ly?: number; hMin?: number; d1Factor?: number; shape?: BlockShape; edgeClear?: number } = {}) {
  const n = piles.length
  const b = pillarEffective(piles, scaledPillar(pillar, opts.pillarArea)) // pilar efetivo do roteiro (quadrado equivalente; 2 estacas: dimensão na linha)
  const a = opts.edgeClear !== undefined ? dE / 2 + opts.edgeClear : dE + (opts.edgeMargin ?? 0.15) // eixo da estaca à borda
  const xs = piles.map((p) => p.x)
  const ys = piles.map((p) => p.y)
  // bloco: estacas + borda a, e ao menos o pilar + 15 cm de cada lado; centrado na caixa envolvente (estacas e pilar)
  const bx0 = Math.min(Math.min(...xs) - a, -pillar.ax / 2 - 0.15), bx1 = Math.max(Math.max(...xs) + a, pillar.ax / 2 + 0.15)
  const by0 = Math.min(Math.min(...ys) - a, -pillar.ay / 2 - 0.15), by1 = Math.max(Math.max(...ys) + a, pillar.ay / 2 + 0.15)
  const lxAuto = Math.max(bx1 - bx0, pillar.ax + 0.3), lyAuto = Math.max(by1 - by0, pillar.ay + 0.3)
  let lx = opts.lx ?? lxAuto
  let ly = opts.ly ?? lyAuto
  // com dimensão informada pelo usuário, o bloco é centrado nas estacas; mínimo: eixo da estaca a dE/2 + 5 cm da borda
  const minEdge = dE / 2 + 0.05
  const minLx = Math.max(...xs) - Math.min(...xs) + 2 * minEdge
  const minLy = Math.max(...ys) - Math.min(...ys) + 2 * minEdge
  let cx = opts.lx !== undefined ? (Math.max(...xs) + Math.min(...xs)) / 2 : (bx0 + bx1) / 2
  let cy = opts.ly !== undefined ? (Math.max(...ys) + Math.min(...ys)) / 2 : (by0 + by1) / 2
  // contorno: retangular (caixa) ou otimizado (acompanha as estacas); dimensões informadas pelo usuário => retangular
  const free = opts.lx === undefined && opts.ly === undefined
  const typ = opts.shape === 'tipico' && free ? typicalOutline(piles, a, pillar) : undefined
  const shape: BlockShape = typ ? 'tipico' : opts.shape === 'otimizado' && free && n >= 2 ? 'otimizado' : 'retangular'
  let outline: P2[] = [[cx - lx / 2, cy - ly / 2], [cx + lx / 2, cy - ly / 2], [cx + lx / 2, cy + ly / 2], [cx - lx / 2, cy + ly / 2]]
  if (shape !== 'retangular') {
    outline = typ ?? optimizedOutline(piles, a, pillar)
    const ox = outline.map((q) => q[0]), oy = outline.map((q) => q[1])
    lx = Math.max(...ox) - Math.min(...ox); ly = Math.max(...oy) - Math.min(...oy)
    cx = (Math.max(...ox) + Math.min(...ox)) / 2; cy = (Math.max(...oy) + Math.min(...oy)) / 2
  }
  const planArea = polyArea(outline), planPerim = polyPerimeter(outline)
  const edgeX = (lx - (Math.max(...xs) - Math.min(...xs))) / 2
  const edgeY = (ly - (Math.max(...ys) - Math.min(...ys))) / 2
  const off = attachOffset(n, b, piles)
  const arms = piles.map((p) => Math.max(Math.hypot(p.x, p.y) - off, 0.05))
  const tMin = Math.tan(((opts.thetaMin ?? 45) * Math.PI) / 180)
  const tMax = Math.tan(((opts.thetaMax ?? 55) * Math.PI) / 180)
  const dMin = Math.max(...arms) * tMin
  const dMax = Math.min(...arms) * tMax
  const cover = coverBlock(opts.caa ?? 2)
  const cTot = Math.max(cover + 0.02, 0.05) // distância do centro das barras à face inferior (Campos usa 5 cm)
  // critério de bloco rígido análogo ao da sapata (NBR 6118:2026): h ≥ (a_bloco − a_pilar)/3
  const hRigid = Math.max((lx - pillar.ax) / 3, (ly - pillar.ay) / 3)
  // alturas mínimas (valores usuais, editáveis): h ≥ hMin; bloco de 1 estaca: d ≥ d1Factor·dE
  const d = Math.max(R5(dMin), R5(hRigid - cTot), opts.hMin ? R5(opts.hMin - cTot) : 0, n === 1 && opts.d1Factor ? R5(opts.d1Factor * dE) : 0)
  const h = d + cTot
  return { outline, area: planArea, perimeter: planPerim, shape, lx, ly, cx, cy, minLx, minLy, lxAuto, lyAuto, a: opts.lx !== undefined || opts.ly !== undefined ? Math.min(edgeX, edgeY) : a, b, dMin, dMax, d, h, cTot, cover, hRigid, volume: planArea * h, formArea: planPerim * h }
}

function pickBars(AsReq: number, strip: number, dmax = 0.019): { n: number; phiMm: number; AsEff: number } | undefined {
  // faixa útil: 1,2·dE (NBR 6118:2026, 22.7.2.1-a); uma camada com espaçamento livre ≥ máx[2 cm; φ; 1,2·dmáx]
  for (const phi of BAR_SIZES) {
    const clear = Math.max(0.02, phi / 1000, 1.2 * dmax)
    const nMax = Math.max(1, Math.floor((strip + clear) / (phi / 1000 + clear)))
    const nReq = Math.max(2, Math.ceil(AsReq / area(phi)))
    if (nReq <= Math.max(nMax, 2)) return { n: nReq, phiMm: phi, AsEff: nReq * area(phi) }
  }
  return undefined
}

export function designBlock(inp: BlockInput): BlockResult {
  const method: BlockMethod = inp.method ?? 'blevot'
  const warnings: string[] = []
  const reasons: string[] = []
  const n = inp.piles.length
  const fyk = inp.fyk ?? 500
  const gammaS = inp.gammaS ?? 1.15
  const gammaC = inp.gammaC ?? 1.4
  const fyd = (fyk / gammaS) / 10 // kN/cm²
  const alpha = inp.alphaSides ?? 0.8
  const g0 = blockGeometry(inp.piles, inp.dE, inp.pillar, inp)
  const pD = scaledPillar(inp.pillar, inp.pillarArea) // pilar das fórmulas (área total quando há mais de um pilar)
  if (inp.pillarArea && inp.pillarArea < inp.pillar.ax * inp.pillar.ay - 1e-9)
    warnings.push(`Bloco comum a dois pilares: dimensionado como um pilar equivalente (caixa envolvente ${fx(inp.pillar.ax * 100, 0)} × ${fx(inp.pillar.ay * 100, 0)} cm; área total dos pilares ${fx(inp.pillarArea * 1e4, 0)} cm²). As bielas partem dos dois pilares: confira o modelo para cada pilar e a locação das estacas junto ao centro de carga.`)
  const b = g0.b
  /** Comprimento (m) da reta de armadura dentro do contorno: na coordenada dada ou, sem ela, a maior corda. */
  const lineLen = (dir: 'x' | 'y', coord?: number) => {
    const coords = coord !== undefined ? [coord] : [0, ...inp.piles.map((p) => (dir === 'x' ? p.y : p.x))]
    let best = 0
    for (const c of coords) { const ch = chordOf(g0.outline, dir, c); if (ch) best = Math.max(best, ch[1] - ch[0]) }
    return best || (dir === 'x' ? g0.lx : g0.ly)
  }
  const off = attachOffset(n, b, inp.piles)
  const arms = inp.piles.map((p) => Math.max(Math.hypot(p.x, p.y) - off, 0.05))
  const fcdB = (inp.fckBlock / gammaC) * 1000 // kPa
  const Acp = pD.ax * pD.ay
  const AcE = (Math.PI * inp.dE ** 2) / 4
  const tanLim = (deg: number) => Math.tan((deg * Math.PI) / 180)

  // reações máximas por estaca entre as combinações (compressão) e tração, se houver
  const Pmax = inp.piles.map((_, i) => Math.max(0, ...inp.combos.map((c) => c.P[i])))
  const Ptens = inp.piles.map((_, i) => Math.min(0, ...inp.combos.map((c) => c.P[i])))
  if (Ptens.some((t) => t < -1e-6)) warnings.push('Há estaca tracionada em alguma combinação: ancore a armadura da estaca no bloco (NBR 6118:2026, 22.7.4.1.1) e verifique a tração à parte.')

  // ----- método da flexão (Campos, §13.4; CEB): seção de referência S_II a 0,15·b_p da face do pilar, para dentro
  const sideSets = (dir: 'x' | 'y') => {
    const ap = dir === 'x' ? pD.ax : pD.ay
    return { ap, coord: inp.piles.map((p) => (dir === 'x' ? p.x : p.y)) }
  }
  /** Validade do CEB-70 (Bastos §12): 2c/3 ≤ h ≤ 2c, com c = distância da face do pilar ao eixo da estaca mais afastada. */
  const cebC = Math.max(...(['x', 'y'] as const).map((dir) => { const { ap, coord } = sideSets(dir); return Math.max(...coord.map((q) => Math.abs(q))) - ap / 2 }))
  const cebValid = (hh: number) => hh >= (2 / 3) * cebC - 1e-9 && hh <= 2 * cebC + 1e-9
  /**
   * Cortante do CEB-70 (Bastos 2023, §12.3 a 12.5): seção S2 a d/2 da face do pilar (na face, se houver estaca dentro de d/2),
   * V_d,lim = (0,25/γc)(1 − c2/(5d2))·b2·d2·√fck; e resistência local nas estacas: R_d,lim = (0,12/γc)·b2'·d2'·√fck
   * (fck em kN/cm², dimensões em cm, forças em kN).
   */
  const ceb70Shear = (dd: number): BlockResult['checks'] => {
    const out: BlockResult['checks'] = []
    const fckk = inp.fckBlock / 10 // kN/cm²
    // 3 estacas em triângulo equilátero: basta a estaca mais afastada (resistência local)
    for (const dir of classifyLayout(inp.piles)?.kind === '3' ? [] : (['x', 'y'] as const)) {
      const { ap } = sideSets(dir)
      const bp = dir === 'x' ? pD.ay : pD.ax
      const coord = inp.piles.map((p) => (dir === 'x' ? p.x : p.y))
      for (const sg of [1, -1]) {
        let xs = ap / 2 + dd / 2
        if (coord.some((q) => sg * q > ap / 2 && sg * q - inp.dE / 2 < xs)) xs = ap / 2 // estaca (face interna) dentro de d/2: seção na face do pilar
        const beyond = coord.map((q, i) => ({ q: sg * q, i })).filter(({ q }) => q >= xs - 1e-9)
        if (beyond.length === 0) continue
        // estacas com o eixo a menos de dE/2 da face do pilar apoiam-se praticamente sob o pilar: a seção S2 não governa (c2 ≈ 0 daria limite sem sentido)
        if (Math.max(...beyond.map(({ q }) => q)) - ap / 2 < inp.dE / 2) continue
        const Vd = Math.max(...inp.combos.map((c) => beyond.reduce((a, { i }) => a + Math.max(c.P[i], 0), 0)))
        const c2 = Math.max(...beyond.map(({ q }) => q)) - xs + (xs === ap / 2 ? 0 : 0)
        const d2 = Math.min(dd, 1.5 * Math.max(c2, 1e-6))
        const b2 = bp + d2
        const lim = ((0.25 / gammaC) * (1 - c2 / (5 * d2)) * (b2 * 100) * (d2 * 100) * Math.sqrt(fckk))
        out.push({ name: `Cortante na seção S2, direção ${dir.toUpperCase()}${sg < 0 ? ' (lado −)' : ''} (CEB-70)`, value: Vd, limit: lim, ok: Vd <= lim, unit: 'kN' })
      }
    }
    // resistência local à força cortante junto às estacas (cantos do bloco)
    const Re = Math.max(...Pmax)
    const c2l = dd / 2 + inp.dE / 2
    const d2l = Math.min(dd, 1.5 * c2l)
    const lim = (0.12 / gammaC) * ((dd + inp.dE) * 100) * (d2l * 100) * Math.sqrt(fckk)
    out.push({ name: 'Resistência local à cortante junto à estaca (CEB-70)', value: Re, limit: lim, ok: Re <= lim, unit: 'kN' })
    return out
  }

  // altura: parte de d mínimo pelo ângulo e sobe de 5 em 5 cm até d máximo (ângulo máximo) para atender às tensões
  const dStart = inp.hFixed ? inp.hFixed - g0.cTot : g0.d
  const dEnd = inp.hFixed ? dStart : Math.max(g0.d, R5(g0.dMax))
  let chosen: { d: number; checks: BlockResult['checks']; ok: boolean; theta: number[] } | undefined
  for (let d = dStart; d <= dEnd + 1e-9; d += 0.05) {
    const th = arms.map((arm) => Math.atan2(d, arm))
    const sin2 = th.map((t) => Math.sin(t) ** 2)
    const checks: BlockResult['checks'] = []
    const sinMin2 = Math.min(...sin2)
    const mach = method === 'machado' ? machadoDesign({ piles: inp.piles, pillar: pD, dE: inp.dE, d, Pmax, fyd: (fyk / gammaS) * 1000, fcd: fcdB, kr: inp.kr ?? 0.9 }) : undefined
    if (mach) {
      for (const c of mach.checks) checks.push(c)
    } else if (method !== 'flexao') {
    // junto ao pilar: Σ P_i / (Acp · sen²θ) — usa o menor θ (mais desfavorável)
    const limPilar = Math.min(0.85 * kappa(n), n === 2 ? 1.2 : n === 3 ? 1.5 : n === 4 ? 1.8 : 0.85) * fcdB
    for (const c of inp.combos) {
      const N = c.P.reduce((a, p) => a + Math.max(p, 0), 0)
      const sPil = N / (Acp * sinMin2)
      checks.push({ name: `Biela junto ao pilar (${c.name})`, value: sPil, limit: limPilar, ok: sPil <= limPilar })
    }
    // junto às estacas: P_i/(AcE sen²θ_i) ≤ 0,85 fcd
    inp.piles.forEach((_, i) => {
      const s = Pmax[i] / (AcE * sin2[i])
      checks.push({ name: `Biela junto à estaca ${i + 1}`, value: s, limit: 0.85 * fcdB, ok: s <= 0.85 * fcdB })
    })
    if (inp.serviceMaxP !== undefined) {
      const s = inp.serviceMaxP / (AcE * sinMin2)
      const lim = (0.43 * inp.fckBlock * 1000) / 1.0
      checks.push({ name: 'Biela junto à estaca em serviço (0,43·fck/γn)', value: s, limit: lim, ok: s <= lim })
    }
    }
    if ((method === 'flexao' || method === 'conservador') && cebValid(d + g0.cTot)) {
      for (const sh of ceb70Shear(d)) checks.push(sh)
    }
    const ok = checks.every((c) => c.ok)
    chosen = { d, checks, ok, theta: th.map((t) => (t * 180) / Math.PI) }
    if (ok) break
  }
  const d = chosen!.d
  const h = d + g0.cTot
  const theta = chosen!.theta
  const empty: BlockResult = {
    feasible: false, reasons, warnings, theta, checks: chosen!.checks, Rs: [], bars: [], secondary: [],
    geometry: { lx: g0.lx, ly: g0.ly, cx: g0.cx, cy: g0.cy, h, d, a: g0.a, cover: g0.cover, fck: inp.fckBlock, outline: g0.outline, area: g0.area, shape: g0.shape },
    quantities: { concreteM3: g0.area * h, formM2: g0.perimeter * h, steelKg: 0, leanConcreteM2: g0.area },
  }
  if (inp.lx !== undefined && inp.lx < g0.minLx - 1e-9) reasons.push(`Largura em planta (${fx((inp.lx * 100), 0)} cm) menor que a mínima para as estacas (${fx((g0.minLx * 100), 0)} cm: eixo a dE/2 + 5 cm da borda).`)
  if (inp.ly !== undefined && inp.ly < g0.minLy - 1e-9) reasons.push(`Comprimento em planta (${fx((inp.ly * 100), 0)} cm) menor que o mínimo para as estacas (${fx((g0.minLy * 100), 0)} cm: eixo a dE/2 + 5 cm da borda).`)
  if (reasons.length) return empty
  if (g0.a < inp.dE + 0.15 - 1e-9 && (inp.lx !== undefined || inp.ly !== undefined)) warnings.push(`Distância do eixo da estaca à borda (${fx((g0.a * 100), 0)} cm) menor que a recomendada dE + 15 cm (Campos, Fig. 12.21): confira ancoragem das barras e punção/lateral do bloco.`)
  if (Math.abs(g0.cx) + inp.pillar.ax / 2 > g0.lx / 2 + 1e-9 || Math.abs(g0.cy) + inp.pillar.ay / 2 > g0.ly / 2 + 1e-9) warnings.push('O pilar não cabe totalmente sobre o bloco com estas dimensões.')
  if (!chosen!.ok) {
    const bad = chosen!.checks.find((c) => !c.ok)!
    reasons.push(`${bad.name}: ${bad.unit === 'kN' ? fx(bad.value, 0) + ' kN > ' + fx(bad.limit, 0) + ' kN' : fx((bad.value / 1000), 1) + ' MPa > ' + fx((bad.limit / 1000), 1) + ' MPa'} mesmo com a maior altura admitida pelo ângulo (${fx((Math.atan2(d, Math.min(...arms)) * 180 / Math.PI), 0)}°). Aumente o fck do bloco ou o número de estacas.`)
    return empty
  }
  if (Math.min(...theta) < (inp.thetaMin ?? 45) - 0.5 || Math.max(...theta) > (inp.thetaMax ?? 55) + 0.5)
    warnings.push(`Ângulos das bielas entre ${fx(Math.min(...theta), 0)}° e ${fx(Math.max(...theta), 0)}° — fora de 45°–55° (Campos, §12.3.4); revise a altura ou o arranjo.`)
  if (n >= 5) warnings.push('Bloco com 5 ou mais estacas: Campos (2015) não traz fórmulas tabeladas; modelo de bielas generalizado (a = 0,3·b) e tirantes em faixas ortogonais — revise o detalhamento.')

  // ----- tirantes
  const Rs = inp.piles.map((_, i) => (Pmax[i] * arms[i]) / d)
  const Pm = Math.max(...Pmax)
  const bars: BarSet[] = []
  const secondary: BlockResult['secondary'] = []
  const strip = 1.2 * inp.dE
  const hook = (phiMm: number) => 2 * Math.max(8 * phiMm / 1000, 0.07) // 2 ganchos de 135° (aprox. do quantitativo)
  const addBar = (label: string, F: number, length: number) => {
    const AsReq = F / fyd
    const pick = pickBars(AsReq, strip)
    if (!pick) {
      reasons.push(`${label}: As = ${fx(AsReq, 1)} cm² não cabe na faixa de ${fx((strip * 100), 0)} cm.`)
      return
    }
    bars.push({ label, AsReq, n: pick.n, phiMm: pick.phiMm, AsEff: pick.AsEff, length: length - 2 * g0.cover + hook(pick.phiMm) })
  }
  const total = inp.combos.reduce((m, c) => Math.max(m, c.Nsd), 0)
  void total

  if (n === 1) {
    warnings.push('Bloco sobre uma estaca: sem tirante principal; requer armadura construtiva (estribos e pele) e travamento por viga (Campos, §12.4 e Fig. 12.42).')
  } else if (n === 2) {
    const dirX = Math.abs(inp.piles[0].y - inp.piles[1].y) < 1e-6
    const L = dirX ? lineLen('x', inp.piles[0].y) : lineLen('y', inp.piles[0].x)
    addBar(`Tirante inferior (direção ${dirX ? 'X' : 'Y'})`, Math.max(...Rs), L)
    warnings.push('Bloco sobre duas estacas: travar com viga (baldrame) para os momentos da outra direção (Campos, §12.4.5 e Fig. 12.42).')
  } else if (n === 3) {
    // armadura segundo os lados: Rs(lados) = Rs(diag)/√3 (Eq. 12.11) + malha de 1/5 (12.4.3)
    const side = Math.max(...Rs) / Math.sqrt(3)
    const sideLen = Math.hypot(inp.piles[0].x - inp.piles[1].x, inp.piles[0].y - inp.piles[1].y)
    for (let k = 0; k < 3; k++) addBar(`Tirante lado ${k + 1} (cinta)`, side, sideLen + 2 * g0.a)
    addBar('Malha inferior X (1/5 de As,lados)', side / 5, lineLen('x'))
    addBar('Malha inferior Y (1/5 de As,lados)', side / 5, lineLen('y'))
  } else if (n === 4) {
    // ties segundo os lados com α (Eq. 12.23) e malha (Eq. 12.24), calculados por direção com as reações reais
    const xsU = [...new Set(inp.piles.map((p) => Math.round(p.x * 1e4)))].sort((u, v) => u - v)
    const ysU = [...new Set(inp.piles.map((p) => Math.round(p.y * 1e4)))].sort((u, v) => u - v)
    if (xsU.length === 2 && ysU.length === 2) {
      const rowTie = (dir: 'x' | 'y') => {
        let worst = 0
        const key = dir === 'x' ? 'y' : 'x'
        for (const k of dir === 'x' ? ysU : xsU) {
          const idx = inp.piles.map((p, i) => ({ p, i })).filter(({ p }) => Math.round(p[key] * 1e4) === k)
          for (const sign of [1, -1]) {
            const s = idx.reduce((a, { p, i }) => {
              const along = dir === 'x' ? p.x : p.y
              if (Math.sign(along) !== sign) return a
              const r = Math.hypot(p.x, p.y)
              return a + Rs[i] * (Math.abs(along) / r)
            }, 0)
            worst = Math.max(worst, s)
          }
        }
        return worst
      }
      const Tx = rowTie('x')
      const Ty = rowTie('y')
      addBar('Tirante segundo os lados (direção X)', alpha * Tx, lineLen('x'))
      addBar('Tirante segundo os lados (direção Y)', alpha * Ty, lineLen('y'))
      // malha (Eq. 12.24): 2,4(1−α)/α do tirante segundo os lados em cada direção, repartida na largura (≥ 1/5 do As,lados)
      const mx = Math.max((2.4 * (1 - alpha)) / alpha, 0.2) * alpha * Tx
      const my = Math.max((2.4 * (1 - alpha)) / alpha, 0.2) * alpha * Ty
      addBar('Malha inferior X (Eq. 12.24)', mx, lineLen('x'))
      addBar('Malha inferior Y (Eq. 12.24)', my, lineLen('y'))
      if (alpha < 0.75 || alpha > 6 / 7) warnings.push('α fora de 3/4 ≤ α ≤ 6/7 (Campos, §12.4.4).')
    } else {
      warnings.push('Quatro estacas fora da malha 2×2: tratado como arranjo genérico.')
    }
  }
  if (n >= 5 || (n === 4 && bars.length === 0)) {
    // faixas ortogonais: tração por linha de estacas = maior soma das componentes de um lado do pilar
    for (const dir of ['x', 'y'] as const) {
      const key = dir === 'x' ? 'y' : 'x'
      const lines = [...new Set(inp.piles.map((p) => Math.round(p[key] * 1e4)))]
      for (const k of lines) {
        let worst = 0
        const idx = inp.piles.map((p, i) => ({ p, i })).filter(({ p }) => Math.round(p[key] * 1e4) === k)
        for (const sign of [1, -1]) {
          const s = idx.reduce((a, { p, i }) => {
            const along = dir === 'x' ? p.x : p.y
            if (Math.sign(along) !== sign && Math.abs(along) > 1e-6) return a
            const r = Math.hypot(p.x, p.y)
            return a + Rs[i] * (Math.abs(along) / r)
          }, 0)
          worst = Math.max(worst, s)
        }
        if (worst > 0)
          addBar(`Faixa ${dir === 'x' ? 'X' : 'Y'} (${key} = ${fx((k / 1e4), 2)} m)`, worst, lineLen(dir, k / 1e4))
      }
    }
    const maxAs = Math.max(0, ...bars.map((x) => x.AsReq))
    addBar('Malha inferior X (1/5)', (maxAs * fyd) / 5, lineLen('x'))
    addBar('Malha inferior Y (1/5)', (maxAs * fyd) / 5, lineLen('y'))
  }

  // ----- utilitários para converter áreas necessárias em barras
  const massOf = (bs: BarSet[]) => bs.reduce((a2, x) => a2 + STEEL * (x.AsEff / 1e4) * x.length, 0)
  const pickInto = (list: BarSet[], errs: string[], label: string, AsReq: number, length: number, stripW = strip) => {
    if (AsReq <= 1e-9) return
    const pick = pickBars(AsReq, stripW)
    if (!pick) { errs.push(`${label}: As = ${fx(AsReq, 1)} cm² não cabe na faixa de ${fx((stripW * 100), 0)} cm.`); return }
    list.push({ label, AsReq, n: pick.n, phiMm: pick.phiMm, AsEff: pick.AsEff, length: length - 2 * g0.cover + hook(pick.phiMm) })
  }
  const fydPa = (fyk / gammaS) * 1000
  const cls = classifyLayout(inp.piles)
  const sideLenOf = (i: number, j: number) => Math.hypot(inp.piles[i].x - inp.piles[j].x, inp.piles[i].y - inp.piles[j].y)

  // ----- método do CEB-70 (flexão), roteiro de Bastos (2023, §12): seção S1 a 0,15·a_p da face do pilar, para dentro;
  //       A_s = M1d/(0,85·d·f_yd); A_s,B ≥ A_s,A/5; 3 estacas: R_s = R_e·c1/(0,8·d), R's = R_s/√3 (c1 = c + 0,15·a_p)
  const flexBars: BarSet[] = []
  const flexReasons: string[] = []
  if (n >= 2 && (method === 'flexao' || (method === 'conservador' && cebValid(h)))) {
    if (!cebValid(h)) warnings.push(`CEB-70 fora da faixa de validade (2c/3 = ${fx(((2 / 3) * cebC * 100), 0)} cm ≤ h ≤ 2c = ${fx((2 * cebC * 100), 0)} cm; h = ${fx((h * 100), 0)} cm): bloco muito alto para o método (comportamento de bielas); resultado apenas indicativo e sem as verificações de cortante.`)
    if (cls?.kind === '3') {
      const ap = g0.b
      const c1 = Math.max(cls.r - ap / 2, 0.05) + 0.15 * ap
      const Rs = (Math.max(...Pmax) * c1) / (0.8 * d)
      const AsLado = (Rs / Math.sqrt(3) / fydPa) * 1e4
      for (let k = 0; k < 3; k++) pickInto(flexBars, flexReasons, `Tirante paralelo ao lado ${k + 1} (CEB-70)`, AsLado, sideLenOf(k, (k + 1) % 3) + 2 * g0.a)
      for (const dir of ['x', 'y'] as const) pickInto(flexBars, flexReasons, `Malha inferior ${dir.toUpperCase()} (0,2·As,lado)`, 0.2 * AsLado, lineLen(dir), 10)
      warnings.push(`CEB-70, 3 estacas: M1 = R_e·c1 com c1 = ${fx((c1 * 100), 0)} cm; R_s = ${fx(Rs, 0)} kN; A_s,lado = ${fx(AsLado, 2)} cm².`)
    } else {
      const AsDir: Record<'x' | 'y', number> = { x: 0, y: 0 }
      const Mdir: Record<'x' | 'y', number> = { x: 0, y: 0 }
      for (const dir of ['x', 'y'] as const) {
        const { ap, coord } = sideSets(dir)
        const sII = 0.35 * ap
        let M = 0
        for (const c of inp.combos) for (const sg of [1, -1]) M = Math.max(M, c.P.reduce((a2, P, i) => (sg * coord[i] > sII ? a2 + Math.max(P, 0) * (sg * coord[i] - sII) : a2), 0))
        Mdir[dir] = M
        AsDir[dir] = (M / (0.85 * d * fydPa)) * 1e4
      }
      const AsMax = Math.max(AsDir.x, AsDir.y)
      for (const dir of ['x', 'y'] as const) {
        const perp = dir === 'x' ? 'y' : 'x'
        const AsTot = Math.max(AsDir[dir], AsMax / 5) // A_s,B ≥ A_s,A/5
        if (AsTot <= 1e-9) continue
        const rowsU = [...new Set(inp.piles.map((p2) => Math.round(p2[perp] * 1e4)))]
        const carried = AsDir[dir] > AsMax / 5 + 1e-9
        if (carried) {
          const AsStrip = AsTot / rowsU.length
          for (const rk of rowsU) pickInto(flexBars, flexReasons, `Flexão, direção ${dir.toUpperCase()} (faixa ${perp} = ${fx((rk / 1e4), 2)} m)`, AsStrip, lineLen(dir, rk / 1e4))
        } else pickInto(flexBars, flexReasons, `Armadura transversal em malha, direção ${dir.toUpperCase()} (≥ A_s,A/5)`, AsTot, lineLen(dir), 10)
        warnings.push(`CEB-70, direção ${dir.toUpperCase()}: M(S1) = ${fx(Mdir[dir], 0)} kN·m, A_s = ${fx(AsTot, 2)} cm²${carried ? ` repartida em ${rowsU.length} faixa(s) sobre as estacas` : ' (mínimo de 1/5 da outra direção)'}.`)
      }
    }
  }

  // ----- bielas de Blévot, roteiro de Machado/Bastos: armaduras por tipo de arranjo
  const machBars: BarSet[] = []
  const machReasons: string[] = []
  const mach = method === 'machado' || method === 'conservador' ? machadoDesign({ piles: inp.piles, pillar: pD, dE: inp.dE, d, Pmax, fyd: fydPa, fcd: fcdB, kr: inp.kr ?? 0.9 }) : undefined
  if (mach) {
    for (const g of mach.groups) {
      if (g.role === 'stirrup1') {
        // estribos horizontais fechados; AsReq por ramo (2 ramos por estribo)
        const per = 4 * (g0.lx - 2 * g0.cover) + 0.2
        for (const phi of [5, 6.3, 8, 10]) {
          const legs = Math.ceil(g.AsReq / area(phi))
          const nSt = Math.max(2, Math.ceil(legs / 2))
          if (nSt <= 6 || phi === 10) { machBars.push({ label: 'Estribos horizontais fechados (T = 0,25·P_d; A_s por ramo)', AsReq: g.AsReq / 2, n: nSt, phiMm: phi, AsEff: nSt * area(phi), length: per }); break }
        }
        continue
      }
      const len = g.role === 'tie2' ? (Math.abs(inp.piles[0].y - inp.piles[1].y) < 1e-6 ? lineLen('x', inp.piles[0].y) : lineLen('y', inp.piles[0].x))
        : g.role === 'side' ? sideLenOf(g.piles![0], g.piles![1]) + 2 * g0.a
        : g.role === 'ring' ? (cls?.e ?? 0) + 2 * g0.a
        : g.role === 'diag' ? (cls?.r ?? 0) + g0.a
        : lineLen(g.dir ?? 'x')
      for (let k = 0; k < g.count; k++) pickInto(machBars, machReasons, g.count > 1 ? `${g.label} ${k + 1}` : g.label, g.AsReq, len, g.role === 'mesh' ? 10 : strip)
    }
    for (const nt of mach.notes) warnings.push(`Roteiro de Machado/Bastos: ${nt}`)
    warnings.push(`Roteiro de Machado/Bastos (${mach.kind}): d = ${fx((d * 100), 0)} cm (d_mín = ${fx((mach.dMin * 100), 0)}, d_máx = ${fx((mach.dMax * 100), 0)} cm), θ = ${fx((mach.theta * 180) / Math.PI, 1)}°; A_s,total = ${fx(mach.AsTotal, 2)} cm²; suspensão total ${fx(mach.AsSuspTot, 2)} cm².`)
    if (d < mach.dMin - 1e-6 || d > mach.dMax + 1e-6) warnings.push('d fora de [d_mín; d_máx] do roteiro (45° ≤ θ ≤ 55°): o bloco pode não ser rígido ou as bielas exigem verificação.')
  } else if (method === 'machado') warnings.push('O arranjo de estacas não é um dos cobertos pelo roteiro de Machado/Bastos (1 a 7 estacas em arranjos regulares): usado o método de Campos.')

  // ----- escolha do método
  const blevotBars = bars.splice(0, bars.length)
  const blevotReasons = reasons.splice(0, reasons.length)
  type Cand = { m: 'blevot' | 'machado' | 'flexao'; list: BarSet[]; errs: string[]; kg: number }
  const cands: Cand[] = [{ m: 'blevot', list: blevotBars, errs: blevotReasons, kg: massOf(blevotBars) }]
  if (mach) cands.push({ m: 'machado', list: machBars, errs: machReasons, kg: massOf(machBars) })
  if (flexBars.length || flexReasons.length) cands.push({ m: 'flexao', list: flexBars, errs: flexReasons, kg: massOf(flexBars) })
  const byM = (m: Cand['m']) => cands.find((c) => c.m === m)
  let usedC = byM('blevot')!
  if (method === 'machado' && byM('machado')) usedC = byM('machado')!
  else if (method === 'flexao' && byM('flexao')) usedC = byM('flexao')!
  else if (method === 'conservador') usedC = cands.filter((c) => c.errs.length === 0).sort((u, v) => v.kg - u.kg)[0] ?? usedC
  const usedMethod = usedC.m
  bars.push(...usedC.list)
  reasons.push(...usedC.errs)
  const kgOf = (m: Cand['m']) => (n >= 2 || m === 'machado' ? byM(m)?.kg : undefined)
  if (method === 'conservador') warnings.push(`Método conservador — massa de tirantes: Campos ${fx(byM('blevot')?.kg ?? 0, 1)} kg · Machado/Bastos ${mach ? fx(byM('machado')?.kg ?? 0, 1) + ' kg' : '—'} · CEB-70 ${flexBars.length ? fx(byM('flexao')?.kg ?? 0, 1) + ' kg' : '—'} → adotado: ${usedMethod === 'machado' ? 'roteiro de Machado/Bastos' : usedMethod === 'flexao' ? 'CEB-70 (flexão)' : 'Blévot (Campos)'}.`)
  if (usedMethod === 'flexao') warnings.push('Armaduras pelo CEB-70 (Bastos 2023, §12): A_s = M1d/(0,85·d·f_yd) na seção S1 a 0,15·a_p da face do pilar; cortante nas seções S2 (d/2 da face) e resistência local nas estacas verificadas.')

  // ----- ancoragem junto à estaca (Eqs. 12.26–12.28): ℓb = φ·fyd/(4·fbd), reduzida em 20 % pela compressão da biela
  const fctd = 0.15 * inp.fckBlock ** (2 / 3) // MPa (Eq. 12.28 com γc = 1,4)
  const fbd = 2.25 * 1.0 * 1.0 * fctd
  let shortfall = 0
  for (const bsel of bars) {
    const lb = ((bsel.phiMm / 1000) * (fyk / gammaS)) / (4 * fbd) // m (MPa/MPa)
    const lbNec = Math.max(0.7 * lb * Math.min(1, bsel.AsReq / bsel.AsEff) * 0.8, 0.3 * lb, 10 * (bsel.phiMm / 1000), 0.1)
    const avail = g0.a + inp.dE / 2 - g0.cover
    if (lbNec > avail + 1e-6) { shortfall = Math.max(shortfall, lbNec - avail); warnings.push(`${bsel.label}: ancoragem necessária ${fx((lbNec * 100), 0)} cm > disponível ${fx((avail * 100), 0)} cm (com gancho de 135°).`) }
  }
  // folga insuficiente para ancorar: aumenta a distância face da estaca–borda (múltiplos de 5 cm) e refaz o bloco
  if (shortfall > 1e-6 && !inp.retry && inp.lx === undefined && inp.ly === undefined && reasons.length === 0) {
    const clear0 = inp.edgeClear ?? inp.dE / 2 + (inp.edgeMargin ?? 0.15)
    const add = Math.ceil(shortfall * 20 - 1e-9) / 20
    const r2 = designBlock({ ...inp, edgeClear: clear0 + add, retry: true })
    if (r2.feasible) { r2.warnings.push(`A distância da face da estaca à borda do bloco foi aumentada em ${fx((add * 100), 0)} cm para ancorar a armadura principal (NBR 6118:2026, 22.7.4.1.1; Bastos, §6.5).`); return r2 }
  }

  // ----- armaduras lateral/superior e estribos (Campos, §12.4.2)
  const mainAs = Math.max(0, ...bars.map((x) => x.AsEff))
  const hBlock = h
  if (n <= 2 || hBlock >= 0.6) {
    const AcAlma = (hBlock) * (n === 2 ? inp.dE + 2 * 0.1 : Math.min(g0.lx, g0.ly))
    const AsLat = usedMethod === 'machado' && mach && n >= 2 ? Math.max(mach.AsPeleFace, n === 2 ? 0.075 * (g0.ly < g0.lx ? g0.ly : g0.lx) * 100 * h : 0) : Math.max(0.2 * mainAs, 0.001 * AcAlma * 1e4) // cm² (cada face)
    const phi = 12.5
    const s = Math.max(Math.min(d / 3, 0.2), 0.08) // d/3, ≤ 20 cm e ≥ 8 cm (Bastos)
    const nBars = Math.max(2, Math.ceil(hBlock / s))
    const Lbar = (n === 2 ? (Math.abs(inp.piles[0].y - inp.piles[1].y) < 1e-6 ? lineLen('x', inp.piles[0].y) : lineLen('y', inp.piles[0].x)) : Math.max(lineLen('x'), lineLen('y'))) - 2 * g0.cover
    const bar = area(phi)
    const nPerFace = Math.max(nBars, Math.ceil(AsLat / bar))
    secondary.push({ description: `Armadura de pele: ${nPerFace}Ø12,5 por face (As,lat ≥ ${fx(AsLat, 1)} cm² por face), s ≤ ${fx((s * 100), 0)} cm`, kg: 2 * nPerFace * STEEL * (bar / 1e4) * Lbar, kind: 'pele', phiMm: phi, qty: 2 * nPerFace, unitLen: Lbar, spacing: s, perFace: nPerFace })
  }
  if (n >= 2) {
    const AsTop = usedMethod === 'machado' && mach ? mach.AsSupPerDir : mainAs / 5
    const phi = 10
    const nTop = Math.max(2, Math.ceil(AsTop / area(phi)))
    secondary.push({ description: `Armadura superior construtiva: ${nTop}Ø10 (≈ As/5)`, kg: nTop * STEEL * (area(phi) / 1e4) * Math.max(g0.lx, g0.ly), kind: 'superior', phiMm: phi, qty: nTop, unitLen: Math.max(g0.lx, g0.ly) })
    const sEst = Pm > 800 ? 0.1 : 0.12
    // estribo vertical fechado na seção transversal ao maior lado: 2·[(menor lado − 2c) + (h − 2c)] + ganchos
    const per = 2 * (Math.min(g0.lx, g0.ly) - 2 * g0.cover + (h - 2 * g0.cover)) + 0.2
    const nEst = Math.ceil(Math.max(g0.lx, g0.ly) / sEst)
    secondary.push({ description: `Estribos Ø10 c/${fx((sEst * 100), 0)} cm (Campos: ≤ 12 cm para Ns ≤ 800 kN; ≤ 10 cm acima)`, kg: nEst * STEEL * (area(10) / 1e4) * per, kind: 'estribos', phiMm: 10, qty: nEst, unitLen: per, spacing: sEst })
  }
  if (reasons.length) return { ...empty, feasible: false, bars, secondary, Rs, theta }

  const steelKg = bars.reduce((a, x) => a + STEEL * (x.AsEff / 1e4) * x.length * 1, 0) + secondary.reduce((a, x) => a + x.kg, 0)
  // As por faixa vale para as barras listadas: cada item de `bars` já é uma faixa
  void tanLim
  const checks = chosen!.checks
  // ----- pilar alongado e momento transmitido ao bloco (verificações de coerência do modelo)
  if (n >= 2) {
    const bmin = Math.min(pD.ax, pD.ay), bmax = Math.max(pD.ax, pD.ay)
    const cmb = machadoDesign({ piles: inp.piles, pillar: { ax: bmin, ay: bmin }, dE: inp.dE, d, Pmax, fyd: (fyk / gammaS) * 1000, fcd: (inp.fckBlock / gammaC) * 1000, kr: inp.kr ?? 0.9 })
    const cmain = machadoDesign({ piles: inp.piles, pillar: pD, dE: inp.dE, d, Pmax, fyd: (fyk / gammaS) * 1000, fcd: (inp.fckBlock / gammaC) * 1000, kr: inp.kr ?? 0.9 })
    if (bmax / bmin > 1.5 && cmb && cmain && cmain.AsTotal > 0) {
      const dif = (cmb.AsTotal / cmain.AsTotal - 1) * 100
      warnings.push(`Pilar alongado (${fx((inp.pillar.ax * 100), 0)} × ${fx((inp.pillar.ay * 100), 0)} cm, relação ${fx((bmax / bmin), 1)}): o roteiro de bielas adota o pilar quadrado equivalente √(a_p·b_p) (2 estacas: a dimensão na linha das estacas). Com o menor lado (${fx((bmin * 100), 0)} cm) a armadura de tirantes ${dif > 0.5 ? `seria ${fx(dif, 0)} % maior` : 'não muda de modo relevante'}${dif > 5 ? ' — confira o modelo de bielas nas duas direções (CEB-70)' : ''}.`)
    }
    // momento: o roteiro usa N_eff = n·P_máx (reação mais carregada em todas as estacas); informa o quanto isso supera a carga total
    let over = 0
    let tens = false
    for (const c of inp.combos) {
      const mean = c.Nsd / n
      if (mean > 0) over = Math.max(over, Math.max(...c.P) / mean - 1)
      if (Math.min(...c.P) < -1e-6) tens = true
    }
    if (over > 0.15) warnings.push(`Momento no pilar: a reação mais carregada supera em ${fx((over * 100), 0)} % a reação média; o roteiro de Blévot usa n·P_máx em todas as estacas (a favor da segurança, antieconômico). O CEB-70 usa as reações reais.`)
    if (tens) warnings.push('Há estaca tracionada em alguma combinação: os modelos de bielas e tirantes deste roteiro supõem estacas comprimidas; verifique a armadura de ancoragem das estacas no bloco e a tração no pilar.')
  }
  // ----- fissuração dos tirantes no ELS: σs = σs,ELU·(P_ELS/P_ELU,máx) (tração axial no tirante, concreto desprezado)
  const crack: NonNullable<BlockResult['crack']> = []
  if (inp.serviceMaxP !== undefined && n >= 2) {
    const ratio = inp.serviceMaxP / Math.max(...Pmax)
    const lim = CRACK_LIMIT_MM[inp.caa ?? 2]
    for (const bsel of bars) {
      if (/malha|suspens/i.test(bsel.label)) continue
      const sigma = (fyk / gammaS) * Math.min(bsel.AsReq / bsel.AsEff, 1) * ratio
      const cw = crackWidth({ phiMm: bsel.phiMm, nBars: bsel.n, strip, bottom: g0.cTot, sigma, fck: inp.fckBlock })
      crack.push({ name: bsel.label, wk: cw.wk, limit: lim, sigma, ok: cw.wk <= lim })
    }
    const badC = crack.filter((q) => !q.ok)
    if (badC.length) warnings.push(`Fissuração no ELS: ${badC.map((q) => `${q.name} w_k = ${fx(q.wk, 2)} mm > ${q.limit} mm`).join('; ')}. Use mais barras de menor diâmetro (NBR 6118:2026, 17.3.3.2).`)
  }
  return {
    feasible: true, reasons, warnings: [...new Set(warnings)], theta, checks, crack, Rs, bars, secondary,
    geometry: { lx: g0.lx, ly: g0.ly, cx: g0.cx, cy: g0.cy, h, d, a: g0.a, cover: g0.cover, fck: inp.fckBlock, outline: g0.outline, area: g0.area, shape: g0.shape },
    quantities: { concreteM3: g0.area * h, formM2: g0.perimeter * h, steelKg, leanConcreteM2: g0.area },
    method: n >= 2 || usedMethod === 'machado' ? usedMethod : undefined,
    methodKg: { blevot: kgOf('blevot'), machado: kgOf('machado'), flexao: flexBars.length ? kgOf('flexao') : undefined },
  }
}

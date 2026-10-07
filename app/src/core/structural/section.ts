/**
 * Seção circular de concreto armado — diagramas de interação N–M (ELU) e momento-curvatura.
 *
 * Normas: ABNT NBR 6118:2026, 8.2.10.1 (diagrama parábola-retângulo: σc = 0,85·ηc·fcd·[1 − (1 − εc/εc2)^n],
 * εc2 = 2,0 ‰, εcu = 3,5 ‰, n = 2 para fck ≤ 50 MPa; ηc = 1 para fck ≤ 40 e (40/fck)^(1/3) acima), 17.2.2
 * (hipóteses: seções planas, tração do concreto desprezada no ELU) e domínios de deformação (Fig. 17.1:
 * alongamento máximo 10 ‰ na armadura, encurtamento 3,5 ‰ na borda; reta de ruptura pelo ponto C a 3h/7 com 2 ‰).
 * Aço: diagrama bilinear de patamar horizontal, fyd = fyk/γs, Es = 210 GPa.
 *
 * Unidades: kN, m, kPa. Compressão positiva. M = momento em torno do centro da seção (positivo: comprime o topo, y = 0).
 * Restrição: fck ≤ 50 MPa (n = 2).
 */

export interface Materials {
  /** MPa */
  fck: number
  /** γc do concreto (NBR 6122:2022, Tab. 4, para estacas moldadas in loco). */
  gammaC: number
  /** MPa; CA-50 = 500. */
  fyk: number
  gammaS: number
  /** Módulo do aço, MPa. */
  Es?: number
}

export interface CircularSection {
  /** Diâmetro (m) usado na seção resistente. */
  D: number
  /** Número de barras longitudinais, igualmente espaçadas. */
  n: number
  /** Diâmetro das barras (m) — já descontado eventual espessura de sacrifício. */
  phi: number
  /** Raio do círculo dos centros das barras (m) = D/2 − cobrimento − φt − φ/2. */
  Rs: number
  /** Ângulo (rad) da primeira barra medido a partir do topo (y = 0): orientação da gaiola em relação ao plano de flexão. */
  theta0?: number
}

export const EPS_C2 = 0.002
export const EPS_CU = 0.0035
const EPS_SU = 0.01

export function concreteDesign(m: Materials) {
  if (m.fck > 50) throw new Error('Seção implementada para fck ≤ 50 MPa (n = 2).')
  const eta = m.fck <= 40 ? 1 : (40 / m.fck) ** (1 / 3)
  return { fcd: (m.fck / m.gammaC) * 1000, eta } // kPa
}

export function steelDesign(m: Materials) {
  const Es = (m.Es ?? 210000) * 1000
  const fyd = (m.fyk / m.gammaS) * 1000
  return { Es, fyd, eyd: fyd / Es }
}

const sigmaC = (eps: number, fcd: number, eta: number) => {
  if (eps <= 0) return 0
  const e = Math.min(eps, EPS_CU)
  return 0.85 * eta * fcd * (e >= EPS_C2 ? 1 : 1 - (1 - e / EPS_C2) ** 2)
}

export const barArea = (phi: number) => (Math.PI * phi * phi) / 4
export const steelArea = (s: CircularSection) => s.n * barArea(s.phi)
export const concreteArea = (D: number) => (Math.PI * D * D) / 4

interface Bar { y: number; A: number }
function bars(s: CircularSection): Bar[] {
  const th0 = s.theta0 ?? 0
  return Array.from({ length: s.n }, (_, k) => ({
    y: s.D / 2 - s.Rs * Math.cos(th0 + (2 * Math.PI * k) / s.n),
    A: barArea(s.phi),
  }))
}

const NSTRIP = 300

/** Esforços resistentes para um plano de deformações ε(y) = e0 + k·y (y a partir do topo). */
function integrate(s: CircularSection, mat: Materials, e0: number, k: number, tension?: { Ec: number; fct: number }) {
  const { fcd, eta } = concreteDesign(mat)
  const { Es, fyd } = steelDesign(mat)
  const R = s.D / 2
  const dy = s.D / NSTRIP
  let N = 0
  let M = 0
  for (let i = 0; i < NSTRIP; i++) {
    const y = (i + 0.5) * dy
    const w = 2 * Math.sqrt(Math.max(R * R - (y - R) ** 2, 0))
    const eps = e0 + k * y
    let sig = sigmaC(eps, fcd, eta)
    if (eps < 0 && tension) sig = tension.Ec * eps >= -tension.fct ? tension.Ec * eps : 0 // linear até fct, depois fissurado
    const dF = sig * w * dy
    N += dF
    M += dF * (R - y)
  }
  for (const b of bars(s)) {
    const eps = e0 + k * b.y
    const ss = Math.max(-fyd, Math.min(fyd, Es * eps))
    const sc = sigmaC(eps, fcd, eta) // desconta o concreto deslocado pela barra
    const dF = (ss - sc) * b.A
    N += dF
    M += dF * (R - b.y)
  }
  return { N, M }
}

/** Plano de deformações para o parâmetro t ∈ [0, 3] percorrendo os domínios 1→5 (ELU). */
function planeAt(s: CircularSection, t: number): { e0: number; k: number } {
  const yb = Math.max(...bars(s).map((b) => b.y)) // barra mais tracionada (maior profundidade)
  let top: number
  let ebar: number
  if (t <= 1) {
    top = -EPS_SU + t * (EPS_CU + EPS_SU) // domínios 1 e 2: aço a −10 ‰
    ebar = -EPS_SU
  } else if (t <= 2) {
    top = EPS_CU // domínios 3, 4 e 4a: borda a 3,5 ‰; da barra a −10 ‰ até o plano com ε(base) = 0
    const eEnd = EPS_CU * (1 - yb / s.D)
    ebar = -EPS_SU + (t - 1) * (eEnd + EPS_SU)
  } else {
    const f = t - 2 // domínio 5: ponto C a 3D/7 com 2 ‰, borda superior de 3,5 a 2 ‰
    top = EPS_CU - f * (EPS_CU - EPS_C2)
    const k = (EPS_C2 - top) / ((3 * s.D) / 7)
    return { e0: top, k }
  }
  const k = (ebar - top) / yb
  return { e0: top, k }
}

/** Esforço normal resistente (kN) no plano t (monótono em t). */
function normalAt(s: CircularSection, mat: Materials, t: number) {
  const p = planeAt(s, t)
  return integrate(s, mat, p.e0, p.k)
}

export interface Capacity {
  /** Momento resistente de cálculo (kN·m) para o N dado; NaN se N está fora da faixa resistente. */
  MRd: number
  /** Posição da linha neutra a partir do topo (m) — informativo. */
  ok: boolean
  reason?: string
  /** N máximo de compressão (t = 3) e de tração (t = 0). */
  Nmax: number
  Nmin: number
}

/** MRd (kN·m) da seção para o esforço normal de cálculo Nd (kN, compressão positiva), em uma orientação da gaiola. */
export function momentCapacityAt(s: CircularSection, mat: Materials, Nd: number): Capacity {
  const nTop = normalAt(s, mat, 3).N
  const nBot = normalAt(s, mat, 0).N
  if (Nd > nTop) return { MRd: NaN, ok: false, reason: 'Nd acima da capacidade axial da seção', Nmax: nTop, Nmin: nBot }
  if (Nd < nBot) return { MRd: NaN, ok: false, reason: 'Tração acima da capacidade da armadura', Nmax: nTop, Nmin: nBot }
  let lo = 0
  let hi = 3
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi)
    if (normalAt(s, mat, mid).N < Nd) lo = mid
    else hi = mid
  }
  const r = normalAt(s, mat, 0.5 * (lo + hi))
  return { MRd: r.M, ok: true, Nmax: nTop, Nmin: nBot }
}

/** MRd mínimo entre as orientações extremas da gaiola (barra no extremo / entre barras). */
export function momentCapacity(s: CircularSection, mat: Materials, Nd: number): Capacity {
  const a = momentCapacityAt({ ...s, theta0: 0 }, mat, Nd)
  const b = momentCapacityAt({ ...s, theta0: Math.PI / s.n }, mat, Nd)
  if (!a.ok) return a
  return { ...a, MRd: Math.min(a.MRd, b.MRd) }
}

// ------------------------------------------------------------------ momento-curvatura

export interface MomentCurvaturePoint {
  /** Curvatura (1/m). */
  kappa: number
  M: number
}

/**
 * Curva M–κ para o esforço normal N, com diagramas de cálculo (ELU) para o concreto comprimido e o aço, e tração
 * do concreto linear até `fct` (kPa) e nula depois (seção fissurada, sem enrijecimento à tração). Retorna o envelope
 * crescente. κ em passos geométricos de κmin a κmax.
 */
export function momentCurvature(s: CircularSection, mat: Materials, N: number, opts: { Ec: number; fct: number; points?: number; kappaMax?: number }): MomentCurvaturePoint[] {
  const tension = { Ec: opts.Ec, fct: opts.fct }
  const pts = opts.points ?? 60
  const kmax = opts.kappaMax ?? (EPS_CU + EPS_SU) / (0.8 * s.D)
  const kmin = kmax * 1e-4
  const out: MomentCurvaturePoint[] = [{ kappa: 0, M: 0 }]
  let best = 0
  let prevE0: number | undefined
  const SCAN = 600
  const eLo = -0.03
  const eHi = 0.012
  for (let i = 0; i < pts; i++) {
    const kappa = kmin * (kmax / kmin) ** (i / (pts - 1))
    // N(e0, κ) pode ser não monótono em e0 perto da fissuração (tração brusca): varre, acha os cruzamentos de N
    // e escolhe o mais próximo da solução anterior (continuação em κ).
    const g = (e: number) => integrate(s, mat, e, -kappa, tension).N - N // κ > 0 comprime o topo: ε = e0 − κ·y
    const roots: number[] = []
    let ePrev = eLo
    let gPrev = g(ePrev)
    for (let j = 1; j <= SCAN; j++) {
      const e = eLo + ((eHi - eLo) * j) / SCAN
      const gv = g(e)
      if (gPrev === 0 || gPrev * gv < 0) {
        let lo = ePrev
        let hi = e
        for (let it = 0; it < 50; it++) {
          const mid = 0.5 * (lo + hi)
          if (g(lo) * g(mid) <= 0) hi = mid
          else lo = mid
        }
        roots.push(0.5 * (lo + hi))
      }
      ePrev = e
      gPrev = gv
    }
    if (roots.length === 0) continue // fora da faixa (ruptura)
    const e0 = prevE0 === undefined ? roots[roots.length - 1] : roots.reduce((a, r) => (Math.abs(r - prevE0!) < Math.abs(a - prevE0!) ? r : a))
    prevE0 = e0
    const r = integrate(s, mat, e0, -kappa, tension)
    best = Math.max(best, r.M)
    out.push({ kappa, M: best })
  }
  return out
}

/** Rigidez secante EI = M/κ (kN·m²) interpolada na curva M–κ para um momento M (kN·m). */
export function secantEI(curve: MomentCurvaturePoint[], M: number): number {
  const m = Math.abs(M)
  if (curve.length < 2) return NaN
  const first = curve[1]
  if (m <= first.M) return first.M / first.kappa
  for (let i = 2; i < curve.length; i++) {
    if (m <= curve[i].M) {
      const a = curve[i - 1]
      const b = curve[i]
      const f = b.M === a.M ? 0 : (m - a.M) / (b.M - a.M)
      const kappa = a.kappa + f * (b.kappa - a.kappa)
      return m / kappa
    }
  }
  const last = curve[curve.length - 1]
  return last.M / last.kappa
}

// ------------------------------------------------------------------ envoltória pré-calculada (rápida)

export interface InteractionCurve {
  /** Pontos (N, M) em ordem crescente de N, para as duas orientações extremas da gaiola. */
  a: { N: number; M: number }[]
  b: { N: number; M: number }[]
}

/** Calcula a envoltória N–M uma vez (interpolação linear de uma curva côncava é conservadora). */
export function interactionCurve(s: CircularSection, mat: Materials, points = 60): InteractionCurve {
  const make = (theta0: number) => {
    const sec = { ...s, theta0 }
    const out: { N: number; M: number }[] = []
    for (let i = 0; i <= points; i++) {
      const t = (3 * i) / points
      const r = normalAt(sec, mat, t)
      out.push({ N: r.N, M: r.M })
    }
    return out.sort((x, y) => x.N - y.N)
  }
  return { a: make(0), b: make(Math.PI / s.n) }
}

const interp = (pts: { N: number; M: number }[], N: number) => {
  if (N < pts[0].N || N > pts[pts.length - 1].N) return NaN
  let lo = 0
  let hi = pts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].N <= N) lo = mid
    else hi = mid
  }
  const f = pts[hi].N === pts[lo].N ? 0 : (N - pts[lo].N) / (pts[hi].N - pts[lo].N)
  return pts[lo].M + f * (pts[hi].M - pts[lo].M)
}

/** MRd (kN·m) para o N dado pela envoltória (menor das duas orientações); NaN se fora da faixa. */
export function momentCapacityFromCurve(c: InteractionCurve, N: number): number {
  const a = interp(c.a, N)
  const b = interp(c.b, N)
  return Math.min(a, b)
}

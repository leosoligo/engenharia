/**
 * Curvas p-y (reação lateral do solo p, em kN/m de estaca, em função do deslocamento y, em m).
 *
 * Fontes:
 *  - Argila mole: Matlock (1970), conforme Velloso & Lopes, cap. 15, Eqs. 15.11–15.13 e Fig. 15.4.
 *  - Argila rija: Reese, Cox & Koop (1975), conforme Velloso & Lopes, Eqs. 15.14–15.23, Fig. 15.5, Tab. 15.3.
 *  - Areia: API (RP 2A; Reese et al., 1974), conforme Velloso & Lopes, Eqs. 15.24–15.26, Fig. 15.6.
 *    C1, C2, C3 pelas expressões analíticas da API (conferidas com a Fig. 15.6b em φ = 30°: 1,91 / 2,67 / 28,7)
 *    e k(φ) pelos ajustes da API (k = 10 lb/in³ a 28,8° e 275 lb/in³ a 40° acima do NA).
 *
 * Todas as funções são ímpares em y (p(−y) = −p(y)).
 */

const KGF_CM3_TO_KN_M3 = 9806.65

export type Loading = 'static' | 'cyclic'

export interface PyResult {
  /** Reação do solo por unidade de comprimento (kN/m), com o sinal de y. */
  p: number
  /** Resistência última por unidade de comprimento (kN/m), sempre ≥ 0. */
  pu: number
  /** Rigidez secante p/y (kN/m²). Para y → 0 vale a inclinação inicial. */
  Es: number
}

// ------------------------------------------------------------------ Areia (API)

export function apiSandC(phiDeg: number) {
  const r = Math.PI / 180
  const phi = phiDeg * r
  const beta = (45 + phiDeg / 2) * r
  const b = 0.4
  const tb = Math.tan(beta)
  const tbp = Math.tan(beta - phi)
  const Ka = Math.tan((45 - phiDeg / 2) * r) ** 2
  const C1 =
    (b * Math.tan(phi) * Math.sin(beta)) / (tbp * Math.cos(phi / 2)) +
    (tb * tb * Math.tan(phi / 2)) / tbp +
    b * tb * (Math.tan(phi) * Math.sin(beta) - Math.tan(phi / 2))
  const C2 = tb / tbp - Ka
  const C3 = b * Math.tan(phi) * tb ** 4 + Ka * (tb ** 8 - 1)
  return { C1, C2, C3 }
}

/** Módulo de reação inicial k (kN/m³) da API, em função de φ' (graus). Mínimo 5400 kN/m³. */
export function apiSandK(phiDeg: number, belowWaterTable: boolean): number {
  const k = belowWaterTable
    ? 0.1978 * phiDeg ** 2 - 10.232 * phiDeg + 136.82
    : 0.2153 * phiDeg ** 2 - 8.232 * phiDeg + 63.657
  return Math.max(k * 1000, 5400)
}

export interface SandInput {
  z: number
  B: number
  /** Tensão vertical efetiva à profundidade z (kPa). */
  sigmaV: number
  phi: number
  k: number
  loading: Loading
}

export function pySand(inp: SandInput, y: number): PyResult {
  const { z, B, sigmaV, phi, k, loading } = inp
  const { C1, C2, C3 } = apiSandC(phi)
  const pus = (C1 * z + C2 * B) * sigmaV
  const pud = C3 * B * sigmaV
  const pu = Math.min(pus, pud)
  const A = loading === 'cyclic' ? 0.9 : Math.max(3 - (0.8 * z) / B, 0.9)
  const kz = k * z
  const Apu = A * pu
  if (Apu <= 0 || kz <= 0) return { p: 0, pu: Math.max(pu, 0), Es: Math.max(kz, 0) }
  const x = (kz * Math.abs(y)) / Apu
  const p = Math.sign(y) * Apu * Math.tanh(x)
  const Es = Math.abs(y) < 1e-12 ? kz : p / y
  return { p, pu, Es }
}

// ------------------------------------------------------------------ Argila mole (Matlock, 1970)

export interface SoftClayInput {
  z: number
  B: number
  sigmaV: number
  su: number
  /** Deformação correspondente à metade da tensão máxima (V&L sugerem 0,01). */
  epsC: number
  /** Coeficiente experimental J (V&L: 0,5 na falta de determinação). */
  J: number
  loading: Loading
}

export function pySoftClay(inp: SoftClayInput, y: number): PyResult {
  const { z, B, sigmaV, su, epsC, J, loading } = inp
  const Np = Math.min(3 + sigmaV / su + (J * z) / B, 9)
  const pu = Np * su * B
  const yc = 2.5 * epsC * B
  // zr = 6B/(γ'B/Su + J): profundidade de resistência reduzida (equivale a Np = 9)
  const zr = (6 * B) / ((sigmaV / Math.max(z, 1e-9) / su) * B + J)
  const r = Math.abs(y) / yc
  let ratio: number // p/pu
  if (loading === 'static') {
    ratio = r >= 8 ? 1 : 0.5 * Math.cbrt(r)
  } else {
    const plateau = z >= zr ? 0.72 : 0.72 * (z / zr)
    if (r <= 3) ratio = 0.5 * Math.cbrt(r)
    else if (z >= zr) ratio = 0.72
    else ratio = r >= 15 ? plateau : 0.72 + ((plateau - 0.72) * (r - 3)) / 12
  }
  const p = Math.sign(y) * ratio * pu
  const Es = Math.abs(y) < 1e-12 ? Infinity : p / y
  return { p, pu, Es }
}

// ------------------------------------------------------------------ Argila rija (Reese et al., 1975)

/** Fig. 15.6a de V&L, digitalizada (±0,02): A' (estático) e B' (cíclico) em função de z/B. */
const AB_TABLE: { zb: number; A: number; Bc: number }[] = [
  { zb: 0, A: 0.2, Bc: 0.2 },
  { zb: 0.5, A: 0.33, Bc: 0.28 },
  { zb: 1, A: 0.45, Bc: 0.3 },
  { zb: 1.5, A: 0.52, Bc: 0.31 },
  { zb: 2, A: 0.55, Bc: 0.31 },
  { zb: 3, A: 0.58, Bc: 0.31 },
  { zb: 4, A: 0.6, Bc: 0.31 },
]

export function stiffClayAB(zb: number) {
  const t = AB_TABLE
  if (zb >= t[t.length - 1].zb) return { A: t[t.length - 1].A, Bc: t[t.length - 1].Bc }
  for (let i = 1; i < t.length; i++) {
    if (zb <= t[i].zb) {
      const f = (zb - t[i - 1].zb) / (t[i].zb - t[i - 1].zb)
      return { A: t[i - 1].A + f * (t[i].A - t[i - 1].A), Bc: t[i - 1].Bc + f * (t[i].Bc - t[i - 1].Bc) }
    }
  }
  return { A: t[0].A, Bc: t[0].Bc }
}

/** Tab. 15.3 de V&L: ks, kc (kgf/cm³) e εc conforme a resistência não drenada (kgf/cm²). */
export function stiffClayTab153(suKPa: number) {
  const su = suKPa / 98.0665 // kgf/cm²
  const row = su < 1 ? { ks: 14, kc: 5.5, e: 0.007 } : su < 2 ? { ks: 28, kc: 11, e: 0.005 } : { ks: 56, kc: 22, e: 0.004 }
  return { ks: row.ks * KGF_CM3_TO_KN_M3, kc: row.kc * KGF_CM3_TO_KN_M3, epsC: row.e }
}

export interface StiffClayInput {
  z: number
  B: number
  /** Su à profundidade z e média de Su de 0 a z (kPa). */
  su: number
  suAvg: number
  /** γ' médio de 0 a z (kN/m³). */
  gammaAvg: number
  ks: number
  kc: number
  epsC: number
  loading: Loading
}

export function pyStiffClay(inp: StiffClayInput, y: number): PyResult {
  const { z, B, su, suAvg, gammaAvg, ks, kc, epsC, loading } = inp
  const pu1 = 2 * suAvg * B + gammaAvg * B * z + 2.83 * suAvg * z
  const pu2 = 11 * su * B
  const pu = Math.min(pu1, pu2)
  const { A, Bc } = stiffClayAB(z / B)
  const yc = epsC * B
  const ay = Math.abs(y)
  let p: number
  if (loading === 'static') {
    const kz = ks * z
    const par1 = (v: number) => 0.5 * pu * Math.sqrt(v / yc)
    const ycross = kz > 0 ? (0.25 * pu * pu) / (kz * kz * yc) : Infinity
    if (ay <= ycross && ycross <= A * yc) p = kz * ay
    else if (ay <= A * yc) p = par1(ay)
    else if (ay <= 6 * A * yc) p = par1(ay) - 0.055 * pu * ((ay - A * yc) / (A * yc)) ** 1.25
    else if (ay <= 18 * A * yc)
      p = 0.5 * pu * Math.sqrt(6 * A) - 0.411 * pu - (0.0625 / yc) * pu * (ay - 6 * A * yc)
    else p = 0.5 * pu * Math.sqrt(6 * A) - 0.411 * pu - 0.75 * pu * A
  } else {
    const kz = kc * z
    const yp = 4.1 * Bc * yc
    const par = (v: number) => Bc * pu * (1 - ((v - 0.45 * yp) / (0.45 * yp)) ** 2.5)
    // interseção da reta p = kc·z·y com a parábola: busca bissecção em (0, 0.45 yp)
    let ycross = 0
    if (kz > 0) {
      let lo = 1e-12
      let hi = 0.45 * yp
      if (kz * hi >= par(hi)) {
        for (let i = 0; i < 80; i++) {
          const mid = 0.5 * (lo + hi)
          if (kz * mid < par(mid)) lo = mid
          else hi = mid
        }
        ycross = hi
      }
    }
    if (ay <= ycross) p = kz * ay
    else if (ay <= 0.6 * yp) p = par(ay)
    else if (ay <= 1.8 * yp) p = 0.936 * Bc * pu - (0.085 / yc) * pu * (ay - 0.6 * yp)
    else p = 0.936 * Bc * pu - (0.102 / yc) * pu * yp
  }
  p = Math.sign(y) * Math.max(p, 0)
  const Es = ay < 1e-12 ? (loading === 'static' ? ks : kc) * z : p / y
  return { p, pu, Es }
}

// ------------------------------------------------------------------ Linear (Winkler com nh)

export interface LinearInput {
  z: number
  B: number
  /** Taxa de crescimento de kh com a profundidade, kh = nh·z/B → Es = nh·z (kN/m³). */
  nh: number
}

/** Mola linear de Terzaghi: p = nh·z·y (por unidade de comprimento). Sem resistência última. */
export function pyLinear(inp: LinearInput, y: number): PyResult {
  const Es = inp.nh * inp.z
  return { p: Es * y, pu: Infinity, Es }
}

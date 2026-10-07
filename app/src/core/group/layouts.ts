/**
 * Arranjos automáticos de estacas sob um bloco, centrados no eixo do pilar (origem).
 *
 * Fontes (pasta Fontes):
 *  - Campos, J. C., Elementos de Fundações em Concreto (2015), §11.1.1 e Tab. 10.21:
 *      espaçamento inicial entre eixos de 3·dE; mínimos por tipo de estaca e solo (escavadas ≥ 3dE; moldadas in loco
 *      rugosas ≥ 2,5dE em argila e ≥ 2dE em areia; pré-moldadas lisas ≥ 3dE em areia); mínimo absoluto de 60 cm;
 *      n° de estacas por (N + 5–10 % de peso do bloco)/capacidade, majorando 30 % quando há momento;
 *  - Campos, Cap. 12/13 (detalhamento de blocos): arranjos usuais de 1 a 6 estacas (2 em linha, 3 em triângulo,
 *      4 em quadrado, 5 retangular com central ou pentagonal, 6 hexagonal ou retangular).
 * O arranjo 3×3 e maiores seguem malha retangular. Só estacas verticais.
 */
import type { PileType } from '../pile'

export interface LayoutPoint {
  x: number
  y: number
}

export interface Layout {
  id: string
  label: string
  n: number
  points: LayoutPoint[]
}

/** Espaçamento mínimo entre eixos (m) — Campos, Tab. 10.21 (valores em múltiplos de dE) e mínimo de 0,60 m. */
export function minSpacing(type: PileType, diameter: number, soil: 'coesivo' | 'granular'): number {
  let k: number
  switch (type) {
    case 'escavada':
    case 'escavada_fluido':
    case 'helice':
    case 'raiz': // Campos agrupa as moldadas escavadas em 3dE; raiz tratada como escavada (conservador)
      k = 3
      break
    case 'franki':
    case 'strauss': // moldadas in loco (rugosas), sem escavação de grande volume
      k = soil === 'coesivo' ? 2.5 : 2
      break
    case 'premoldada':
      k = soil === 'coesivo' ? 2.5 : 3
      break
  }
  return Math.max(k * diameter, 0.6)
}

const rect = (nx: number, ny: number, s: number, skip?: (i: number, j: number) => boolean): LayoutPoint[] => {
  const pts: LayoutPoint[] = []
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) if (!skip?.(i, j)) pts.push({ x: (i - (nx - 1) / 2) * s, y: (j - (ny - 1) / 2) * s })
  return pts
}
const swap = (p: LayoutPoint[]): LayoutPoint[] => p.map((q) => ({ x: q.y, y: q.x }))
const ring = (n: number, chord: number, phase = 0): LayoutPoint[] => {
  const R = chord / (2 * Math.sin(Math.PI / n))
  return Array.from({ length: n }, (_, k) => ({ x: R * Math.cos(phase + (2 * Math.PI * k) / n), y: R * Math.sin(phase + (2 * Math.PI * k) / n) }))
}
const centroidShift = (p: LayoutPoint[]): LayoutPoint[] => {
  const cx = p.reduce((a, q) => a + q.x, 0) / p.length
  const cy = p.reduce((a, q) => a + q.y, 0) / p.length
  return p.map((q) => ({ x: q.x - cx, y: q.y - cy }))
}

/**
 * Arranjos candidatos com n estacas e espaçamento s (m). Para arranjos assimétricos devolve as duas orientações
 * (eixo longo em X e em Y) para que o otimizador escolha a que melhor resiste ao momento.
 */
export function layoutsFor(n: number, s: number): Layout[] {
  const mk = (id: string, label: string, points: LayoutPoint[]): Layout => ({ id, label, n: points.length, points: centroidShift(points) })
  switch (n) {
    case 1:
      return [mk('1', 'Estaca única', [{ x: 0, y: 0 }])]
    case 2:
      return [mk('2x', 'Duas estacas (linha em X)', rect(2, 1, s)), mk('2y', 'Duas estacas (linha em Y)', rect(1, 2, s))]
    case 3: {
      const h = (s * Math.sqrt(3)) / 2
      const tri = [{ x: -s / 2, y: 0 }, { x: s / 2, y: 0 }, { x: 0, y: h }]
      return [mk('3x', 'Três em triângulo (base em X)', tri), mk('3y', 'Três em triângulo (base em Y)', swap(tri))]
    }
    case 4:
      return [mk('4', 'Quatro em quadrado', rect(2, 2, s))]
    case 5:
      return [
        mk('5c', 'Cinco: quadrado com estaca central', [...rect(2, 2, s * Math.SQRT2), { x: 0, y: 0 }]),
        mk('5p', 'Cinco: pentagonal', ring(5, s, Math.PI / 2)),
      ]
    case 6:
      return [
        mk('6h', 'Seis: hexagonal', ring(6, s)),
        mk('6x', 'Seis: retangular 3×2 (3 em X)', rect(3, 2, s)),
        mk('6y', 'Seis: retangular 2×3 (3 em Y)', rect(2, 3, s)),
      ]
    case 7:
      return [mk('7', 'Sete: hexágono com estaca central', [...ring(6, s), { x: 0, y: 0 }])]
    case 8:
      return [mk('8', 'Oito: malha 3×3 sem a central', rect(3, 3, s, (i, j) => i === 1 && j === 1))]
    case 9:
      return [mk('9', 'Nove: malha 3×3', rect(3, 3, s))]
    case 10:
      return [mk('10x', 'Dez: 5×2 (5 em X)', rect(5, 2, s)), mk('10y', 'Dez: 2×5 (5 em Y)', rect(2, 5, s))]
    case 12:
      return [mk('12x', 'Doze: 4×3 (4 em X)', rect(4, 3, s)), mk('12y', 'Doze: 3×4 (4 em Y)', rect(3, 4, s))]
    default:
      return []
  }
}

/** Contagens de estacas oferecidas pelos arranjos padrão. */
export const LAYOUT_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12] as const

/**
 * Número inicial de estacas (Campos, §11.1.1): (N + peso do bloco)/capacidade, com +30 % no total quando há momento.
 * `blockWeight` é a fração de peso próprio do bloco (0,05 a 0,10 por Campos).
 */
export function initialPileCount(Nmax: number, capacity: number, hasMoment: boolean, blockWeight = 0.1): number {
  const factor = hasMoment ? 1.3 : 1 + blockWeight
  return Math.max(1, Math.ceil((Nmax * factor) / capacity))
}

/** Menor distância entre eixos num arranjo (m). */
export function minDistance(points: LayoutPoint[]): number {
  let d = Infinity
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) d = Math.min(d, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y))
  return d
}

export interface BlockEstimate {
  /** Dimensões em planta (m) e altura estimada (m). */
  lx: number
  ly: number
  h: number
  volume: number
  formArea: number
}

/**
 * Estimativa do bloco para custo (o dimensionamento completo é a Fase 6): planta = envoltória dos centros mais o raio da
 * estaca e uma folga lateral; altura pelo critério de bloco rígido análogo ao da sapata (NBR 6118:2026, 22.7.1 e 22.5:
 * h ≥ (a − ap)/3) e não menor que `hMin` (ancoragem do arranque e das estacas).
 */
export function estimateBlock(points: LayoutPoint[], diameter: number, pillar: { ax: number; ay: number }, margin = 0.15, hMin = 0.5): BlockEstimate {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const lx = Math.max(Math.max(...xs) - Math.min(...xs) + diameter + 2 * margin, pillar.ax + 2 * margin)
  const ly = Math.max(Math.max(...ys) - Math.min(...ys) + diameter + 2 * margin, pillar.ay + 2 * margin)
  const h = Math.max(hMin, (lx - pillar.ax) / 3, (ly - pillar.ay) / 3)
  return { lx, ly, h, volume: lx * ly * h, formArea: 2 * (lx + ly) * h }
}

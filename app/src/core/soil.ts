/** Tipos de solo e perfil de sondagem SPT. */

export const SOIL_TYPES = [
  'areia',
  'areia_siltosa',
  'areia_siltoargilosa',
  'areia_argilosa',
  'areia_argilossiltosa',
  'silte',
  'silte_arenoso',
  'silte_arenoargiloso',
  'silte_argiloso',
  'silte_argiloarenoso',
  'argila',
  'argila_arenosa',
  'argila_arenossiltosa',
  'argila_siltosa',
  'argila_siltoarenosa',
] as const

export type SoilType = (typeof SOIL_TYPES)[number]

export const SOIL_LABEL: Record<SoilType, string> = {
  areia: 'Areia',
  areia_siltosa: 'Areia siltosa',
  areia_siltoargilosa: 'Areia siltoargilosa',
  areia_argilosa: 'Areia argilosa',
  areia_argilossiltosa: 'Areia argilossiltosa',
  silte: 'Silte',
  silte_arenoso: 'Silte arenoso',
  silte_arenoargiloso: 'Silte arenoargiloso',
  silte_argiloso: 'Silte argiloso',
  silte_argiloarenoso: 'Silte argiloarenoso',
  argila: 'Argila',
  argila_arenosa: 'Argila arenosa',
  argila_arenossiltosa: 'Argila arenossiltosa',
  argila_siltosa: 'Argila siltosa',
  argila_siltoarenosa: 'Argila siltoarenosa',
}

/** Uma medida de SPT: profundidade (m) do ensaio, N_SPT dos 30 cm finais e solo do trecho. */
export interface SptLayer {
  depth: number
  nspt: number
  soil: SoilType
}

/** Furo de sondagem. `layers` em profundidades inteiras consecutivas 1, 2, 3 … m. */
export interface SptBorehole {
  id: string
  /** Nível d'água (m), opcional. Não usado pelos métodos semiempíricos de capacidade de carga. */
  waterLevel?: number
  layers: SptLayer[]
}

/** Classe de solo usada pelas tabelas de Décourt-Quaresma (argila, solo intermediário, areia). */
export type SoilClass3 = 'argila' | 'intermediario' | 'areia'

export function soilClass3(s: SoilType): SoilClass3 {
  if (s.startsWith('areia')) return 'areia'
  if (s.startsWith('argila')) return 'argila'
  return 'intermediario'
}

export function nsptAt(b: SptBorehole, depth: number): SptLayer | undefined {
  return b.layers.find((l) => l.depth === depth)
}

/**
 * Furo-envoltória para a análise lateral: em cada metro adota a camada de menor N_SPT entre os furos
 * (solo do furo mais fraco), nível d'água mais raso e profundidade do furo mais curto. É um critério conservador
 * de projeto (não vem de norma); com um único furo devolve o próprio furo.
 */
export function weakestEnvelope(holes: SptBorehole[]): SptBorehole {
  if (holes.length === 1) return holes[0]
  const depth = Math.min(...holes.map((h) => h.layers.length))
  const layers: SptLayer[] = []
  for (let z = 1; z <= depth; z++) {
    let pick: SptLayer | undefined
    for (const h of holes) {
      const l = nsptAt(h, z)
      if (l && (!pick || l.nspt < pick.nspt)) pick = l
    }
    if (pick) layers.push({ ...pick, depth: z })
  }
  const wls = holes.map((h) => h.waterLevel)
  const waterLevel = wls.some((w) => w === undefined || Number.isNaN(w)) ? undefined : Math.min(...(wls as number[]))
  return { id: `envoltória (${holes.map((h) => h.id).join(', ')})`, waterLevel, layers }
}

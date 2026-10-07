/** Tipos de estaca tratados e geometria de seção circular. */

export const PILE_TYPES = [
  'escavada', // escavada sem fluido (trado mecânico / broca)
  'escavada_fluido', // escavada com lama bentonítica ou polímero
  'helice',
  'raiz',
  'premoldada',
  'franki',
  'strauss',
] as const

export type PileType = (typeof PILE_TYPES)[number]

export const PILE_LABEL: Record<PileType, string> = {
  escavada: 'Escavada (sem fluido)',
  escavada_fluido: 'Escavada (com fluido)',
  helice: 'Hélice contínua',
  raiz: 'Raiz',
  premoldada: 'Pré-moldada',
  franki: 'Franki',
  strauss: 'Strauss',
}

export interface CircularPile {
  type: PileType
  /** Diâmetro (m). Para Strauss, Franki e raiz: diâmetro externo do revestimento (NBR 6122:2022, Tab. 4, nota b). */
  diameter: number
}

export const pileArea = (d: number) => (Math.PI * d * d) / 4
export const pilePerimeter = (d: number) => Math.PI * d

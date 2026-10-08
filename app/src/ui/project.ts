/** Estado do projeto (sondagens e cargas) com persistência local e um exemplo pronto. */
import type { SptBorehole, SoilType } from '../core/soil'
import type { LoadCombination } from '../core/loads'

export interface Project {
  library: SptBorehole[]
  selected: string[]
  combos: LoadCombination[]
  pillar: string
  /** Seção padrão do pilar (cm), usada quando o pilar não tem dados próprios. */
  ax: number
  ay: number
  /** Dados por pilar: seção (cm) e sondagens associadas (vazio = as selecionadas do projeto). */
  pillars?: Record<string, PillarInfo>
  /** Unidade de exibição/edição das cargas na tela (o cálculo é sempre em kN e kN·m). */
  units?: 'kN' | 'tf'
  /** Nome do projeto (título e nome do arquivo ao salvar). */
  name?: string
  /** Blocos comuns a dois pilares: dados da união (para desfazer e para o relatório). */
  joins?: Record<string, PillarJoin>
}

export const TF = 9.80665 // kN por tf (e kN·m por tf·m)

export interface PillarInfo { ax: number; ay: number; holes?: string[]; /** Área total (cm²) quando o bloco recebe dois pilares (ax, ay = caixa envolvente). */ areaCm2?: number; /** Armadura de arranque do pilar (opcional): se informada, a altura do bloco passa a ancorá-la. */ arranque?: { phiMm: number; hook?: boolean } }

/** União de dois pilares num bloco: pilares originais, coordenadas (m) e combinações originais (para desfazer). */
export interface PillarJoin {
  a: { name: string; x: number; y: number; ax: number; ay: number }
  b: { name: string; x: number; y: number; ax: number; ay: number }
  originals: LoadCombination[]
  originalInfo: Record<string, PillarInfo | undefined>
  origin: { x: number; y: number }
}

export const pillarSection = (p: Project, name: string) => ({ ax: p.pillars?.[name]?.ax ?? p.ax, ay: p.pillars?.[name]?.ay ?? p.ay })
/** Sondagens do pilar: as associadas a ele (que existam) ou, se não houver, as selecionadas no projeto. */
export const pillarHoles = (p: Project, name: string): string[] => {
  const own = (p.pillars?.[name]?.holes ?? []).filter((id) => p.library.some((h) => h.id === id))
  return own.length ? own : p.selected
}
export const pillarNames = (p: Project): string[] => [...new Set(p.combos.map((c) => c.pillar))]

export const EMPTY_PROJECT: Project = { library: [], selected: [], combos: [], pillar: '', ax: 40, ay: 40 }

const KEY = 'estakalc.project.v1'

// JSON não representa Infinity (NA "não encontrado"): usa um marcador
export const replacer = (_: string, v: unknown) => (v === Infinity ? '__inf__' : v)
export const reviver = (_: string, v: unknown) => (v === '__inf__' ? Infinity : v)

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_PROJECT
    return { ...EMPTY_PROJECT, ...(JSON.parse(raw, reviver) as Partial<Project>) }
  } catch {
    return EMPTY_PROJECT
  }
}

export function saveProject(p: Project) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p, replacer))
  } catch {
    /* armazenamento indisponível */
  }
}

function hole(id: string, na: number, f: (i: number) => [number, SoilType]): SptBorehole {
  return { id, waterLevel: na, layers: Array.from({ length: 30 }, (_, i) => { const [nspt, soil] = f(i); return { depth: i + 1, nspt, soil } }) }
}

/** Exemplo completo: 2 sondagens e 2 pilares com combinações ELS/ELU. */
export function exampleProject(): Project {
  const c = (pillar: string, name: string, state: 'ELS' | 'ELU', fx: number, fy: number, fz: number, mx: number, my: number): LoadCombination => ({ pillar, name, state, fx, fy, fz, mx, my, mz: 0 })
  return {
    library: [
      hole('SP-01', 6, (i) => [Math.min(4 + Math.floor(i * 0.9), 35), i < 5 ? 'argila_arenosa' : i < 20 ? 'areia_siltosa' : 'silte_argiloso']),
      hole('SP-02', 4.5, (i) => [Math.min(3 + Math.floor(i * 0.8), 30), i < 4 ? 'argila_siltosa' : i < 18 ? 'areia_argilosa' : 'silte_arenoso']),
    ],
    selected: ['SP-01'],
    combos: [
      c('P1', 'Permanente + sobrecarga', 'ELS', 15, 0, 1400, 0, 20),
      c('P1', 'Vento X', 'ELS', 40, 0, 1100, 0, 60),
      c('P1', 'Permanente + sobrecarga', 'ELU', 22, 0, 1960, 0, 28),
      c('P1', 'Vento X', 'ELU', 60, 0, 1500, 0, 90),
      c('P2', 'Permanente + sobrecarga', 'ELS', 10, 5, 2600, 10, 25),
      c('P2', 'Vento Y', 'ELS', 8, 45, 2100, 70, 15),
      c('P2', 'Permanente + sobrecarga', 'ELU', 14, 7, 3640, 14, 35),
      c('P2', 'Vento Y', 'ELU', 12, 70, 2900, 105, 22),
    ],
    pillar: 'P1', ax: 40, ay: 40,
  }
}

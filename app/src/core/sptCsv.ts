/**
 * Leitura de sondagens SPT em CSV (vários furos num mesmo arquivo).
 *
 * Colunas (cabeçalho obrigatório, ordem livre, sem diferenciar maiúsculas/acentos):
 *   furo ; profundidade ; nspt ; solo [; na]
 * - separador `;` ou `,` (detectado); decimal com vírgula ou ponto;
 * - profundidades inteiras e consecutivas 1, 2, 3 … m por furo (camadas de 1 m, como nos métodos);
 * - `solo`: um dos 15 nomes da lista (ex.: "Areia siltosa", "areia_siltosa");
 * - `na` (nível d'água, m de profundidade) é opcional e vale para o furo (primeiro valor informado);
 *   "nao encontrado", "seco" ou "ausente" indicam que o NA não foi atingido na sondagem.
 */
import { SOIL_LABEL, SOIL_TYPES, type SoilType, type SptBorehole } from './soil'

export interface CsvParseResult {
  boreholes: SptBorehole[]
  errors: string[]
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

const SOIL_BY_NAME = new Map<string, SoilType>(
  SOIL_TYPES.flatMap((t) => [
    [norm(t), t],
    [norm(SOIL_LABEL[t]), t],
  ]),
)

const num = (s: string) => Number(s.trim().replace(',', '.'))

export function parseSptCsv(text: string): CsvParseResult {
  const errors: string[] = []
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length < 2) return { boreholes: [], errors: ['Arquivo vazio ou sem linhas de dados.'] }

  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const head = lines[0].split(sep).map(norm)
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h))
  const iF = col('furo', 'sondagem', 'id')
  const iZ = col('profundidade', 'prof', 'profundidade_m', 'prof_m')
  const iN = col('nspt', 'n_spt', 'spt', 'n')
  const iS = col('solo', 'tipo_de_solo', 'tipo_solo')
  const iNA = col('na', 'n_a', 'nivel_dagua', 'nivel_d_agua')
  for (const [i, nm] of [[iF, 'furo'], [iZ, 'profundidade'], [iN, 'nspt'], [iS, 'solo']] as const)
    if (i < 0) errors.push(`Coluna obrigatória ausente: "${nm}".`)
  if (errors.length) return { boreholes: [], errors }

  const map = new Map<string, SptBorehole>()
  lines.slice(1).forEach((line, k) => {
    const ln = k + 2
    const c = line.split(sep)
    const id = c[iF]?.trim()
    const depth = num(c[iZ] ?? '')
    const nspt = num(c[iN] ?? '')
    const soil = SOIL_BY_NAME.get(norm(c[iS] ?? ''))
    if (!id) return errors.push(`Linha ${ln}: furo em branco.`)
    if (!Number.isInteger(depth) || depth < 1) return errors.push(`Linha ${ln}: profundidade deve ser inteira ≥ 1 m (lido "${c[iZ]}").`)
    if (!Number.isFinite(nspt) || nspt < 0) return errors.push(`Linha ${ln}: N_SPT inválido ("${c[iN]}").`)
    if (!soil) return errors.push(`Linha ${ln}: solo não reconhecido ("${c[iS]}").`)
    let b = map.get(id)
    if (!b) map.set(id, (b = { id, layers: [] }))
    if (b.layers.some((l) => l.depth === depth)) return errors.push(`Linha ${ln}: furo ${id} repete a profundidade ${depth} m.`)
    b.layers.push({ depth, nspt, soil })
    if (iNA >= 0 && b.waterLevel === undefined && c[iNA]?.trim()) {
      const raw = c[iNA]
      const na = num(raw)
      if (Number.isFinite(na) && na >= 0) b.waterLevel = na
      else if (/^(nao|seco|ausente|n_a)/.test(norm(raw))) b.waterLevel = Infinity
      else errors.push(`Linha ${ln}: nível d'água inválido ("${raw}").`)
    }
  })

  const boreholes: SptBorehole[] = []
  for (const b of map.values()) {
    b.layers.sort((x, y) => x.depth - y.depth)
    const gap = b.layers.findIndex((l, i) => l.depth !== i + 1)
    if (gap >= 0) errors.push(`Furo ${b.id}: profundidades devem ser consecutivas a partir de 1 m (falha em ${gap + 1} m).`)
    else boreholes.push(b)
  }
  return { boreholes, errors }
}

export const SPT_CSV_TEMPLATE =
  'furo;profundidade;nspt;solo;na\n' +
  'SP-01;1;7;Argila arenosa;3\n' +
  'SP-01;2;8;Argila siltosa;\n' +
  'SP-01;3;8;Areia siltosa;\n' +
  'SP-02;1;5;Argila siltosa;2,5\n' +
  'SP-02;2;6;Argila siltosa;\n'

/** Exporta sondagens no mesmo formato lido por `parseSptCsv` (furo;profundidade;nspt;solo;na), para guardar ou reutilizar. */
export function sptToCsv(boreholes: SptBorehole[]): string {
  const head = 'furo;profundidade;nspt;solo;na'
  const lines: string[] = []
  for (const b of boreholes) {
    [...b.layers].sort((x, y) => x.depth - y.depth).forEach((l, i) => {
      const na = i > 0 ? '' : b.waterLevel === undefined ? '' : b.waterLevel === Infinity ? 'não encontrado' : String(b.waterLevel).replace('.', ',')
      lines.push([b.id, l.depth, l.nspt, SOIL_LABEL[l.soil], na].join(';'))
    })
  }
  return '﻿' + [head, ...lines].join('\n') + '\n'
}

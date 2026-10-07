/**
 * Leitor mínimo de planilhas .xlsx (OOXML): devolve a primeira planilha como matriz de células (texto ou número).
 * Suficiente para relatórios exportados por programas (valores, sem fórmulas/estilos). Usa fflate para descompactar.
 */
import { strFromU8, unzipSync } from 'fflate'

export type Cell = string | number | null

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const colIndex = (ref: string) => {
  let n = 0
  for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('')

export function readXlsx(data: Uint8Array): Cell[][] {
  const files = unzipSync(data)
  const get = (name: string) => (files[name] ? strFromU8(files[name]) : undefined)
  const shared = [...(get('xl/sharedStrings.xml') ?? '').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
  // primeira planilha: a do workbook.xml, senão sheet1.xml
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wb = get('xl/workbook.xml')
  const rels = get('xl/_rels/workbook.xml.rels')
  const rid = wb?.match(/<sheet\s[^>]*r:id="([^"]+)"/)?.[1]
  if (rid && rels) {
    const target = [...rels.matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`))?.match(/Target="([^"]+)"/)?.[1]
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  }
  const xml = get(sheetPath)
  if (!xml) throw new Error('Planilha não encontrada no arquivo .xlsx.')
  const rows: Cell[][] = []
  for (const rm of xml.matchAll(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = +(rm[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1
    const cells: Cell[] = []
    for (const cm of (rm[2] ?? '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]
      const ci = colIndex(attrs.match(/\br="([A-Z]+)\d+"/i)?.[1] ?? 'A')
      const t = attrs.match(/\bt="([^"]+)"/)?.[1]
      const body = cm[2] ?? ''
      let v: Cell = null
      if (t === 'inlineStr') v = textOf(body)
      else {
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        if (raw !== undefined) v = t === 's' ? (shared[+raw] ?? '') : t === 'str' || t === 'e' ? decode(raw) : t === 'b' ? (raw === '1' ? 1 : 0) : Number(raw)
      }
      cells[ci] = v
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null
    rows[r] = cells
  }
  for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = []
  return rows
}

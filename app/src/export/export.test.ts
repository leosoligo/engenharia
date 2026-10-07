import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { optimize, ZERO_COSTS, type OptimizeInput } from '../core/optimize'
import { barSchedule } from './schedule'
import { buildDxf } from './dxf'
import { buildReport, buildReportDocx } from './report'
import { compareCsv, compareTable } from './compare'
import { crc32 } from './doc'
import { DEFAULT_SETTINGS } from '../settings'
import { unitsOf } from '../ui/units'
import type { SptBorehole } from '../core/soil'
import type { LoadCombination } from '../core/loads'

const bh: SptBorehole = { id: 'SP-01', waterLevel: 6, layers: Array.from({ length: 30 }, (_, i) => ({ depth: i + 1, nspt: Math.min(4 + Math.floor(i * 0.9), 35), soil: (i < 5 ? 'argila_arenosa' : 'areia_siltosa') as 'argila' })) }
const combo = (name: string, state: 'ELS' | 'ELU', h: number, fz: number, m: number): LoadCombination => ({ pillar: 'P1', name, state, fx: h, fy: 0, fz, mx: 0, my: m, mz: 0 })
const combos = [combo('C1', 'ELS', 15, 1400, 20), combo('U1', 'ELU', 22, 1960, 28), combo('U2', 'ELU', 60, 1500, 90)]
const inp: OptimizeInput = {
  boreholes: [bh], pillar: { ax: 0.4, ay: 0.4 }, combos, types: ['helice'], diameters: { helice: [0.4, 0.5] }, caa: 2, transverse: 'estribo', topDepth: 1,
  costs: { ...ZERO_COSTS, concretePerM3: 450, steelPerKg: 9 }, serviceLimit: 0.025, maxResults: 2,
}

describe('Exportação: tabela de ferros, DXF e memorial', () => {
  const c = optimize(inp).best[0]
  const sch = barSchedule(c)
  it('a tabela de ferros reproduz as massas do dimensionamento', () => {
    const pile = sch.rows.filter((r) => r.element === 'Estaca').reduce((a, r) => a + r.kg, 0)
    expect(pile).toBeCloseTo(c.design.weights!.totalKg * c.layout.n, 1)
    expect(sch.totalKg).toBeCloseTo(pile + c.blockDesign.quantities.steelKg, 1)
    expect(sch.summary.reduce((a, r) => a + r.kg, 0) + sch.extras.reduce((a, e) => a + e.kg, 0)).toBeCloseTo(sch.totalKg, 6)
  })
  it('DXF com cotas, posições e tabela de ferros, sem NaN', () => {
    const dxf = buildDxf(c, { pillar: { ax: 0.4, ay: 0.4 }, title: 'T' })
    expect(dxf).toContain('TABELA DE ACO')
    expect(dxf).toContain('RESUMO DO ACO')
    expect(dxf).toContain('N1 ')
    expect(dxf).toContain('%%c')
    expect(dxf).toContain('LTYPE')
    expect(dxf.split('\n0\nLINE\n').length).toBeGreaterThan(80)
    expect(dxf).not.toMatch(/NaN|Infinity|undefined/)
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
    if (process.env.DXF_OUT) writeFileSync(process.env.DXF_OUT, dxf)
  })
  it('memorial inclui a tabela de ferros', () => {
    const html = buildReport(c, { pillarId: 'P1', pillar: { ax: 0.4, ay: 0.4 }, combos, boreholes: [bh], settings: DEFAULT_SETTINGS })
    expect(html).toContain('Tabela de ferros')
    expect(html).toContain('CA-50')
  })
  it('memorial em tf: converte forças e momentos (1 tf = 9,80665 kN)', () => {
    const kn = buildReport(c, { pillarId: 'P1', pillar: { ax: 0.4, ay: 0.4 }, combos, boreholes: [bh], settings: DEFAULT_SETTINGS })
    const tf = buildReport(c, { pillarId: 'P1', pillar: { ax: 0.4, ay: 0.4 }, combos, boreholes: [bh], settings: DEFAULT_SETTINGS, units: unitsOf('tf') })
    expect(kn).toContain('Fz (kN)')
    expect(tf).toContain('Fz (tf)')
    expect(tf).toContain('1 tf = 9,80665 kN')
    expect(tf).toContain((1960 / 9.80665).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) // 1960 kN = 199,87 tf
  })
  it('memorial em DOCX: ZIP válido (CRC conferido), com document.xml e o conteúdo do memorial', () => {
    const bytes = buildReportDocx(c, { pillarId: 'P1', pillar: { ax: 0.4, ay: 0.4 }, combos, boreholes: [bh], settings: DEFAULT_SETTINGS })
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b])
    const dv = new DataView(bytes.buffer)
    // diretório central: percorre as entradas e confere CRC e tamanhos
    const eocd = bytes.length - 22
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50)
    const count = dv.getUint16(eocd + 10, true)
    let p = dv.getUint32(eocd + 16, true)
    const names: string[] = []
    for (let i = 0; i < count; i++) {
      expect(dv.getUint32(p, true)).toBe(0x02014b50)
      const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true)
      const nlen = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true)
      names.push(new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen)))
      const lnlen = dv.getUint16(off + 26, true)
      const data = bytes.subarray(off + 30 + lnlen, off + 30 + lnlen + size)
      expect(crc32(data)).toBe(crc)
      p += 46 + nlen
    }
    expect(names).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml'])
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('Memorial de cálculo')
    expect(text).toContain('Tabela de ferros')
    if (process.env.DOCX_OUT) writeFileSync(process.env.DOCX_OUT, bytes)
  })
  it('comparativo lado a lado e CSV', () => {
    const r = optimize({ ...inp, maxResults: 3 }).best
    const t = compareTable(r)
    expect(t.columns.length).toBe(r.length)
    const tot = t.rows.find((x) => x.label.startsWith('Custo total'))!
    expect(tot.values.length).toBe(r.length)
    if (r.length > 1) expect(tot.best).toBe(r.map((x) => x.cost.total).indexOf(Math.min(...r.map((x) => x.cost.total))))
    const csv = compareCsv(t, 'Pilar P1')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.split(String.fromCharCode(13, 10))[1].split(';').length).toBe(r.length + 1)
    expect(csv).not.toMatch(/NaN|undefined/)
  })
})

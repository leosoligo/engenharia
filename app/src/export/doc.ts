/**
 * Modelo de documento simples (títulos, parágrafos, listas e tabelas) e dois renderizadores: HTML autocontido (imprimir/PDF) e
 * DOCX (Word) gerado sem dependências, com ZIP sem compressão.
 */

export type DocBlock =
  | { k: 'h1' | 'h2'; t: string }
  | { k: 'note'; t: string }
  | { k: 'p'; t: string }
  | { k: 'warn'; t: string }
  | { k: 'ul'; items: string[]; small?: boolean }
  | { k: 'table'; head?: string[]; rows: string[][]; boldLast?: boolean }

export interface Doc {
  title: string
  blocks: DocBlock[]
}

const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

export function renderHtml(doc: Doc): string {
  const body = doc.blocks.map((b) => {
    switch (b.k) {
      case 'h1': return `<h1>${escHtml(b.t)}</h1>`
      case 'h2': return `<h2>${escHtml(b.t)}</h2>`
      case 'note': return `<div class="s">${escHtml(b.t)}</div>`
      case 'p': return `<p>${escHtml(b.t)}</p>`
      case 'warn': return `<div class="w">${escHtml(b.t)}</div>`
      case 'ul': return `<ul${b.small ? ' class="s"' : ''}>${b.items.map((x) => `<li>${escHtml(x)}</li>`).join('')}</ul>`
      case 'table': {
        const head = b.head ? `<thead><tr>${b.head.map((h) => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>` : ''
        const last = b.rows.length - 1
        const rows = b.rows.map((r, i) => `<tr>${r.map((c) => `<td>${b.boldLast && i === last ? `<b>${escHtml(c)}</b>` : escHtml(c)}</td>`).join('')}</tr>`).join('')
        return `<table>${head}<tbody>${rows}</tbody></table>`
      }
    }
  }).join('\n')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escHtml(doc.title)}</title>
<style>
 body{font:13px/1.45 system-ui,Segoe UI,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}
 h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #999;padding-bottom:2px}
 table{border-collapse:collapse;width:100%;margin:6px 0} td,th{border:1px solid #bbb;padding:3px 6px;text-align:left;font-size:12px} th{background:#eee}
 .w{background:#fff6d6;border:1px solid #e0c060;padding:6px 10px;margin:8px 0} .s{color:#555;font-size:11px}
 @media print{ .noprint{display:none} h2{break-after:avoid} table{break-inside:avoid} }
</style></head><body>
<button class="noprint" onclick="window.print()">Imprimir / Salvar como PDF</button>
${body}
</body></html>`
}

// ------------------------------------------------------------------ ZIP (sem compressão) e DOCX

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** ZIP com entradas armazenadas (método 0). */
export function storeZip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff]
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...name])
    parts.push(local, f.data)
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]))
    offset += local.length + f.data.length
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0)
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)])
  const all = [...parts, ...central, end]
  const out = new Uint8Array(new ArrayBuffer(all.reduce((a, p) => a + p.length, 0)))
  let o = 0
  for (const p of all) { out.set(p, o); o += p.length }
  return out
}

const escXml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const run = (t: string, o: { b?: boolean; sz?: number; color?: string } = {}) =>
  `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}<w:sz w:val="${o.sz ?? 20}"/></w:rPr><w:t xml:space="preserve">${escXml(t)}</w:t></w:r>`
const para = (inner: string, o: { before?: number; after?: number; shade?: string; border?: boolean; keep?: boolean } = {}) =>
  `<w:p><w:pPr>${o.keep ? '<w:keepNext/>' : ''}${o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>' : ''}${o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : ''}<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 80}"/></w:pPr>${inner}</w:p>`

function tableXml(head: string[] | undefined, rows: string[][], boldLast: boolean): string {
  const ncol = Math.max(head?.length ?? 0, ...rows.map((r) => r.length), 1)
  const w = Math.floor(9500 / ncol)
  const cell = (t: string, o: { b?: boolean; fill?: string }) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}</w:tcPr>${para(run(t, { b: o.b, sz: 18 }), { after: 20 })}</w:tc>`
  const tr = (cells: string[], o: { b?: boolean; fill?: string }) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${Array.from({ length: ncol }, (_, i) => cell(cells[i] ?? '', o)).join('')}</w:tr>`
  const b = '<w:top w:val="single" w:sz="4" w:color="BBBBBB"/><w:left w:val="single" w:sz="4" w:color="BBBBBB"/><w:bottom w:val="single" w:sz="4" w:color="BBBBBB"/><w:right w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideH w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideV w:val="single" w:sz="4" w:color="BBBBBB"/>'
  const last = rows.length - 1
  return `<w:tbl><w:tblPr><w:tblW w:w="${w * ncol}" w:type="dxa"/><w:tblBorders>${b}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${Array.from({ length: ncol }, () => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${head ? tr(head, { b: true, fill: 'EEEEEE' }) : ''}${rows.map((r, i) => tr(r, { b: boldLast && i === last })).join('')}</w:tbl>${para('', { after: 60 })}`
}

export function renderDocx(doc: Doc): Uint8Array<ArrayBuffer> {
  const body = doc.blocks.map((b) => {
    switch (b.k) {
      case 'h1': return para(run(b.t, { b: true, sz: 36 }), { after: 60 })
      case 'h2': return para(run(b.t, { b: true, sz: 28 }), { before: 240, border: true, keep: true })
      case 'note': return para(run(b.t, { sz: 18, color: '555555' }))
      case 'p': return para(run(b.t))
      case 'warn': return para(run(b.t, { sz: 19 }), { shade: 'FFF6D6', before: 40 })
      case 'ul': return b.items.map((x) => para(run('•  ' + x, { sz: b.small ? 18 : 20 }), { after: 30 })).join('')
      case 'table': return tableXml(b.head, b.rows, !!b.boldLast)
    }
  }).join('')
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const enc = new TextEncoder()
  const files = [
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', data: enc.encode(document) },
  ]
  return storeZip(files)
}

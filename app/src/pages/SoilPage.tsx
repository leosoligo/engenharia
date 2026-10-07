import { useState, type ChangeEvent } from 'react'
import { parseSptCsv, SPT_CSV_TEMPLATE, sptToCsv } from '../core/sptCsv'
import { SOIL_LABEL, SOIL_TYPES, type SoilType, type SptBorehole } from '../core/soil'
import { SoilLegend, SoilProfileChart } from '../ui/charts'
import type { Project } from '../ui/project'

export function download(name: string, data: BlobPart, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface Props {
  project: Project
  setProject: (p: Project) => void
  onExample: () => void
  onNext: () => void
}

/** Editor de furo: identificação, nível d'água e camadas de 1 m (N_SPT e tipo de solo). */
function HoleEditor({ hole, ids, onChange, onClose }: { hole: SptBorehole; ids: string[]; onChange: (h: SptBorehole, oldId: string) => void; onClose: () => void }) {
  const [more, setMore] = useState(5)
  const duplicateId = ids.filter((x) => x === hole.id).length > 1
  const upd = (patch: Partial<SptBorehole>) => onChange({ ...hole, ...patch }, hole.id)
  const setLayer = (i: number, patch: { nspt?: number; soil?: SoilType }) => upd({ layers: hole.layers.map((l, k) => (k === i ? { ...l, ...patch } : l)) })
  const addMeters = (n: number) => {
    const last = hole.layers[hole.layers.length - 1] ?? { nspt: 5, soil: 'areia' as SoilType }
    const extra = Array.from({ length: n }, (_, k) => ({ depth: hole.layers.length + k + 1, nspt: last.nspt, soil: last.soil }))
    upd({ layers: [...hole.layers, ...extra] })
  }
  const setDepth = (d: number) => {
    if (!Number.isFinite(d) || d < 1) return
    const n = Math.min(Math.round(d), 200)
    if (n > hole.layers.length) addMeters(n - hole.layers.length)
    else if (n < hole.layers.length && confirm(`Reduzir a sondagem de ${hole.layers.length} m para ${n} m? As camadas abaixo de ${n} m serão apagadas.`)) upd({ layers: hole.layers.slice(0, n) })
  }
  const fillDown = (i: number) => upd({ layers: hole.layers.map((l, k) => (k > i ? { ...l, soil: hole.layers[i].soil } : l)) })
  return (
    <section className="card editor">
      <div className="editor-h">
        <h2>Lançamento manual — {hole.id}</h2>
        <button onClick={onClose}>Concluir</button>
      </div>
      <div className="row">
        <label className="fld"><span>Profundidade final da sondagem (m) *</span>
          <input type="number" min={1} max={200} step={1} value={hole.layers.length} onChange={(e) => setDepth(+e.target.value)} />
          <small>A estaca só pode ser dimensionada até esta profundidade (descontada a base do bloco).</small>
        </label>
        <label className="fld"><span>Identificação do furo</span>
          <input value={hole.id} className={duplicateId ? 'edited' : ''} onChange={(e) => upd({ id: e.target.value })} />
          {duplicateId && <small className="bad-t">Já existe um furo com esse nome.</small>}
        </label>
        <label className="fld"><span>Nível d’água (m)</span>
          <input type="number" min={0} step={0.1} disabled={hole.waterLevel === Infinity} placeholder="obrigatório" className={hole.waterLevel === undefined ? 'edited' : ''}
            value={hole.waterLevel === undefined || hole.waterLevel === Infinity ? '' : hole.waterLevel} onChange={(e) => upd({ waterLevel: e.target.value === '' ? undefined : +e.target.value })} />
        </label>
        <label className="inline"><input type="checkbox" checked={hole.waterLevel === Infinity} onChange={(e) => upd({ waterLevel: e.target.checked ? Infinity : undefined })} />não encontrado</label>
      </div>
      <p className="hint">Uma linha por metro: o N<sub>SPT</sub> é o do ensaio iniciado naquela profundidade e o solo é o do trecho. Use “↧” para repetir o solo nas linhas abaixo.</p>
      <div className="scroll-y">
        <table className="layers">
          <thead><tr><th>Prof. (m)</th><th>N<sub>SPT</sub></th><th>Tipo de solo</th><th /></tr></thead>
          <tbody>
            {hole.layers.map((l, i) => (
              <tr key={i}>
                <td>{l.depth}</td>
                <td><input type="number" min={0} value={l.nspt} onChange={(e) => setLayer(i, { nspt: Math.max(0, +e.target.value) })} aria-label={`N SPT a ${l.depth} m`} /></td>
                <td>
                  <select value={l.soil} onChange={(e) => setLayer(i, { soil: e.target.value as SoilType })} aria-label={`Solo a ${l.depth} m`}>
                    {SOIL_TYPES.map((t) => <option key={t} value={t}>{SOIL_LABEL[t]}</option>)}
                  </select>
                </td>
                <td>
                  <button className="small ghost" title="Repetir este solo nas linhas abaixo" onClick={() => fillDown(i)} disabled={i === hole.layers.length - 1}>↧</button>
                  {i === hole.layers.length - 1 && hole.layers.length > 1 && <button className="small ghost" title="Remover a última linha" onClick={() => upd({ layers: hole.layers.slice(0, -1) })} aria-label="Remover última linha">×</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button onClick={() => addMeters(1)}>+ 1 metro</button>
        <label className="inline">ou adicionar <input type="number" min={1} max={50} value={more} onChange={(e) => setMore(Math.max(1, +e.target.value))} style={{ width: 70 }} /> metros</label>
        <button onClick={() => addMeters(more)}>Adicionar</button>
      </div>
    </section>
  )
}

export default function SoilPage({ project, setProject, onExample, onNext }: Props) {
  const [errors, setErrors] = useState<string[]>([])
  const [active, setActive] = useState<string | undefined>()
  const [editing, setEditing] = useState<string | undefined>()
  const lib = project.library
  const shown = lib.find((h) => h.id === (active ?? project.selected[0])) ?? lib[0]
  const editingHole = lib.find((h) => h.id === editing)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const r = parseSptCsv(await f.text())
    setErrors(r.errors)
    if (r.boreholes.length) {
      const ids = new Set(r.boreholes.map((b) => b.id))
      setProject({ ...project, library: [...lib.filter((h) => !ids.has(h.id)), ...r.boreholes], selected: project.selected.length ? project.selected : [r.boreholes[0].id] })
      setActive(r.boreholes[0].id)
    }
  }
  const [creating, setCreating] = useState(false)
  const [newDepth, setNewDepth] = useState('')
  const depthOk = Number.isInteger(+newDepth) && +newDepth >= 1 && +newDepth <= 200
  const newHole = () => {
    if (!depthOk) return
    let n = lib.length + 1
    while (lib.some((h) => h.id === `SP-${String(n).padStart(2, '0')}`)) n++
    const id = `SP-${String(n).padStart(2, '0')}`
    const h: SptBorehole = { id, layers: Array.from({ length: +newDepth }, (_, i) => ({ depth: i + 1, nspt: 4, soil: 'areia' as SoilType })) }
    setCreating(false)
    setNewDepth('')
    setProject({ ...project, library: [...lib, h], selected: project.selected.length ? project.selected : [id] })
    setEditing(id)
    setActive(id)
  }
  const changeHole = (h: SptBorehole, oldId: string) => {
    setProject({
      ...project,
      library: lib.map((x) => (x.id === oldId ? h : x)),
      selected: project.selected.map((id) => (id === oldId ? h.id : id)),
    })
    if (editing === oldId) setEditing(h.id)
    if (active === oldId) setActive(h.id)
  }
  const setNA = (id: string, na: number | undefined) => setProject({ ...project, library: lib.map((h) => (h.id === id ? { ...h, waterLevel: na } : h)) })
  const toggle = (id: string) => setProject({ ...project, selected: project.selected.includes(id) ? project.selected.filter((x) => x !== id) : [...project.selected, id] })
  const remove = (id: string) => {
    setProject({ ...project, library: lib.filter((h) => h.id !== id), selected: project.selected.filter((x) => x !== id) })
    if (editing === id) setEditing(undefined)
  }
  const ready = project.selected.length > 0 && project.selected.every((id) => lib.find((h) => h.id === id)?.waterLevel !== undefined)

  const creator = creating && (
    <section className="card">
      <h3>Nova sondagem</h3>
      <div className="row">
        <label className="fld"><span>Profundidade final da sondagem (m) *</span>
          <input type="number" min={1} max={200} step={1} autoFocus value={newDepth} placeholder="obrigatório" className={newDepth !== '' && !depthOk ? 'edited' : ''} onChange={(e) => setNewDepth(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newHole()} />
          <small>Número de metros com N<sub>SPT</sub> informado (ex.: 9). Você preenche cada metro em seguida.</small>
        </label>
        <button className="primary" disabled={!depthOk} onClick={newHole}>Criar sondagem</button>
        <button onClick={() => { setCreating(false); setNewDepth('') }}>Cancelar</button>
      </div>
    </section>
  )
  const actions = (
    <div className="row">
      <button className="primary" onClick={() => setCreating(true)}>＋ Lançar manualmente</button>
      <label className="btn">Importar CSV<input type="file" accept=".csv,text/csv" onChange={onFile} hidden /></label>
      <button onClick={() => download('sondagens-estakalc.csv', sptToCsv(lib))} disabled={lib.length === 0} title="Salva todas as sondagens (perfil, NSPT, solo e NA) em CSV, no mesmo formato da importação">⬇ Exportar sondagens (CSV)</button>
      <button onClick={() => download('modelo-sondagem.csv', SPT_CSV_TEMPLATE)}>Baixar modelo do CSV</button>
    </div>
  )

  return (
    <>
      <header className="page-h">
        <h1>1 · Sondagens SPT</h1>
        <p>Informe o perfil do terreno digitando os dados ou importando um arquivo. O software usa o N<sub>SPT</sub> e o tipo de solo de cada metro, e o nível d’água.</p>
      </header>

      {lib.length === 0 ? (
        <section className="card empty">
          <div className="empty-ill" aria-hidden>
            <svg viewBox="0 0 120 90"><rect x="10" y="10" width="40" height="70" fill="#e6c875" /><rect x="10" y="40" width="40" height="22" fill="#b9a384" /><rect x="10" y="62" width="40" height="18" fill="#a9745b" /><line x1="4" x2="56" y1="34" y2="34" stroke="#3b82f6" strokeDasharray="4 3" strokeWidth="2" />{[18, 26, 34, 44, 54, 62, 72].map((y, i) => <rect key={y} x="62" y={y - 4} width={14 + i * 6} height="6" fill="#4b5d78" />)}</svg>
          </div>
          <h2>Comece lançando ou importando uma sondagem</h2>
          <p>Você pode digitar metro a metro (N<sub>SPT</sub> e tipo de solo) ou importar um CSV com as colunas <code>furo; profundidade; nspt; solo; na</code>. Para conhecer o programa, carregue um exemplo completo.</p>
          {actions}
          {creator}
          <div className="row"><button className="primary-ghost" onClick={onExample}>✨ Carregar exemplo completo</button></div>
          {errors.length > 0 && <ul className="warn">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
        </section>
      ) : (
        <>
          <section className="card">
            {actions}
            {creator}
            {errors.length > 0 && <ul className="warn">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
          </section>
          <div className="split">
            <section className="card">
              <h2>Furos</h2>
              <p className="hint">Marque os furos que representam a fundação. Com mais de um furo, a NBR 6122 aplica os fatores ξ sobre a média e o mínimo.</p>
              <div className="holes">
                {lib.map((h) => {
                  const on = project.selected.includes(h.id)
                  const missing = h.waterLevel === undefined
                  return (
                    <div key={h.id} className={`hole ${on ? 'on' : ''} ${shown?.id === h.id ? 'active' : ''}`} onClick={() => setActive(h.id)}>
                      <label className="inline strong" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={on} onChange={() => toggle(h.id)} />
                        {h.id}
                      </label>
                      <span className="meta">{h.layers.length} m · {[...new Set(h.layers.map((l) => SOIL_LABEL[l.soil]))].slice(0, 3).join(', ')}{new Set(h.layers.map((l) => l.soil)).size > 3 ? '…' : ''}</span>
                      <div className="na" onClick={(e) => e.stopPropagation()}>
                        <label>
                          <span>Nível d’água (m)</span>
                          <input type="number" min={0} step={0.1} placeholder="obrigatório" className={missing ? 'edited' : ''} disabled={h.waterLevel === Infinity}
                            value={h.waterLevel === undefined || h.waterLevel === Infinity ? '' : h.waterLevel}
                            onChange={(e) => setNA(h.id, e.target.value === '' ? undefined : +e.target.value)} />
                        </label>
                        <label className="inline"><input type="checkbox" checked={h.waterLevel === Infinity} onChange={(e) => setNA(h.id, e.target.checked ? Infinity : undefined)} />não encontrado</label>
                      </div>
                      {missing && <small className="bad-t">Informe o NA: é obrigatório para a análise lateral.</small>}
                      <div className="row tight">
                        <button className="small" onClick={(e) => { e.stopPropagation(); setEditing(h.id); setActive(h.id) }}>✎ Editar camadas</button>
                        <button className="small ghost" onClick={(e) => { e.stopPropagation(); remove(h.id) }} aria-label={`Remover ${h.id}`}>remover</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
            <section className="card">
              <h2>Perfil — {shown?.id}</h2>
              {shown && <SoilProfileChart bh={shown} />}
              <SoilLegend />
            </section>
          </div>
          {editingHole && <HoleEditor hole={editingHole} ids={lib.map((h) => h.id)} onChange={changeHole} onClose={() => setEditing(undefined)} />}
        </>
      )}

      <footer className="page-f">
        <span className={ready ? 'ok-t' : 'hint'}>{ready ? '✓ Sondagem pronta' : lib.length ? 'Selecione ao menos um furo e informe o nível d’água.' : ''}</span>
        <button className="primary" disabled={!ready} onClick={onNext}>Próximo: cargas do pilar →</button>
      </footer>
    </>
  )
}

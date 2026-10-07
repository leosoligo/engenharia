import { useState, type ChangeEvent } from 'react'
import { LOADS_CSV_TEMPLATE, groupByPillar, parseLoadsCsv, type LoadCombination, type LimitState } from '../core/loads'
import { LoadSketch } from '../ui/charts'
import { TF, pillarHoles, pillarSection, type Project } from '../ui/project'
import EberickImport from './EberickImport'
import JoinPanel from './JoinPanel'
import { download } from './SoilPage'

interface Props {
  project: Project
  setProject: (p: Project) => void
  onExample: () => void
  onBack: () => void
  onNext: () => void
}

type NumKey = 'fx' | 'fy' | 'fz' | 'mx' | 'my' | 'mz'
const NUM_COLS: { k: NumKey; label: string; hint: string }[] = [
  { k: 'fx', label: 'Fx', hint: 'kN, positivo no sentido +X' },
  { k: 'fy', label: 'Fy', hint: 'kN, positivo no sentido +Y' },
  { k: 'fz', label: 'Fz', hint: 'kN, compressão positiva (para baixo)' },
  { k: 'mx', label: 'Mx', hint: 'kN·m, regra da mão direita em torno de X' },
  { k: 'my', label: 'My', hint: 'kN·m, regra da mão direita em torno de Y' },
  { k: 'mz', label: 'Mz', hint: 'kN·m, em torno de Z (opcional)' },
]

export default function LoadsPage({ project, setProject, onExample, onBack, onNext }: Props) {
  const [errors, setErrors] = useState<string[]>([])
  const [sel, setSel] = useState(0)
  const [newPillar, setNewPillar] = useState('')
  const [showEb, setShowEb] = useState(false)
  const byPillar = groupByPillar(project.combos)
  const pillars = [...byPillar.keys()]
  const sec = pillarSection(project, project.pillar)
  const tf = project.units === 'tf'
  const uk = tf ? 1 / TF : 1 // kN → unidade exibida
  const uF = tf ? 'tf' : 'kN'
  const uM = tf ? 'tf·m' : 'kN·m'
  const ownHoles = project.pillars?.[project.pillar]?.holes ?? []
  const setInfo = (patch: Partial<{ ax: number; ay: number; holes: string[] }>) =>
    setProject({ ...project, pillars: { ...project.pillars, [project.pillar]: { ax: sec.ax, ay: sec.ay, holes: ownHoles, ...patch } } })
  const importCombos = (cs: LoadCombination[], sections: Record<string, { ax: number; ay: number }>) => {
    const names = new Set(cs.map((c) => c.pillar))
    const pillars = { ...project.pillars }
    for (const [n, s] of Object.entries(sections)) pillars[n] = { ...pillars[n], ...s }
    setProject({ ...project, combos: [...project.combos.filter((c) => !names.has(c.pillar)), ...cs], pillars, pillar: cs[0]?.pillar ?? project.pillar })
    setShowEb(false)
    setSel(0)
  }
  // índices globais das combinações do pilar atual
  const idx = project.combos.map((c, i) => (c.pillar === project.pillar ? i : -1)).filter((i) => i >= 0)
  const current = idx.map((i) => project.combos[i])
  const c = current[Math.min(sel, current.length - 1)]
  const ready = current.some((x) => x.state === 'ELS') && current.some((x) => x.state === 'ELU') && current.some((x) => x.fz > 0)
  const dupNames = current.filter((x, i) => current.findIndex((y) => y.name === x.name && y.state === x.state) !== i)

  const setCombos = (combos: LoadCombination[], extra: Partial<Project> = {}) => setProject({ ...project, combos, ...extra })
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const r = parseLoadsCsv(await f.text())
    setErrors(r.errors)
    if (r.combinations.length) {
      const pillars = { ...project.pillars }
      for (const [n, s] of Object.entries(r.sections ?? {})) pillars[n] = { holes: pillars[n]?.holes ?? [], ...pillars[n], ...s }
      setProject({ ...project, combos: r.combinations, pillars, pillar: r.combinations[0].pillar })
      setSel(0)
    }
  }
  const patch = (gi: number, p: Partial<LoadCombination>) => setCombos(project.combos.map((x, i) => (i === gi ? { ...x, ...p } : x)))
  const blank = (pillar: string, state: LimitState, name: string): LoadCombination => ({ pillar, name, state, fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 })
  const addCombo = (state: LimitState) => {
    const base = current.filter((x) => x.state === state)
    const last = base[base.length - 1]
    const name = `Combinação ${current.length + 1}`
    const nc: LoadCombination = last ? { ...last, name } : blank(project.pillar, state, name)
    setCombos([...project.combos, nc])
    setSel(current.length)
  }
  const removeCombo = (gi: number) => { setCombos(project.combos.filter((_, i) => i !== gi)); setSel(0) }
  const addPillar = () => {
    const name = newPillar.trim()
    if (!name || pillars.includes(name)) return
    setCombos([...project.combos, blank(name, 'ELS', 'Combinação 1 (ELS)'), blank(name, 'ELU', 'Combinação 1 (ELU)')], { pillar: name })
    setNewPillar('')
    setSel(0)
  }
  const removePillar = () => {
    if (!confirm(`Remover o pilar ${project.pillar} e todas as suas combinações?`)) return
    const rest = project.combos.filter((x) => x.pillar !== project.pillar)
    setCombos(rest, { pillar: rest[0]?.pillar ?? '' })
  }
  const renamePillar = (name: string) => {
    if (!name || (name !== project.pillar && pillars.includes(name))) return
    setCombos(project.combos.map((x) => (x.pillar === project.pillar ? { ...x, pillar: name } : x)), { pillar: name })
  }

  const actions = (
    <div className="row">
      <button className="primary" onClick={() => { setCombos([blank('P1', 'ELS', 'Combinação 1 (ELS)'), blank('P1', 'ELU', 'Combinação 1 (ELU)')], { pillar: 'P1' }); setSel(0) }} hidden={project.combos.length > 0}>＋ Lançar manualmente</button>
      <label className="btn">Importar CSV<input type="file" accept=".csv,text/csv" onChange={onFile} hidden /></label>
      <button onClick={() => setShowEb(!showEb)}>Importar do Eberick (.xlsx)</button>
      <button onClick={() => download('modelo-cargas.csv', LOADS_CSV_TEMPLATE)}>Baixar modelo do CSV</button>
    </div>
  )

  return (
    <>
      <header className="page-h">
        <h1>2 · Cargas do pilar</h1>
        <p>Informe as combinações de ações no topo do bloco: ELS (serviço) para deslocamento e capacidade, e ELU (cálculo) para dimensionar estacas e bloco. Digite os valores ou importe um arquivo.</p>
      </header>

      {project.combos.length === 0 ? (
        <section className="card empty">
          <div className="empty-ill" aria-hidden>
            <svg viewBox="0 0 120 90"><rect x="46" y="30" width="28" height="50" fill="#9aa4b2" /><line x1="60" x2="60" y1="4" y2="28" stroke="#d1495b" strokeWidth="3" /><polygon points="60,30 54,20 66,20" fill="#d1495b" /><line x1="8" x2="42" y1="38" y2="38" stroke="#1f6feb" strokeWidth="3" /><polygon points="46,38 36,32 36,44" fill="#1f6feb" /></svg>
          </div>
          <h2>Lance os pilares e suas combinações</h2>
          <p>Digite as cargas de cada pilar ou importe um CSV com <code>pilar; combinacao; tipo; fx; fy; fz; mx; my; mz</code> (kN e kN·m; Fz &gt; 0 é compressão).</p>
          {actions}
          {showEb && <EberickImport onImport={importCombos} />}
          <div className="row"><button className="primary-ghost" onClick={onExample}>✨ Carregar exemplo completo</button></div>
          {errors.length > 0 && <ul className="warn">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
        </section>
      ) : (
        <>
          <section className="card">
            {actions}
            {showEb && <EberickImport onImport={importCombos} />}
            {errors.length > 0 && <ul className="warn">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
          </section>

          <section className="card">
            <h2>Pilares</h2>
            <div className="pills" role="tablist">
              {pillars.map((p) => (
                <button key={p} role="tab" aria-selected={p === project.pillar} className={`pill ${p === project.pillar ? 'on' : ''}`} onClick={() => { setProject({ ...project, pillar: p }); setSel(0) }}>{p}</button>
              ))}
              <span className="addp">
                <input placeholder="novo pilar (ex.: P3)" value={newPillar} onChange={(e) => setNewPillar(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPillar()} aria-label="Nome do novo pilar" />
                <button onClick={addPillar} disabled={!newPillar.trim() || pillars.includes(newPillar.trim())}>＋ Adicionar pilar</button>
              </span>
            </div>
            <div className="row">
              <label className="fld"><span>Nome do pilar</span><input defaultValue={project.pillar} key={project.pillar} onBlur={(e) => renamePillar(e.target.value.trim())} /></label>
              <label className="fld"><span>Seção ax (cm)</span><input type="number" min={10} disabled={!!project.joins?.[project.pillar]} value={sec.ax} onChange={(e) => setInfo({ ax: +e.target.value })} /></label>
              <label className="fld"><span>ay (cm)</span><input type="number" min={10} disabled={!!project.joins?.[project.pillar]} value={sec.ay} onChange={(e) => setInfo({ ay: +e.target.value })} /></label>
              <button className="ghost" onClick={removePillar}>Remover este pilar</button>
            </div>
            <div className="row">
              <span className="hint">Sondagem deste pilar:</span>
              {project.library.map((h) => (
                <label key={h.id} className="inline"><input type="checkbox" checked={ownHoles.includes(h.id)} onChange={(e) => setInfo({ holes: e.target.checked ? [...ownHoles, h.id] : ownHoles.filter((x) => x !== h.id) })} /> {h.id}</label>
              ))}
              <span className="hint">{ownHoles.length === 0 ? `(nenhuma marcada: usa ${pillarHoles(project, project.pillar).join(', ') || 'as selecionadas no passo 1'})` : ''}</span>
            </div>
            <p className="hint">A seção do pilar influencia a verificação das bielas do bloco: pilares pequenos com cargas altas podem reprovar.</p>
          </section>
          <JoinPanel project={project} setProject={setProject} />

          <div className="stack">
            <section className="card">
              <h2>Combinações do pilar {project.pillar}</h2>
              <div className="scroll-x">
                <table className="selectable loads">
                  <thead>
                    <tr><th>Combinação</th><th>Tipo</th>{NUM_COLS.map((n) => <th key={n.k} title={n.hint}>{n.label}</th>)}<th /></tr>
                  </thead>
                  <tbody>
                    {current.map((x, i) => {
                      const gi = idx[i]
                      return (
                        <tr key={gi} className={i === sel ? 'sel' : ''} onClick={() => setSel(i)}>
                          <td><input value={x.name} className={dupNames.includes(x) ? 'edited' : ''} onChange={(e) => patch(gi, { name: e.target.value })} aria-label="Nome da combinação" /></td>
                          <td>
                            <select value={x.state} onChange={(e) => patch(gi, { state: e.target.value as LimitState })} aria-label="ELS ou ELU">
                              <option value="ELS">ELS</option><option value="ELU">ELU</option>
                            </select>
                          </td>
                          {NUM_COLS.map((n) => (
                            <td key={n.k}><input type="number" step="any" value={+(x[n.k] * uk).toPrecision(6)} onChange={(e) => patch(gi, { [n.k]: e.target.value === '' ? 0 : +e.target.value / uk })} aria-label={`${n.label} — ${n.hint}`} /></td>
                          ))}
                          <td><button className="small ghost" onClick={(e) => { e.stopPropagation(); removeCombo(gi) }} aria-label="Remover combinação" disabled={current.length <= 1}>×</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={() => addCombo('ELS')}>＋ Combinação ELS</button>
                <button onClick={() => addCombo('ELU')}>＋ Combinação ELU</button>
              </div>
              {dupNames.length > 0 && <p className="bad-t">Há combinações repetidas (mesmo nome e tipo).</p>}
              <p className="hint">{uF} e {uM} (o cálculo usa kN e kN·m; 1 tf = 9,80665 kN). Passe o mouse sobre o cabeçalho para ver a convenção de cada coluna. Clique numa linha para ver o esquema.</p>
            </section>
            <section className="card">
              <h2>Esquema — {c?.name}</h2>
              <LoadSketch c={c} ax={sec.ax} ay={sec.ay} uf={uk} uF={uF} uM={uM} />
              <p className="hint">Sinais: Fz &gt; 0 comprime as estacas; Mx &gt; 0 comprime mais as estacas com y menor; My &gt; 0, as com x maior.</p>
            </section>
          </div>
        </>
      )}

      <footer className="page-f">
        <button onClick={onBack}>← Sondagens</button>
        <span className={ready && dupNames.length === 0 ? 'ok-t' : 'hint'}>{ready ? (dupNames.length ? 'Corrija as combinações repetidas.' : '✓ Cargas prontas (ELS e ELU)') : project.combos.length ? 'É preciso ao menos uma combinação ELS e uma ELU, com Fz > 0 (compressão), para o pilar.' : ''}</span>
        <button className="primary" disabled={!ready || dupNames.length > 0} onClick={onNext}>Próximo: critérios →</button>
      </footer>
    </>
  )
}

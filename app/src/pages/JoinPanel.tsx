import { useState } from 'react'
import { joinPillars } from '../core/join'
import { pillarHoles, pillarNames, pillarSection, type PillarInfo, type Project } from '../ui/project'
import { num } from '../ui/fields'

const f = (x: number, d = 1) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })

/** União de dois pilares num único bloco, a partir das coordenadas globais dos centros dos pilares. */
export default function JoinPanel({ project, setProject }: { project: Project; setProject: (p: Project) => void }) {
  const names = pillarNames(project)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [c, setC] = useState({ xa: 0, ya: 0, xb: 3, yb: 0 })
  const [msgs, setMsgs] = useState<string[]>([])
  const join = project.joins?.[project.pillar]
  const A = a || names[0] || ''
  const B = b || names.find((n) => n !== A) || ''
  const secA = pillarSection(project, A)
  const secB = pillarSection(project, B)

  const doJoin = () => {
    if (!A || !B || A === B) return setMsgs(['Escolha dois pilares diferentes.'])
    const name = `${A}+${B}`
    if (names.includes(name)) return setMsgs([`Já existe o bloco ${name}.`])
    const r = joinPillars(name, { name: A, x: c.xa, y: c.ya, ...secA }, { name: B, x: c.xb, y: c.yb, ...secB }, project.combos)
    if (r.combos.length === 0) return setMsgs(r.warnings)
    const pillars: Record<string, PillarInfo> = { ...project.pillars }
    const originalInfo = { [A]: pillars[A], [B]: pillars[B] }
    delete pillars[A]
    delete pillars[B]
    pillars[name] = { ax: r.ax, ay: r.ay, areaCm2: r.areaCm2, holes: pillarHoles(project, A) }
    setProject({
      ...project,
      combos: [...project.combos.filter((q) => q.pillar !== A && q.pillar !== B), ...r.combos],
      pillars,
      pillar: name,
      joins: {
        ...project.joins,
        [name]: { a: { name: A, x: c.xa, y: c.ya, ...secA }, b: { name: B, x: c.xb, y: c.yb, ...secB }, originals: project.combos.filter((q) => q.pillar === A || q.pillar === B), originalInfo, origin: r.origin },
      },
    })
    setMsgs([`Bloco ${name} criado: caixa ${f(r.ax, 0)} × ${f(r.ay, 0)} cm, área dos pilares ${f(r.areaCm2, 0)} cm², ${r.combos.length} combinações. Origem do bloco (centro da caixa) em X = ${f(r.origin.x, 2)} m, Y = ${f(r.origin.y, 2)} m.`, ...r.warnings])
  }

  const undo = () => {
    if (!join) return
    const name = project.pillar
    const pillars: Record<string, PillarInfo> = { ...project.pillars }
    delete pillars[name]
    for (const k of [join.a.name, join.b.name]) if (join.originalInfo[k]) pillars[k] = join.originalInfo[k]!
    const joins = { ...project.joins }
    delete joins[name]
    setProject({ ...project, combos: [...project.combos.filter((q) => q.pillar !== name), ...join.originals], pillars, joins, pillar: join.a.name })
    setMsgs([])
  }

  return (
    <section className="card">
      <h2>Bloco comum a dois pilares</h2>
      {join ? (
        <>
          <p>
            Este bloco recebe <b>{join.a.name}</b> (X = {f(join.a.x, 2)}, Y = {f(join.a.y, 2)} m; {join.a.ax} × {join.a.ay} cm) e <b>{join.b.name}</b> (X = {f(join.b.x, 2)}, Y = {f(join.b.y, 2)} m; {join.b.ax} × {join.b.ay} cm).
            As cargas foram somadas no centro da caixa envolvente (X = {f(join.origin.x, 2)}, Y = {f(join.origin.y, 2)} m), com os momentos das excentricidades.
          </p>
          <div className="row"><button onClick={undo}>↺ Desfazer a união</button></div>
        </>
      ) : (
        <>
          <p className="hint">Informe as coordenadas globais (X, Y, em metros) do centro de cada pilar, no mesmo sistema da planta de locação. As combinações de mesmo nome e tipo (ELS/ELU) são somadas no centro da caixa envolvente dos dois pilares, com os momentos das excentricidades; o bloco é dimensionado como um pilar equivalente (caixa envolvente para a geometria, área total para as tensões nas bielas). Edite antes a seção de cada pilar.</p>
          <div className="row">
            <label className="fld"><span>Pilar 1</span><select value={A} onChange={(e) => setA(e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select></label>
            <label className="fld"><span>X (m)</span><input type="number" step={0.01} value={c.xa} onChange={(e) => setC({ ...c, xa: num(e.target.value, 0) })} /></label>
            <label className="fld"><span>Y (m)</span><input type="number" step={0.01} value={c.ya} onChange={(e) => setC({ ...c, ya: num(e.target.value, 0) })} /></label>
            <span className="hint">{secA.ax} × {secA.ay} cm</span>
          </div>
          <div className="row">
            <label className="fld"><span>Pilar 2</span><select value={B} onChange={(e) => setB(e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select></label>
            <label className="fld"><span>X (m)</span><input type="number" step={0.01} value={c.xb} onChange={(e) => setC({ ...c, xb: num(e.target.value, 0) })} /></label>
            <label className="fld"><span>Y (m)</span><input type="number" step={0.01} value={c.yb} onChange={(e) => setC({ ...c, yb: num(e.target.value, 0) })} /></label>
            <span className="hint">{secB.ax} × {secB.ay} cm</span>
          </div>
          <div className="row"><button className="primary" disabled={names.length < 2} onClick={doJoin}>Unir {A && B ? `${A} + ${B}` : 'os pilares'}</button></div>
        </>
      )}
      {msgs.length > 0 && <ul className="warn">{msgs.map((m) => <li key={m}>{m}</li>)}</ul>}
    </section>
  )
}

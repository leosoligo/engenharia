import { useMemo, useState } from 'react'
import { PILE_LABEL, PILE_TYPES, type PileType } from '../core/pile'
import { SOIL_LABEL, type SptBorehole } from '../core/soil'
import { admissibleLoad, aokiVelloso, decourtQuaresma, teixeira, type CapacityMethod } from '../core/capacity'
import LateralPanel from '../LateralPanel'
import HandlingPanel from './HandlingPanel'
import ParamsEditor from '../ParamsEditor'
import { lateralOptions, type Settings } from '../settings'
import { KN, type Units } from '../ui/units'
import { download } from './SoilPage'

const METHODS: { id: CapacityMethod; label: string; color: string; run: typeof aokiVelloso }[] = [
  { id: 'aoki-velloso', label: 'Aoki-Velloso', color: '#1f6feb', run: aokiVelloso },
  { id: 'decourt-quaresma', label: 'Décourt-Quaresma', color: '#d1495b', run: decourtQuaresma },
  { id: 'teixeira', label: 'Teixeira', color: '#2a9d8f', run: teixeira },
]

const fmt = (x: number, d = 0) => x.toLocaleString('pt-BR', { maximumFractionDigits: d })

function CapacityChart({ series, depths, unit, skip }: { series: { label: string; color: string; v: number[] }[]; depths: number; unit: string; skip: number }) {
  const W = 900, H = 520, pad = { l: 64, r: 24, t: 44, b: 84 }
  const vmax = Math.max(1, ...series.flatMap((s) => s.v))
  const x = (v: number) => pad.l + (v / vmax) * (W - pad.l - pad.r)
  const y = (z: number) => pad.t + (z / depths) * (H - pad.t - pad.b)
  const step = depths > 30 ? 5 : depths > 12 ? 2 : 1
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz xl" role="img" aria-label="Carga admissível por profundidade da ponta">
      <text x={pad.l} y={22} className="t-hh">Carga admissível × profundidade da ponta</text>
      <text x={W - pad.r} y={22} textAnchor="end" className="t-s">carga em {unit}</text>
      {skip > 0 && skip < depths && <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={y(skip) - pad.t} fill="var(--muted)" opacity={0.12} />}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}><line x1={x(vmax * f)} x2={x(vmax * f)} y1={pad.t} y2={H - pad.b} className="grid" /><text x={x(vmax * f)} y={H - pad.b + 18} textAnchor="middle" className="t-s">{fmt(vmax * f, vmax < 100 ? 1 : 0)}</text></g>
      ))}
      {Array.from({ length: Math.floor(depths / step) + 1 }, (_, k) => k * step).map((z) => (
        <g key={z}><line x1={pad.l} x2={W - pad.r} y1={y(z)} y2={y(z)} className="grid" /><text x={pad.l - 10} y={y(z) + 4} textAnchor="end" className="t-s">{z} m</text></g>
      ))}
      {skip > 0 && skip < depths && <text x={W - pad.r - 6} y={y(skip) - 6} textAnchor="end" className="t-s">acima da base do bloco ({skip} m): sem atrito</text>}
      {series.map((s) => <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={2.4} points={s.v.map((v, i) => `${x(v)},${y(i + 1)}`).join(' ')} />)}
      <text x={(pad.l + W - pad.r) / 2} y={H - pad.b + 42} textAnchor="middle" className="t-s">carga admissível ({unit}) — eixo vertical: profundidade da ponta da estaca</text>
      {series.map((s, i) => <g key={s.label}><rect x={pad.l + i * 190} y={H - 24} width={18} height={5} fill={s.color} /><text x={pad.l + 26 + i * 190} y={H - 18} className="t-s">{s.label}</text></g>)}
    </svg>
  )
}

function CapacityPanel({ holes, settings, setSettings, u }: { holes: SptBorehole[]; settings: Settings; setSettings: (s: Settings) => void; u: Units }) {
  const [type, setType] = useState<PileType>('escavada')
  const [dcm, setDcm] = useState(40)
  const [skipM, setSkipM] = useState<number>(settings.topDepth)
  const [target, setTarget] = useState(0) // carga por estaca a atender (na unidade exibida); 0 = sem alvo
  const maxDepth = holes.length ? Math.min(...holes.map((h) => h.layers.length)) : 0
  const table = useMemo(() => {
    if (!holes.length) return undefined
    const perHole = holes.map((h) => METHODS.map((m) => m.run(h, { pile: { type, diameter: dcm / 100 }, params: settings.capParams, tipFactor: settings.tipUsePct / 100, shaftFactor: settings.shaftUsePct / 100 })))
    try {
      // atrito acima da base do bloco não conta (como no otimizador): desconta Rl no nível da base
      const rlAt = (rows: { Rl: number }[], z: number) => {
        if (z <= 0) return 0
        const i = Math.min(Math.floor(z), rows.length)
        const a0 = i >= 1 ? rows[i - 1].Rl : 0
        const b0 = i < rows.length ? rows[i].Rl : a0
        return a0 + (z - i) * (b0 - a0)
      }
      const rows = METHODS.map((_, k) => Array.from({ length: maxDepth }, (_, i) => {
        const per = perHole.map((p) => { const rr = p[k].rows; const rl = Math.max(rr[i].Rl - rlAt(rr, skipM), 0); return { Rl: rl, Rp: rr[i].Rp, R: rl + rr[i].Rp } })
        const mean = (f: (x: { Rl: number; Rp: number; R: number }) => number) => per.reduce((a, x) => a + f(x), 0) / per.length
        return {
          Rl: mean((x) => x.Rl) * u.k, Rp: mean((x) => x.Rp) * u.k, R: mean((x) => x.R) * u.k,
          P: admissibleLoad(per.map((x) => x.R), { mode: settings.safetyMode, fsGlobal: settings.fsGlobal }).Padm * u.k,
        }
      }))
      const used = METHODS.map((m) => settings.methods[m.id])
      const adopted = Array.from({ length: maxDepth }, (_, i) => {
        const ps = rows.filter((_, k) => used[k]).map((r) => r[i].P)
        if (!ps.length) return NaN
        return settings.capacityCombine === 'media' ? ps.reduce((a, b) => a + b, 0) / ps.length : Math.min(...ps)
      })
      return { rows, adopted, warnings: [...new Set(perHole.flatMap((p) => p.flatMap((r) => r.warnings)))], error: '' }
    } catch (e) {
      return { rows: [], adopted: [], warnings: [], error: (e as Error).message }
    }
  }, [holes, maxDepth, type, dcm, skipM, settings.capParams, settings.safetyMode, settings.fsGlobal, settings.tipUsePct, settings.shaftUsePct, settings.methods, settings.capacityCombine, u.k])

  const adoptedMax = table && !table.error ? Math.max(1, ...table.adopted.filter(Number.isFinite)) : 1
  const firstOk = table && !table.error && target > 0 ? table.adopted.findIndex((v, i) => i + 1 > skipM && v >= target) : -1

  const csv = () => {
    if (!table || table.error) return
    const d = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',')
    const head = ['Ponta (m)', 'Comprimento (m)', 'Solo', ...METHODS.flatMap((m) => [`${m.label} Rl`, `${m.label} Rp`, `${m.label} R`, `${m.label} Padm`]), 'Adotada']
    const lines = [head.join(';'), ...Array.from({ length: maxDepth }, (_, i) => [i + 1, Math.max(i + 1 - skipM, 0), SOIL_LABEL[holes[0].layers[i].soil], ...table.rows.flatMap((r) => [r[i].Rl, r[i].Rp, r[i].R, r[i].P].map(d)), d(table.adopted[i])].join(';'))]
    const nl = String.fromCharCode(13, 10)
    download(`capacidade-${type}-${dcm}cm.csv`, String.fromCharCode(0xfeff) + lines.join(nl) + nl)
  }

  if (!holes.length) return <section className="card empty"><h2>Selecione uma sondagem no passo 1</h2></section>
  return (
    <>
      <section className="card">
        <h2>Estaca e critério</h2>
        <div className="fgrid">
          <label className="fld"><span>Tipo de estaca</span>
            <select value={type} onChange={(e) => setType(e.target.value as PileType)}>{PILE_TYPES.map((t) => <option key={t} value={t}>{PILE_LABEL[t]}</option>)}</select>
          </label>
          <label className="fld"><span>Diâmetro (cm)</span><input type="number" min={10} value={dcm} onChange={(e) => setDcm(+e.target.value)} /></label>
        </div>
        <p className="hint">Critério de carga admissível e coeficientes dos métodos: veja “3 · Critérios” (avançado) e a seção abaixo. Furos usados: {holes.map((h) => h.id).join(', ')}.</p>
      </section>
      {table && !table.error && (
        <div>
          <section className="card">
            <CapacityChart skip={skipM} unit={u.F} depths={maxDepth} series={METHODS.map((m, k) => ({ label: m.label, color: m.color, v: table.rows[k].map((r) => r.P) }))} />
          </section>
          <section className="card scroll">
            <h3>Capacidade de carga por método ({u.F})</h3>
            <p className="hint">R<sub>l</sub> = resistência lateral acumulada (a partir da base do bloco), R<sub>p</sub> = resistência de ponta, R = R<sub>l</sub> + R<sub>p</sub> (carga geotécnica de ruptura) e P<sub>adm</sub> = carga admissível pelo critério escolhido ({settings.safetyMode === 'nbr-admissivel' ? 'NBR 6122:2022 (ξ, Rk/1,4)' : `conservador (menor entre ξ da NBR e FS global ${settings.fsGlobal})`}); com mais de um furo, valores médios e ξ sobre o conjunto. Coluna "Adotada": {settings.capacityCombine === 'media' ? 'média' : 'menor'} entre os métodos marcados em Parâmetros; ponta a {settings.tipUsePct} % e lateral a {settings.shaftUsePct} %.</p>
            <div className="row">
              <label className="fld"><span>Base do bloco (m): atrito acima dela não conta</span><input type="number" min={0} step={0.5} value={skipM} onChange={(e) => setSkipM(Math.max(0, +e.target.value))} /></label>
              <label className="fld"><span>Carga por estaca a atender ({u.F}), opcional</span><input type="number" min={0} value={target || ''} placeholder="ex.: 250" onChange={(e) => setTarget(Math.max(0, +e.target.value || 0))} /></label>
              <button onClick={csv}>⬇ Exportar tabela (CSV)</button>
            </div>
            <p className="hint">Leitura da tabela: se a ponta da estaca ficar na profundidade da primeira coluna, a carga admissível total da estaca é a da coluna "Adotada" (a barra mostra a proporção da maior carga). O comprimento da estaca é a ponta menos a base do bloco. Cuidado com picos isolados de N_SPT (a carga cai logo abaixo): prefira pontas em camadas de resistência contínua.</p>
            {target > 0 && (
              <p className={firstOk >= 0 ? 'ok-msg' : 'warn'}>{firstOk >= 0 ? <>Menor comprimento que atende {fmt(target, u.k === 1 ? 0 : 1)} {u.F}: ponta a <b>{firstOk + 1} m</b> (estaca de <b>{firstOk + 1 - skipM} m</b>), P<sub>adm</sub> = {fmt(table.adopted[firstOk], u.k === 1 ? 0 : 1)} {u.F}.</> : <>Nenhuma profundidade da sondagem atinge {fmt(target, u.k === 1 ? 0 : 1)} {u.F} com este critério.</>}</p>
            )}
            <table className="cap-t">
              <thead>
                <tr><th rowSpan={2}>Ponta (m)</th><th rowSpan={2}>Compr. da estaca (m)</th><th rowSpan={2}>Solo</th>{METHODS.map((m) => <th key={m.id} colSpan={4} style={{ borderLeft: '2px solid var(--line)' }}>{m.label}{settings.methods[m.id] ? '' : ' (desmarcado)'}</th>)}<th rowSpan={2} style={{ borderLeft: '2px solid var(--line)' }}>Adotada<br /><small>P<sub>adm</sub></small></th></tr>
                <tr>{METHODS.map((m) => ['Rl', 'Rp', 'R', 'Padm'].map((h, q) => <th key={m.id + h} style={q === 0 ? { borderLeft: '2px solid var(--line)' } : undefined}>{h === 'Padm' ? <>P<sub>adm</sub></> : h === 'Rl' ? <>R<sub>l</sub></> : h === 'Rp' ? <>R<sub>p</sub></> : h}</th>))}</tr>
              </thead>
              <tbody>
                {Array.from({ length: maxDepth }, (_, i) => (
                  <tr key={i} className={`${i + 1 <= skipM ? 'dim' : ''} ${target > 0 && i > firstOk && firstOk >= 0 ? 'okrow' : ''} ${i === firstOk ? 'firstok' : ''}`}>
                    <td>{i + 1}</td><td>{i + 1 > skipM ? i + 1 - skipM : '—'}</td><td className="wrap">{SOIL_LABEL[holes[0].layers[i].soil]}</td>
                    {table.rows.map((r, k) => [r[i].Rl, r[i].Rp, r[i].R, r[i].P].map((v, q) => <td key={k + '-' + q} style={q === 0 ? { borderLeft: '2px solid var(--line)' } : undefined}>{q === 3 ? <b>{fmt(v, u.k === 1 ? 0 : 1)}</b> : fmt(v, u.k === 1 ? 0 : 1)}</td>))}
                    <td className="adopt" style={{ borderLeft: '2px solid var(--line)' }}><span className="bar" style={{ width: `${Math.max(0, (table.adopted[i] / adoptedMax) * 100)}%` }} /><b>{fmt(table.adopted[i], u.k === 1 ? 0 : 1)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
      {table?.error && <p className="warn">{table.error}</p>}
      {table && table.warnings.length > 0 && <ul className="warn">{table.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <ParamsEditor params={settings.capParams} onChange={(p) => setSettings({ ...settings, capParams: p })} type={type} diameter={dcm / 100} />
    </>
  )
}

export default function AdvancedPage({ holes, settings, setSettings, u = KN }: { holes: SptBorehole[]; settings: Settings; setSettings: (s: Settings) => void; u?: Units }) {
  const [tab, setTab] = useState<'cap' | 'lat' | 'man'>('cap')
  const [latD, setLatD] = useState(40)
  const hid = holes[0]?.id
  const latOptions = useMemo(() => lateralOptions(settings, hid), [settings, hid])
  return (
    <>
      <header className="page-h">
        <h1>Análises avançadas</h1>
        <p>Ferramentas para investigar partes do cálculo isoladamente (não são necessárias para o fluxo principal).</p>
      </header>
      <div className="tabs2" role="tablist">
        <button className={tab === 'cap' ? 'on' : ''} onClick={() => setTab('cap')}>Capacidade de carga (SPT)</button>
        <button className={tab === 'lat' ? 'on' : ''} onClick={() => setTab('lat')}>Estaca isolada sob carga lateral</button>
        <button className={tab === 'man' ? 'on' : ''} onClick={() => setTab('man')}>Manuseio de pré-moldadas</button>
      </div>
      {tab === 'man' ? <HandlingPanel u={u} /> : tab === 'cap' ? <CapacityPanel holes={holes} settings={settings} setSettings={setSettings} u={u} /> : (
        <>
          <section className="card"><div className="row"><label className="fld"><span>Diâmetro da estaca (cm)</span><input type="number" min={10} value={latD} onChange={(e) => setLatD(+e.target.value)} /></label><p className="hint">Usa o primeiro furo selecionado no passo 1.</p></div></section>
          <LateralPanel borehole={holes[0]} diameterCm={latD} options={latOptions} u={u} />
        </>
      )}
    </>
  )
}

import { useMemo, useState } from 'react'
import {
  analyzeLateral,
  buildLateralProfile,
  MissingWaterLevelError,
  type Loading,
  type ProfileOptions,
  type Restraint,
} from './core/lateral'
import type { SptBorehole } from './core/soil'
import { KN, type Units } from './ui/units'

type RKind = 'free' | 'fixed' | 'spring'

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: d }) : '∞')

/** Gráfico de perfil: profundidade para baixo, valor na horizontal. A escala acompanha também a curva de referência (se houver). */
function Profile({ zs, vs, title, unit, color, ref }: { zs: number[]; vs: number[]; title: string; unit: string; color: string; ref?: { zs: number[]; vs: number[] } }) {
  const W = 300, H = 380, pad = { l: 46, r: 14, t: 52, b: 30 }
  const all = [...vs, ...(ref?.vs ?? [])].filter(Number.isFinite)
  const vmin = Math.min(0, ...all), vmax = Math.max(0, ...all)
  const span = vmax - vmin || 1
  const zmin = Math.min(0, zs[0]), zmax = Math.max(zs[zs.length - 1], ref?.zs[ref.zs.length - 1] ?? 0)
  const x = (v: number) => pad.l + ((v - vmin) / span) * (W - pad.l - pad.r)
  const y = (z: number) => pad.t + ((z - zmin) / (zmax - zmin || 1)) * (H - pad.t - pad.b)
  const path = (z: number[], v: number[]) => z.map((zz, i) => `${i ? 'L' : 'M'}${x(v[i]).toFixed(1)},${y(zz).toFixed(1)}`).join(' ')
  const kmax = vs.reduce((k, v, i) => (Math.abs(v) > Math.abs(vs[k]) ? i : k), 0)
  const d1 = (v: number) => fmt(v, Math.abs(v) < 10 ? 3 : Math.abs(v) < 100 ? 2 : 1)
  const zt = [0, 0.25, 0.5, 0.75, 1].map((f) => zmin + f * (zmax - zmin))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={title}>
      <text x={8} y={18} className="t-hh">{title} ({unit})</text>
      <text x={8} y={36} className="t-s">máx. {d1(vs[kmax])} a {fmt(zs[kmax], 1)} m</text>
      {zt.map((z) => <g key={z}><line x1={pad.l} x2={W - pad.r} y1={y(z)} y2={y(z)} className="grid" /><text x={pad.l - 6} y={y(z) + 4} textAnchor="end" className="t-s">{fmt(z, 1)}</text></g>)}
      <line x1={x(0)} x2={x(0)} y1={pad.t} y2={H - pad.b} className="axis" />
      {ref && <path d={path(ref.zs, ref.vs)} fill="none" stroke="var(--muted)" strokeWidth={1.8} strokeDasharray="6 4" />}
      <path d={path(zs, vs)} fill="none" stroke={color} strokeWidth={2.4} />
      <circle cx={x(vs[kmax])} cy={y(zs[kmax])} r={4} fill={color} />
      <text x={pad.l} y={H - 8} className="t-s">{d1(vmin)}</text>
      <text x={W - pad.r} y={H - 8} textAnchor="end" className="t-s">{d1(vmax)}</text>
      <text x={8} y={H / 2} className="t-s" transform={`rotate(-90 8 ${H / 2})`} textAnchor="middle">profundidade (m)</text>
    </svg>
  )
}

function RestraintInput(props: { label: string; unit: string; kind: RKind; value: number; onKind: (k: RKind) => void; onValue: (v: number) => void }) {
  return (
    <div className="row">
      <label>{props.label}
        <select value={props.kind} onChange={(e) => props.onKind(e.target.value as RKind)}>
          <option value="free">Livre</option>
          <option value="fixed">Impedida</option>
          <option value="spring">Mola elástica</option>
        </select>
      </label>
      {props.kind === 'spring' && (
        <label>Rigidez ({props.unit})
          <input type="number" min={0} value={props.value} onChange={(e) => props.onValue(+e.target.value)} />
        </label>
      )}
    </div>
  )
}

export default function LateralPanel({ borehole, diameterCm, options, u = KN }: { borehole: SptBorehole | undefined; diameterCm: number; options: ProfileOptions; u?: Units }) {
  const [length, setLength] = useState(12)
  const [topDepth, setTopDepth] = useState(0)
  const [H, setH] = useState(50)
  const [M, setM] = useState(0)
  const [N, setN] = useState(500)
  const [fck, setFck] = useState(30)
  const [eiFactor, setEiFactor] = useState(0.8)
  const [loading, setLoading] = useState<Loading>('static')
  const [tKind, setTKind] = useState<RKind>('free')
  const [tVal, setTVal] = useState(100000)
  const [rKind, setRKind] = useState<RKind>('fixed')
  const [rVal, setRVal] = useState(100000)
  const [ref, setRef] = useState<{ label: string; z: number[]; y: number[]; M: number[]; V: number[]; p: number[] } | undefined>()

  const B = diameterCm / 100
  const Ecs = useMemo(() => {
    const eci = 1.0 * 5600 * Math.sqrt(fck) // MPa, αE = 1,0 (granito/gnaisse) — NBR 6118:2026, 8.2.8
    const ai = Math.min(0.8 + 0.2 * (fck / 80), 1)
    return ai * eci * 1000 // kPa
  }, [fck])
  const EI = eiFactor * Ecs * (Math.PI * B ** 4) / 64

  const { profile, profileError } = useMemo(() => {
    if (!borehole) return { profile: undefined, profileError: '' }
    try {
      return { profile: buildLateralProfile(borehole, options), profileError: '' }
    } catch (e) {
      if (e instanceof MissingWaterLevelError) return { profile: undefined, profileError: e.message }
      throw e
    }
  }, [borehole, options])
  const toR = (k: RKind, v: number): Restraint => (k === 'spring' ? { spring: v } : k)

  const result = useMemo(() => {
    if (!profile) return undefined
    return analyzeLateral({
      profile, B, EI, length, topDepth, H, M, N, loading,
      head: { translation: toR(tKind, tVal), rotation: toR(rKind, rVal) },
    })
  }, [profile, B, EI, length, topDepth, H, M, N, loading, tKind, tVal, rKind, rVal])

  if (profileError)
    return <section className="card"><p className="warn">{profileError} Preencha a coluna "NA (m)" na tabela de sondagens acima.</p></section>
  if (!borehole || !profile || !result) return <section className="card"><p>Selecione uma sondagem na tabela acima.</p></section>

  const mm = (v: number) => fmt(v * 1000, 2)

  return (
    <>
      <section className="grid">
        <div className="card">
          <h2>Estaca e cargas no topo</h2>
          <div className="row">
            <label>Comprimento total (m)<input type="number" min={1} value={length} onChange={(e) => setLength(+e.target.value)} /></label>
            <label>Topo abaixo do terreno (m)<input type="number" step={0.1} value={topDepth} onChange={(e) => setTopDepth(+e.target.value)} /></label>
            <label>fck (MPa)<input type="number" min={20} value={fck} onChange={(e) => setFck(+e.target.value)} /></label>
            <label>Fator de rigidez EI<input type="number" step={0.05} min={0.1} max={1} value={eiFactor} onChange={(e) => setEiFactor(+e.target.value)} /></label>
          </div>
          <p className="hint">
            Topo com valor negativo = estaca acima do terreno (trecho livre). EI = fator × E<sub>cs</sub> × I (seção bruta, D = {diameterCm} cm):
            <b> {fmt(EI, 0)} kN·m²</b>. O fator 0,8 é o de pilares da NBR 6118:2026 (15.7.3), usado aqui como aproximação da fissuração — decisão do projetista.
          </p>
          <div className="row">
            <label>H ({u.F})<input type="number" value={+(H * u.k).toPrecision(6)} onChange={(e) => setH(+e.target.value / u.k)} /></label>
            <label>M ({u.M})<input type="number" value={+(M * u.k).toPrecision(6)} onChange={(e) => setM(+e.target.value / u.k)} /></label>
            <label>N compressão ({u.F})<input type="number" min={0} value={+(N * u.k).toPrecision(6)} onChange={(e) => setN(+e.target.value / u.k)} /></label>
          </div>
          <p className="hint">M positivo acompanha H positivo (M = H·e). N constante ao longo da estaca (conservador).</p>
        </div>

        <div className="card">
          <h2>Condição de apoio do topo</h2>
          <RestraintInput label="Deslocamento horizontal" unit="kN/m" kind={tKind} value={tVal} onKind={setTKind} onValue={setTVal} />
          <RestraintInput label="Rotação" unit="kN·m/rad" kind={rKind} value={rVal} onKind={setRKind} onValue={setRVal} />
          <label>Carregamento
            <select value={loading} onChange={(e) => setLoading(e.target.value as Loading)}>
              <option value="static">Estático</option>
              <option value="cyclic">Cíclico</option>
            </select>
          </label>
          <p className="hint">
            "Rotação impedida" = engaste no bloco rígido; "livre" = articulada. Topo livre em solo fraco pode flambar —
            veja o coeficiente λ nos resultados.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Resultados — {borehole.id}</h2>
        <div className="kpis">
          <div><span>Deslocamento no topo</span><b>{mm(result.headDisplacement)} mm</b></div>
          <div><span>Rotação no topo</span><b>{fmt(result.headRotation * 1000, 3)} mrad</b></div>
          <div><span>Momento máx.</span><b>{fmt(result.maxMoment.value * u.k)} {u.M}</b><small>a {fmt(result.maxMoment.z, 2)} m</small></div>
          <div><span>Cortante máx.</span><b>{fmt(result.maxShear.value * u.k)} {u.F}</b><small>a {fmt(result.maxShear.z, 2)} m</small></div>
          <div className={result.bucklingFactor < 3 ? 'bad' : ''}>
            <span>Flambagem P<sub>cr</sub> / λ</span>
            <b>{fmt(result.criticalLoad * u.k, 1)} {u.F} / {fmt(result.bucklingFactor, 1)}</b>
            <small>L<sub>e</sub> = {fmt(result.bucklingLength, 1)} m (≈ {fmt(result.bucklingLength / (result.z[result.z.length - 1] - result.z[0]) , 2)} L)</small>
          </div>
        </div>
        {!result.converged && !result.unstable && <p className="warn">Sem convergência.</p>}
        {[...profile.warnings, ...result.warnings].length > 0 && (
          <ul className="warn">{[...new Set([...result.warnings, ...profile.warnings])].map((w) => <li key={w}>{w}</li>)}</ul>
        )}
        {!result.unstable && (
          <>
            <div className="row">
              <button onClick={() => setRef({ label: `H = ${fmt(H * u.k, 1)} ${u.F}, M = ${fmt(M * u.k, 1)} ${u.M}, N = ${fmt(N * u.k, 0)} ${u.F}`, z: result.z, y: result.y.map((v) => v * 1000), M: result.M, V: result.V, p: result.p })}>📌 Fixar este resultado como referência</button>
              {ref && <button onClick={() => setRef(undefined)}>Limpar referência</button>}
              {ref && <span className="hint">Tracejado: {ref.label}. As escalas passam a ser comuns para comparar.</span>}
            </div>
            {M !== 0 && rKind === 'fixed' && <p className="hint">Com a rotação do topo <b>impedida</b>, o momento M aplicado é absorvido pelo engaste e não altera a estaca; use rotação livre ou mola para ver o efeito do momento. O esforço normal N influencia pouco (efeito P-Δ).</p>}
            <div className="charts lat-charts">
              <Profile zs={result.z} vs={result.y.map((v) => v * 1000)} title="Deslocamento" unit="mm" color="#1f6feb" ref={ref ? { zs: ref.z, vs: ref.y } : undefined} />
              <Profile zs={result.z} vs={result.M.map((q) => q * u.k)} title="Momento" unit={u.M} color="#d1495b" ref={ref ? { zs: ref.z, vs: ref.M.map((q) => q * u.k) } : undefined} />
              <Profile zs={result.z} vs={result.V.map((q) => q * u.k)} title="Cortante" unit={u.F} color="#2a9d8f" ref={ref ? { zs: ref.z, vs: ref.V.map((q) => q * u.k) } : undefined} />
              <Profile zs={result.z} vs={result.p.map((q) => q * u.k)} title="Reação do solo p" unit={`${u.F}/m`} color="#9a6700" ref={ref ? { zs: ref.z, vs: ref.p.map((q) => q * u.k) } : undefined} />
            </div>
          </>
        )}
        <p className="hint">Iterações p-y: {result.iterations}. Pcr usa a rigidez secante do solo no estado calculado, de modo que camadas moles na superfície (onde a reação do solo é pequena) reduzem Pcr e aumentam L<sub>e</sub> = π√(EI/Pcr), o comprimento de flambagem equivalente (haste biarticulada de mesma carga crítica). A norma exige verificar os efeitos de 2ª ordem em estacas imersas em solos muito moles (NBR 6122:2022, 8.6.1); aqui eles já entram no P-Δ da análise.</p>
      </section>

      <section className="card"><p className="hint">Os parâmetros do solo (φ', Su, γ', nh e modelo p-y por camada) são editados na etapa <b>Parâmetros</b> e valem aqui e na otimização.</p></section>
    </>
  )
}

import { PILE_LABEL } from '../core/pile'
import type { Settings } from '../settings'
import { inputKey, type CachedResult, type Job } from '../ui/buildInput'
import { TF, pillarHoles, pillarNames, pillarSection, type Project } from '../ui/project'
import { download } from './SoilPage'

const nf = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—')
const brl = (x: number) => x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

interface Props {
  project: Project
  settings: Settings
  cache: Record<string, CachedResult>
  job?: Job
  errors: Record<string, string>
  onRun: (list: string[]) => void
  onCancel: () => void
  onOpen: (pillar: string) => void
}

export default function BatchPage({ project, settings, cache, job, errors, onRun, onCancel, onOpen }: Props) {
  const names = pillarNames(project)
  const busy = !!job
  const batch = job?.kind === 'lote'
  const current = batch ? job.label : ''
  const progress = job?.detail
  const done = job?.done ?? 0

  const state = (p: string): 'ok' | 'stale' | 'none' => {
    const c = cache[p]
    return !c ? 'none' : c.key === inputKey(project, settings, p) ? 'ok' : 'stale'
  }
  const pending = names.filter((p) => state(p) !== 'ok')
  const unitTf = project.units === 'tf'

  const rows = names.map((p) => {
    const c = cache[p]
    const best = c?.result.best[0]
    const els = project.combos.filter((q) => q.pillar === p && q.state === 'ELS')
    const sec = pillarSection(project, p)
    return { p, best, state: state(p), nmax: Math.max(0, ...els.map((q) => q.fz)), sec, holes: pillarHoles(project, p), nPiles: best?.layout.n ?? 0, err: errors[p] }
  })
  const total = rows.reduce((a, r) => a + (r.best?.cost.total ?? 0), 0)
  const totalPiles = rows.reduce((a, r) => a + r.nPiles, 0)
  const totalLen = rows.reduce((a, r) => a + (r.best ? r.best.length * r.nPiles : 0), 0)
  const exportCsv = () => {
    const head = 'pilar;secao_cm;sondagem;N_els_kN;tipo;diametro_cm;n_estacas;comprimento_m;bloco_cm;custo_R$'
    const lines = rows.map((r) => [r.p, `${r.sec.ax}x${r.sec.ay}`, r.holes.join('+'), nf(r.nmax, 0), r.best ? PILE_LABEL[r.best.type] : '', r.best ? nf(r.best.diameter * 100, 0) : '', r.nPiles || '', r.best ? nf(r.best.length, 0) : '', r.best ? `${nf(r.best.blockDesign.geometry.lx * 100)}x${nf(r.best.blockDesign.geometry.ly * 100)}x${nf(r.best.blockDesign.geometry.h * 100)}` : '', r.best ? nf(r.best.cost.total, 0) : ''].join(';'))
    download('resumo-fundacoes.csv', '﻿' + [head, ...lines].join('\n'))
  }

  return (
    <>
      <header className="page-h">
        <h1>Todos os pilares</h1>
        <p>Calcula a solução mais econômica de cada pilar do projeto, uma após a outra, com os mesmos critérios. Clique em “Abrir” para ver o detalhe, editar a armadura, o bloco e a locação de qualquer pilar. O resultado de cada pilar fica guardado.</p>
      </header>

      <section className="card run">
        <div className="row">
          <button className="primary big" disabled={busy || names.length === 0} onClick={() => onRun(pending.length ? pending : names)}>
            {busy ? (batch ? `Calculando ${current}…` : `Calculando o pilar ${job?.label}…`) : pending.length === 0 ? '▶ Recalcular todos' : pending.length === names.length ? `▶ Calcular os ${names.length} pilares` : `▶ Calcular os ${pending.length} pendentes`}
          </button>
          {busy && <button onClick={onCancel}>Cancelar</button>}
          <button onClick={exportCsv} disabled={!rows.some((r) => r.best)}>⬇ Resumo (CSV)</button>
        </div>
        {busy && batch && (
          <div className="progress"><progress max={Math.max(job?.total ?? 1, 1)} value={done} /><span>pilar {Math.min(done + 1, job?.total ?? 1)} de {job?.total} · {current}{progress ? ` · ${progress.done}/${progress.total} candidatos` : ''}</span></div>
        )}
        {busy && !batch && <p className="hint">Há um cálculo em andamento (pilar {job?.label}); acompanhe pela barra de progresso.</p>}
        {names.length === 0 && <p className="hint">Nenhum pilar cadastrado: importe as cargas (CSV ou Eberick) ou lance manualmente no passo 2.</p>}
        <p className="hint">Cada pilar leva de alguns segundos a cerca de um minuto, conforme o número de combinações e de tipos de estaca considerados. Dica: reduza as combinações às críticas na importação e mantenha poucos diâmetros para acelerar.</p>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <div className="scroll-x">
            <table className="batch">
              <thead><tr><th>Pilar</th><th>Seção (cm)</th><th>Sondagem</th><th>N ELS máx. ({unitTf ? 'tf' : 'kN'})</th><th>Solução mais econômica</th><th>Bloco (cm)</th><th>Custo</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p} className={r.err ? 'bad' : ''}>
                    <td><b>{r.p}</b></td>
                    <td>{r.sec.ax} × {r.sec.ay}</td>
                    <td>{r.holes.join(', ') || '—'}</td>
                    <td>{nf(unitTf ? r.nmax / TF : r.nmax, unitTf ? 1 : 0)}</td>
                    <td>{r.best ? <>{PILE_LABEL[r.best.type]} Ø{nf(r.best.diameter * 100)} · {r.nPiles} estaca(s) · L = {nf(r.best.length)} m</> : '—'}</td>
                    <td>{r.best ? `${nf(r.best.blockDesign.geometry.lx * 100)}×${nf(r.best.blockDesign.geometry.ly * 100)}×${nf(r.best.blockDesign.geometry.h * 100)}` : '—'}</td>
                    <td>{r.best ? brl(r.best.cost.total) : '—'}</td>
                    <td>{r.err ? <span className="bad-t">{r.err}</span> : r.state === 'ok' ? <span className="ok-t">✔ calculado</span> : r.state === 'stale' ? <span className="stale">● desatualizado</span> : <span className="hint">pendente</span>}</td>
                    <td><button className="small" onClick={() => onOpen(r.p)} disabled={r.state === 'none'}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}><b>Total ({rows.filter((r) => r.best).length} pilares calculados)</b></td><td /><td>{totalPiles} estacas · {nf(totalLen)} m de estaca</td><td /><td><b>{brl(total)}</b></td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>
          <p className="hint">Custo conforme a origem dos custos configurada (SINAPI por UF ou manual). Armadura e bloco editados em cada pilar não alteram o custo mostrado aqui.</p>
        </section>
      )}
    </>
  )
}

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import SettingsPanel from './SettingsPanel'
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings, type Settings } from './settings'
import { EMPTY_PROJECT, exampleProject, loadProject, pillarHoles, pillarNames, replacer, reviver, saveProject, type Project } from './ui/project'
import { buildInput, inputKey, type CachedResult, type Job } from './ui/buildInput'
import { optimizeAsync } from './core/optimize'
import SoilPage, { download } from './pages/SoilPage'
import LoadsPage from './pages/LoadsPage'
import ResultsPage from './pages/ResultsPage'
import BatchPage from './pages/BatchPage'
import AdvancedPage from './pages/AdvancedPage'
import ParamsPage from './pages/ParamsPage'
import { unitsOf } from './ui/units'

type Step = 'solo' | 'cargas' | 'criterios' | 'resultados' | 'lote' | 'parametros' | 'avancado'

export default function App() {
  const [step, setStep] = useState<Step>('solo')
  const [project, setProjectState] = useState<Project>(loadProject)
  const [settings, setSettingsState] = useState<Settings>(loadSettings)
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => {
    try { const t = localStorage.getItem('estakalc.theme'); return t === 'light' || t === 'dark' ? t : 'auto' } catch { return 'auto' }
  })
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('estakalc.theme', theme) } catch { /* sem armazenamento */ }
  }, [theme])
  const [view, setView] = useState<'basic' | 'advanced'>('basic')
  // resultados por pilar (compartilhados entre a tela de resultados e o cálculo em lote)
  const [cache, setCache] = useState<Record<string, CachedResult>>({})
  // a página de resultados fica montada depois da 1ª visita: as edições (armadura, bloco, locação) não se perdem ao trocar de etapa
  const [resultsMounted, setResultsMounted] = useState(false)
  if (step === 'resultados' && !resultsMounted) setResultsMounted(true)
  const fileRef = useRef<HTMLInputElement>(null)
  // cálculo em andamento: vive aqui para continuar e aparecer em qualquer tela
  const [job, setJob] = useState<Job | undefined>()
  const [batchErrors, setBatchErrors] = useState<Record<string, string>>({})
  const cancelRef = useRef({ cancelled: false })

  const setProject = (p: Project) => { setProjectState(p); saveProject(p) }
  const setSettings = (s: Settings) => { setSettingsState(s); saveSettings(s) }

  const names = pillarNames(project)
  const holes = project.library.filter((h) => pillarHoles(project, project.pillar).includes(h.id))
  const current = project.combos.filter((c) => c.pillar === project.pillar)
  const soilOk = holes.length > 0 && holes.every((h) => h.waterLevel !== undefined)
  const loadsOk = current.some((c) => c.state === 'ELS') && current.some((c) => c.state === 'ELU')

  const steps = useMemo(
    () => [
      { id: 'solo' as Step, n: '1', title: 'Sondagens', sub: soilOk ? holes.map((h) => h.id).join(', ') : 'perfil do solo e NA', done: soilOk, accent: false },
      { id: 'cargas' as Step, n: '2', title: 'Cargas', sub: loadsOk ? (names.length > 1 ? `${names.length} pilares` : `pilar ${project.pillar}`) : 'combinações ELS/ELU', done: loadsOk, accent: false },
      { id: 'criterios' as Step, n: '3', title: 'Critérios', sub: 'estacas, limites, custos', done: false, accent: false },
      { id: 'resultados' as Step, n: '4', title: 'Resultados', sub: 'otimização, bloco, desenhos', done: false, accent: true },
    ],
    [soilOk, loadsOk, holes, project.pillar, names.length],
  )

  const runBatch = async (list: string[]) => {
    if (job) return
    setBatchErrors({})
    cancelRef.current = { cancelled: false }
    const cancel = cancelRef.current
    for (const [i, p] of list.entries()) {
      if (cancel.cancelled) break
      setJob({ kind: 'lote', label: p, done: i, total: list.length })
      const { input, error } = buildInput(project, settings, p)
      if (!input) { setBatchErrors((e) => ({ ...e, [p]: error ?? 'dados incompletos' })); continue }
      try {
        const r = await optimizeAsync(input, (d) => setJob((j) => (j ? { ...j, detail: d } : j)), cancel)
        if (cancel.cancelled) break
        setCache((c) => ({ ...c, [p]: { result: r, input, key: inputKey(project, settings, p) } }))
        if (r.best.length === 0) setBatchErrors((e) => ({ ...e, [p]: 'nenhuma solução atende (veja os motivos no pilar)' }))
      } catch (e) {
        setBatchErrors((er) => ({ ...er, [p]: (e as Error).message }))
      }
    }
    setJob(undefined)
  }

  const loadExample = () => { setProject(exampleProject()); setCache({}); setStep('cargas') }
  const resetProject = () => {
    if (confirm('Limpar sondagens e cargas do projeto atual? (os parâmetros e custos são mantidos)')) { setProject(EMPTY_PROJECT); setCache({}); setStep('solo') }
  }
  const fileSlug = (project.name ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const saveFile = () => download(`${fileSlug || 'projeto-estakalc'}.json`, JSON.stringify({ estakalc: 1, project, settings }, replacer, 1), 'application/json;charset=utf-8')
  const openFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const d = JSON.parse(await f.text(), reviver) as { estakalc?: number; project?: Partial<Project>; settings?: Partial<Settings> }
      if (!d.estakalc || !d.project) throw new Error('não é um arquivo de projeto do Estakalc')
      setProject({ ...EMPTY_PROJECT, ...d.project })
      if (d.settings) setSettings(normalizeSettings(d.settings))
      setCache({})
      setStep('cargas')
    } catch (err) {
      alert(`Não foi possível abrir o projeto: ${(err as Error).message}.`)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden><rect x="4" y="5" width="24" height="6" rx="1.5" fill="currentColor" /><rect x="7" y="13" width="4" height="14" rx="1" fill="currentColor" opacity=".7" /><rect x="14" y="13" width="4" height="14" rx="1" fill="currentColor" opacity=".7" /><rect x="21" y="13" width="4" height="14" rx="1" fill="currentColor" opacity=".7" /></svg>
          <div><b>Estakalc</b><small>{project.name?.trim() ? project.name : 'Fundações em estacas'}</small></div>
        </div>
        <div className="top-actions">
          <button onClick={loadExample} title="Carrega sondagens e cargas de exemplo">✨ Carregar exemplo</button>
          <label className="unitsel" title="Unidades de força e momento exibidas nas cargas, resultados e memorial (o cálculo é em kN)">Unidades
            <select value={project.units === 'tf' ? 'tf' : 'kN'} onChange={(e) => setProject({ ...project, units: e.target.value as 'kN' | 'tf' })}><option value="kN">kN · kN·m</option><option value="tf">tf · tf·m</option></select>
          </label>
          <label className="unitsel" title="Aparência: automático segue o sistema">Tema
            <select value={theme} onChange={(e) => setTheme(e.target.value as 'auto' | 'light' | 'dark')}><option value="auto">Automático</option><option value="light">Claro</option><option value="dark">Escuro</option></select>
          </label>
          <label className="unitsel" title="Nome do projeto: aparece no título e dá nome ao arquivo salvo">Projeto
            <input type="text" className="pname" placeholder="nome do projeto" value={project.name ?? ''} maxLength={60} onChange={(e) => setProject({ ...project, name: e.target.value })} />
          </label>
          <button onClick={saveFile} title="Salva sondagens, cargas e parâmetros em um arquivo .json">💾 Salvar projeto</button>
          <button onClick={() => fileRef.current?.click()} title="Abre um arquivo salvo anteriormente">📂 Abrir projeto</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void openFile(e)} />
          <button onClick={resetProject} className="ghost">Limpar projeto</button>
        </div>
      </header>

      <div className="shell">
        <nav className="steps" aria-label="Etapas do projeto">
          {steps.map((s) => (
            <button key={s.id} className={`step ${step === s.id ? 'cur' : ''} ${s.done ? 'done' : ''} ${s.accent ? 'accent' : ''}`} onClick={() => setStep(s.id)} aria-current={step === s.id ? 'step' : undefined}>
              <span className="bullet">{s.done ? '✓' : s.n}</span>
              <span className="st"><b>{s.title}</b><small>{s.sub}</small></span>
            </button>
          ))}
          {names.length > 1 && (
            <button className={`step ${step === 'lote' ? 'cur' : ''}`} onClick={() => setStep('lote')}>
              <span className="bullet">▦</span><span className="st"><b>Todos os pilares</b><small>{Object.keys(cache).length}/{names.length} calculados</small></span>
            </button>
          )}
          <div className="sep" />
          <button className={`step minor ${step === 'parametros' ? 'cur' : ''}`} onClick={() => setStep('parametros')}>
            <span className="bullet">🧪</span><span className="st"><b>Parâmetros dos métodos</b><small>coeficientes, solo, estrutural</small></span>
          </button>
          <button className={`step minor ${step === 'avancado' ? 'cur' : ''}`} onClick={() => setStep('avancado')}>
            <span className="bullet">⚙</span><span className="st"><b>Análises avançadas</b><small>capacidade e carga lateral</small></span>
          </button>
          <p className="side-note">Seus dados ficam salvos neste navegador. Use “Salvar projeto” para guardar um arquivo.</p>
        </nav>

        <main>
          {step === 'solo' && <SoilPage project={project} setProject={setProject} onExample={loadExample} onNext={() => setStep('cargas')} />}
          {step === 'cargas' && <LoadsPage project={project} setProject={setProject} onExample={loadExample} onBack={() => setStep('solo')} onNext={() => setStep('criterios')} />}
          {step === 'criterios' && (
            <>
              <header className="page-h">
                <h1>3 · Critérios e custos</h1>
                <p>Os valores iniciais seguem as normas e a literatura; edite o que for decisão do projetista. Campos alterados ficam destacados. Coeficientes dos métodos, solo e estrutural estão em “Parâmetros dos métodos”.</p>
                <div className="seg" role="tablist">
                  <button className={view === 'basic' ? 'on' : ''} onClick={() => setView('basic')}>Essenciais</button>
                  <button className={view === 'advanced' ? 'on' : ''} onClick={() => setView('advanced')}>Avançados</button>
                  <button className="ghost" onClick={() => { if (confirm('Restaurar todos os parâmetros aos valores iniciais?')) setSettings({ ...DEFAULT_SETTINGS }) }}>Restaurar padrões</button>
                </div>
              </header>
              <SettingsPanel s={settings} onChange={setSettings} view={view} />
              <footer className="page-f">
                <button onClick={() => setStep('cargas')}>← Cargas</button>
                <span />
                <button className="primary" onClick={() => setStep('resultados')}>Próximo: calcular →</button>
              </footer>
            </>
          )}
          {resultsMounted && (
            <div hidden={step !== 'resultados'}>
              <ResultsPage project={project} setProject={setProject} settings={settings} cache={cache} setCache={setCache} job={job} setJob={setJob} cancelRef={cancelRef} onBack={() => setStep(!soilOk ? 'solo' : 'cargas')} />
            </div>
          )}
          {step === 'lote' && <BatchPage project={project} settings={settings} cache={cache} job={job} errors={batchErrors} onRun={(l) => void runBatch(l)} onCancel={() => { cancelRef.current.cancelled = true }} onOpen={(p) => { setProject({ ...project, pillar: p }); setStep('resultados') }} />}
          {step === 'parametros' && <ParamsPage s={settings} onChange={setSettings} holes={holes} />}
          {step === 'avancado' && <AdvancedPage holes={holes} settings={settings} setSettings={setSettings} u={unitsOf(project.units)} />}
        </main>
      </div>

      {job && (
        <div className="jobbar" role="status" aria-live="polite">
          <div className="jb-t">
            <b>{job.kind === 'lote' ? `Calculando todos os pilares — ${job.label}` : `Calculando o pilar ${job.label}`}</b>
            <span>{job.kind === 'lote' ? `pilar ${Math.min(job.done + 1, job.total)} de ${job.total}` : ''}{job.detail ? `${job.kind === 'lote' ? ' · ' : ''}${job.detail.done}/${job.detail.total} candidatos · ${job.detail.found} solução(ões)` : ' · preparando…'}</span>
          </div>
          <progress max={job.kind === 'lote' ? job.total : (job.detail?.total ?? 1)} value={job.kind === 'lote' ? job.done + (job.detail ? job.detail.done / Math.max(job.detail.total, 1) : 0) : (job.detail?.done ?? 0)} />
          <div className="row">
            <button className="small" onClick={() => setStep(job.kind === 'lote' ? 'lote' : 'resultados')}>Ver</button>
            <button className="small" onClick={() => { cancelRef.current.cancelled = true }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

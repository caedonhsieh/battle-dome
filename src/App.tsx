import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import teamsData from './data/reference-teams.json';
import {store} from './lib/storage';
import {useBenchmarkRun} from './lib/useBenchmarkRun';
import type {BundledRef, CustomRef, RunConfig, RunMeta, RunRecord, SavedTeam} from './lib/types';
import {FORMAT_LABEL} from './lib/types';
import {buildJob, buildRunRecord} from './lib/run';
import type {RefTeam} from './sim/client';
import TeamsTab from './components/TeamsTab';
import RefsTab from './components/RefsTab';
import RunTab from './components/RunTab';
import ResultsTab from './components/ResultsTab';
import AboutTab from './components/AboutTab';

const BUNDLED: BundledRef[] = (teamsData as any).teams;

type Tab = 'teams' | 'refs' | 'run' | 'results' | 'about';

const TABS: [Tab, string][] = [
  ['run', 'RUN'],
  ['teams', 'PARTY'],
  ['refs', 'FOES'],
  ['results', 'FILES'],
  ['about', 'GUIDE'],
];

export default function App() {
  const [tab, setTab] = useState<Tab>('teams');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLElement | null>(null);

  // Close the start menu on Escape or an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);
  const [teams, setTeams] = useState<SavedTeam[]>(() => store.getTeams());
  const [customRefs, setCustomRefs] = useState<CustomRef[]>(() => store.getCustomRefs());
  const [config, setConfig] = useState<RunConfig>(() => store.getConfig());
  const [selection, setSelection] = useState(() => store.getSelection());
  const [history, setHistory] = useState<RunRecord[]>(() => store.getHistory());
  const [currentView, setCurrentView] = useState<RunRecord | null>(null);

  const run = useBenchmarkRun();
  const metaRef = useRef<RunMeta | null>(null);
  /** Snapshot of the refs at run start (selection may change mid-run). */
  const refsRef = useRef<RefTeam[]>([]);
  const savedRunRef = useRef(false);
  const cancelChoiceRef = useRef<'keep' | 'discard' | null>(null);

  // persist state slices
  useEffect(() => store.setTeams(teams), [teams]);
  useEffect(() => store.setCustomRefs(customRefs), [customRefs]);
  useEffect(() => store.setConfig(config), [config]);
  useEffect(() => store.setSelection(selection), [selection]);
  useEffect(() => store.setHistory(history), [history]);

  const selectedTeamId = selection.teamId;
  const selectedRefIds = selection.refIds;

  const allRefs: RefTeam[] = useMemo(() => {
    const bundled: RefTeam[] = BUNDLED.map((t) => ({
      id: t.id,
      name: t.name,
      archetype: t.archetype,
      paste: t.paste,
    }));
    const custom: RefTeam[] = customRefs.map((r) => ({
      id: r.id,
      name: r.name,
      archetype: r.archetype,
      paste: r.paste,
    }));
    return [...bundled, ...custom];
  }, [customRefs]);

  const selectedRefs = useMemo(
    () => allRefs.filter((r) => selectedRefIds.includes(r.id)),
    [allRefs, selectedRefIds],
  );

  const refPasteById = useMemo(
    () => new Map(allRefs.map((r) => [r.id, r.paste] as const)),
    [allRefs],
  );

  const setSelectedTeamId = useCallback(
    (id: string | null) => setSelection((s) => ({...s, teamId: id})),
    [],
  );
  const setSelectedRefIds = useCallback(
    (ids: string[]) => setSelection((s) => ({...s, refIds: ids})),
    [],
  );

  const handleStart = useCallback(() => {
    const built = buildJob(teams, selectedTeamId, selectedRefs, config);
    if (!built) return;
    metaRef.current = built.meta;
    refsRef.current = built.job.refs;
    savedRunRef.current = false;
    run.start(built.job, config.workerCount ?? 2);
    setTab('run');
  }, [teams, selectedTeamId, selectedRefs, config, run]);

  // Auto-save completed runs to history and show them.
  useEffect(() => {
    if (run.state.status === 'done' && metaRef.current && !savedRunRef.current) {
      savedRunRef.current = true;
      const record = buildRunRecord({
        meta: metaRef.current,
        refs: refsRef.current,
        results: run.state.results,
        provider: run.state.provider,
        durationMs:
          run.state.startedAt && run.state.endedAt
            ? run.state.endedAt - run.state.startedAt
            : undefined,
      });
      setHistory((h) => [record, ...h]);
      setCurrentView(record);
      setTab('results');
    }
  }, [run.state.status, run.state.results]);

  const handleCancel = useCallback(
    (choice: 'keep' | 'discard') => {
      cancelChoiceRef.current = choice;
      run.cancel();
    },
    [run],
  );

  // Handle the worker's cancel acknowledgement: keep -> save partial results
  // as a run record (including the in-progress matchup's tally); discard ->
  // drop them. Either way the run state is reset afterwards.
  useEffect(() => {
    if (run.state.status !== 'cancelled') return;
    const choice = cancelChoiceRef.current;
    cancelChoiceRef.current = null;
    if (choice === 'keep' && metaRef.current) {
      savedRunRef.current = true;
      // Pool rows update incrementally as battles land, so the state already
      // holds every finished battle; just drop matchups with none.
      const results = run.state.results.filter((r) => (r.battles?.length ?? 0) > 0);
      const record = buildRunRecord({
        meta: metaRef.current,
        refs: refsRef.current,
        results,
        provider: run.state.provider,
        partial: true,
        durationMs:
          run.state.startedAt && run.state.endedAt
            ? run.state.endedAt - run.state.startedAt
            : undefined,
      });
      setHistory((h) => [record, ...h]);
      setCurrentView(record);
      setTab('results');
    }
    run.reset();
  }, [run, run.state.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewRecord = useCallback((r: RunRecord) => {
    setCurrentView(r);
    setTab('results');
  }, []);

  return (
    <div className="app">
      <header className="site-header">
        <div className="header-inner">
          <div>
            <h1 className="logo">★ DOME OS ★</h1>
            <p className="tagline">Battle Dome · Data-driven OU Matchup Evaluation</p>
          </div>
          <div className="header-right">
            <span className="badge format">{FORMAT_LABEL}</span>
            <nav className="startmenu-wrap" ref={menuRef}>
          <button
            className="startmenu-trigger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="sm-cursor">▶</span>
            {TABS.find(([id]) => id === tab)?.[1]}
            {run.running && <span className="dot" />}
          </button>
          {menuOpen && (
            <div className="startmenu" role="menu">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  role="menuitem"
                  className={`startmenu-item ${tab === id ? 'active' : ''}`}
                  onClick={() => {
                    setTab(id);
                    setMenuOpen(false);
                  }}
                >
                  <span className="sm-cursor">{tab === id ? '▶' : ''}</span>
                  {label}
                  {id === 'run' && run.running && <span className="dot" />}
                </button>
              ))}
            </div>
          )}
        </nav>
          </div>
        </div>
      </header>

      <main className="main">
        {tab === 'teams' && (
          <TeamsTab
            teams={teams}
            onChange={setTeams}
            selectedTeamId={selectedTeamId}
            onSelect={setSelectedTeamId}
          />
        )}
        {tab === 'refs' && (
          <RefsTab
            selectedRefIds={selectedRefIds}
            onSelectionChange={setSelectedRefIds}
            customRefs={customRefs}
            onCustomRefsChange={setCustomRefs}
            userTeamName={teams.find((t) => t.id === selectedTeamId)?.name ?? null}
            userPaste={teams.find((t) => t.id === selectedTeamId)?.paste ?? null}
          />
        )}
        {tab === 'run' && (
          <RunTab
            teams={teams}
            selectedTeamId={selectedTeamId}
            selectedRefs={selectedRefs}
            config={config}
            onConfigChange={setConfig}
            runState={run.state}
            onStart={handleStart}
            onCancel={handleCancel}
            onSelectTeam={setSelectedTeamId}
          />
        )}
        {tab === 'results' && (
          <ResultsTab
            current={currentView}
            history={history}
            onHistoryChange={setHistory}
            onViewRecord={viewRecord}
            getRefPaste={(id) => refPasteById.get(id)}
            getUserPaste={(name) => teams.find((t) => t.name === name)?.paste}
            requestReplay={run.replay}
            runActive={run.running}
          />
        )}
        {tab === 'about' && <AboutTab />}
      </main>

      <footer className="site-footer">
        <span>
          Battle Dome runs 100% in your browser — no server, no uploads. Reference teams:{' '}
          Smogon SV OU Sample Teams.
        </span>
      </footer>
    </div>
  );
}

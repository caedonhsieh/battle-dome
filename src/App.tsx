import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import teamsData from './data/reference-teams.json';
import {store} from './lib/storage';
import {useBenchmarkRun} from './lib/useBenchmarkRun';
import type {BundledRef, CustomRef, RunConfig, RunMeta, RunRecord, SavedTeam} from './lib/types';
import {uid, FORMAT_LABEL} from './lib/types';
import type {RefTeam} from './sim/client';
import TeamsTab from './components/TeamsTab';
import RefsTab from './components/RefsTab';
import RunTab, {buildJob} from './components/RunTab';
import ResultsTab from './components/ResultsTab';
import AboutTab from './components/AboutTab';

const BUNDLED: BundledRef[] = (teamsData as any).teams;

type Tab = 'teams' | 'refs' | 'run' | 'results' | 'about';

export default function App() {
  const [tab, setTab] = useState<Tab>('teams');
  const [teams, setTeams] = useState<SavedTeam[]>(() => store.getTeams());
  const [customRefs, setCustomRefs] = useState<CustomRef[]>(() => store.getCustomRefs());
  const [config, setConfig] = useState<RunConfig>(() => store.getConfig());
  const [selection, setSelection] = useState(() => store.getSelection());
  const [history, setHistory] = useState<RunRecord[]>(() => store.getHistory());
  const [currentView, setCurrentView] = useState<RunRecord | null>(null);

  const run = useBenchmarkRun();
  const metaRef = useRef<RunMeta | null>(null);
  const savedRunRef = useRef(false);

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
    savedRunRef.current = false;
    run.start(built.job);
    setTab('run');
  }, [teams, selectedTeamId, selectedRefs, config, run]);

  // Auto-save completed runs to history and show them.
  useEffect(() => {
    if (run.state.status === 'done' && metaRef.current && !savedRunRef.current) {
      savedRunRef.current = true;
      const meta = metaRef.current;
      if (run.state.provider) meta.provider = run.state.provider;
      const record: RunRecord = {
        id: uid(),
        name: `${meta.teamName} — ${new Date(meta.date).toLocaleDateString()} ${new Date(meta.date).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`,
        date: meta.date,
        meta,
        refs: selectedRefs.map((r) => ({id: r.id, name: r.name, archetype: r.archetype})),
        results: run.state.results,
      };
      setHistory((h) => [record, ...h]);
      setCurrentView(record);
      setTab('results');
    }
  }, [run.state.status, run.state.results, selectedRefs]);

  const viewRecord = useCallback((r: RunRecord) => {
    setCurrentView(r);
    setTab('results');
  }, []);

  return (
    <div className="app">
      <header className="site-header">
        <div className="header-inner">
          <div>
            <h1 className="logo">Battle Dome</h1>
            <p className="tagline">Data-driven OU Matchup Evaluation</p>
          </div>
          <span className="badge format">{FORMAT_LABEL}</span>
        </div>
        <nav className="tabs">
          {(
            [
              ['teams', 'My Teams'],
              ['refs', 'Reference Teams'],
              ['run', 'Run'],
              ['results', 'Results'],
              ['about', 'How it works'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={`tab ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
              {id === 'run' && run.running && <span className="dot" />}
            </button>
          ))}
        </nav>
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
            onCancel={run.cancel}
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

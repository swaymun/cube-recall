'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, RotateCcw, Shuffle, TimerReset } from 'lucide-react';
import Image from 'next/image';
import rawData from '@/data/algorithm_data_with_setups.json';

type Algorithm = { alg: string; note: string };
type CaseData = {
  name: string;
  visual_tokens: string[];
  algorithms: Algorithm[];
  primary: string;
  alternate: string;
  primary_setup: { setup: string; auf: string; solver_solution: string };
};
type Rating = 'again' | 'hard' | 'good' | 'easy';
type DeckId = 'oll' | 'pll' | 'pll-recognition';
type SessionMode = 'due' | 'shuffle';
type Progress = {
  due: number;
  interval: number;
  repetitions: number;
  lastRating?: Rating;
  bestTimeMs?: number;
  lastReviewed?: number;
};
type ProgressStore = Record<string, Progress>;

const data = rawData as { oll: CaseData[]; pll: CaseData[] };
const STORAGE_KEY = 'cube-recall-progress-v1';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DECKS: Array<{
  id: DeckId;
  title: string;
  count: number;
  description: string;
  accent: string;
  source: 'oll' | 'pll';
}> = [
  { id: 'oll', title: 'OLL', count: 57, description: 'Orient the last layer from a 3D case.', accent: 'yellow', source: 'oll' },
  { id: 'pll', title: 'PLL', count: 21, description: 'Permute the last layer from two sides.', accent: 'blue', source: 'pll' },
  { id: 'pll-recognition', title: 'PLL Recognition', count: 21, description: 'Name the PLL from its two-side pattern.', accent: 'red', source: 'pll' },
];

const RATING_LABELS: Array<{ id: Rating; label: string }> = [
  { id: 'again', label: 'Again' }, { id: 'hard', label: 'Hard' }, { id: 'good', label: 'Good' }, { id: 'easy', label: 'Easy' },
];

function caseKey(deckId: DeckId, item: CaseData) { return `${deckId}:${item.name}`; }

function formatTime(ms?: number) { return ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`; }

function formatInterval(ms: number) {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.max(1, Math.round(ms / HOUR))}h`;
  return `${Math.max(1, Math.round(ms / DAY))}d`;
}

function intervalFor(progress: Progress | undefined, rating: Rating) {
  if (!progress || progress.repetitions === 0) return { again: 10 * MINUTE, hard: DAY, good: 3 * DAY, easy: 7 * DAY }[rating];
  if (rating === 'again') return 10 * MINUTE;
  if (rating === 'hard') return Math.max(DAY, progress.interval * 1.2);
  if (rating === 'good') return Math.max(DAY, progress.interval * 2.5);
  return Math.max(2 * DAY, progress.interval * 4);
}

function nextProgress(current: Progress | undefined, rating: Rating, now: number, elapsed?: number): Progress {
  const interval = intervalFor(current, rating);
  return {
    due: now + interval,
    interval,
    repetitions: (current?.repetitions ?? 0) + 1,
    lastRating: rating,
    lastReviewed: now,
    bestTimeMs: elapsed == null ? current?.bestTimeMs : Math.min(current?.bestTimeMs ?? elapsed, elapsed),
  };
}

function initialProgress(): ProgressStore {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as ProgressStore; } catch { return {}; }
}

function countsFor(deck: (typeof DECKS)[number], progress: ProgressStore) {
  const now = Date.now();
  const counts = { newCount: 0, learning: 0, due: 0 };
  data[deck.source].forEach((item) => {
    const saved = progress[caseKey(deck.id, item)];
    if (!saved) counts.newCount += 1;
    else if (saved.due <= now) counts.due += 1;
    else if (saved.interval < DAY) counts.learning += 1;
  });
  return counts;
}

function shuffleItems<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function CubeView({ item }: { item: CaseData }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let player: HTMLElement | undefined;
    async function mount() {
      if (!hostRef.current) return;
      const { TwistyPlayer } = await import('cubing/twisty');
      if (disposed || !hostRef.current) return;
      player = new TwistyPlayer({ puzzle: '3x3x3', experimentalSetupAlg: `${item.primary_setup.setup} x2`, visualization: '3D', background: 'none', controlPanel: 'none', backView: 'none', cameraLatitude: 24, cameraLongitude: 32, cameraDistance: 4.6 });
      player.style.width = '100%';
      player.style.height = '250px';
      player.setAttribute('aria-label', `${item.name} cube case`);
      hostRef.current.replaceChildren(player);
    }
    void mount();
    return () => { disposed = true; player?.remove(); };
  }, [item]);
  return <div className="cube-stage"><div ref={hostRef} className="cube-host" aria-live="polite"><div className="cube-loading">Loading case view…</div></div><span className="cube-caption">drag to inspect · yellow on top</span></div>;
}

function StaticPattern({ item }: { item: CaseData }) {
  const tokens = item.visual_tokens.slice(0, 25);
  return <div className="pattern-fallback" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <span key={index} className={`sticker sticker-${tokens[index] ?? 'div'}`} />)}</div>;
}

function OLLPattern({ item }: { item: CaseData }) {
  const [imageFailed, setImageFailed] = useState(false);
  const caseNumber = item.name.replace('OLL ', '');
  if (imageFailed) return <div className="oll-pattern oll-pattern-fallback"><StaticPattern item={item} /></div>;
  return <Image className="oll-image" src={`https://raw.githubusercontent.com/Roman-/oll_trainer/master/pic/${caseNumber}.svg`} alt={`${item.name} OLL case`} width={330} height={330} unoptimized draggable={false} onError={() => setImageFailed(true)} />;
}

function CountCell({ value, tone }: { value: number; tone: 'new' | 'learning' | 'due' }) {
  return <div className={`count-cell ${tone} ${value === 0 ? 'zero' : ''}`}>{value}</div>;
}

function DeckDashboard({ progress, onStart, onReset }: { progress: ProgressStore; onStart: (deckId: DeckId, mode: SessionMode) => void; onReset: (deckId: DeckId) => void }) {
  const totals = DECKS.reduce((result, deck) => { const counts = countsFor(deck, progress); result.newCount += counts.newCount; result.learning += counts.learning; result.due += counts.due; return result; }, { newCount: 0, learning: 0, due: 0 });
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const studiedToday = Object.values(progress).filter((item) => (item.lastReviewed ?? 0) >= dayStart.getTime()).length;
  return <main className="page-shell dashboard-shell">
    <header className="top-nav"><button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Cube Recall</button><nav aria-label="Primary"><span className="nav-link active">Decks</span><span className="nav-link muted">Stats</span></nav><span className="nav-status">{totals.due} due today</span></header>
    <section className="deck-heading"><h1>Decks</h1></section>
    <section className="deck-table" aria-label="Study decks"><div className="deck-table-head"><span>Deck</span><span>New</span><span>Learn</span><span>Due</span><span aria-hidden="true" /></div>
      {DECKS.map((deck) => { const counts = countsFor(deck, progress); return <article className="deck-row" key={deck.id}><span className="deck-name-cell">{deck.title}</span><CountCell value={counts.newCount} tone="new" /><CountCell value={counts.learning} tone="learning" /><CountCell value={counts.due} tone="due" /><div className="deck-actions"><button className="button button-primary" onClick={() => onStart(deck.id, 'due')}>Study <ChevronRight size={15} /></button><button className="button button-reset" onClick={() => onReset(deck.id)} title={`Reset ${deck.title}`} aria-label={`Reset ${deck.title}`}><RotateCcw size={14} /><span>Reset</span></button></div></article>; })}
    </section>
    <footer className="site-footer"><span>Studied {studiedToday} {studiedToday === 1 ? 'case' : 'cases'} today</span><span>Progress is saved on this device.</span><a href="https://github.com/Roman-/oll_trainer/tree/master/pic" target="_blank" rel="noreferrer">OLL diagrams: Roman-/oll_trainer</a></footer>
  </main>;
}

function RatingButtons({ progress, onRate }: { progress?: Progress; onRate: (rating: Rating) => void }) {
  return <div className="rating-grid" aria-label="How well did you recall this card?">{RATING_LABELS.map(({ id, label }) => <button className={`rating-button rating-${id}`} key={id} onClick={() => onRate(id)}><strong>{label}</strong><span>{formatInterval(intervalFor(progress, id))}</span></button>)}</div>;
}

function AlgorithmReveal({ item }: { item: CaseData }) {
  const alternates = item.algorithms.slice(1);
  const [expanded, setExpanded] = useState(false);
  return <section className="answer-panel" aria-label="Algorithm answer"><div className="answer-heading"><span>Algorithm</span><span className="answer-rule" /></div><code>{item.primary}</code>{alternates.length > 0 && <><button className="alternate-toggle" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {expanded ? 'Hide alternates' : `Show ${alternates.length} alternate${alternates.length === 1 ? '' : 's'}`}</button>{expanded && <div className="alternate-list">{alternates.map((algorithm, index) => <code key={`${algorithm.alg}-${index}`}>{algorithm.alg}{algorithm.note && <small>{algorithm.note}</small>}</code>)}</div>}</>}<p className="setup-note">Setup: <code>{item.primary_setup.setup}</code> · AUF: <code>{item.primary_setup.auf}</code></p></section>;
}

function RecognitionPrompt({ item, choices, selected, onChoose }: { item: CaseData; choices: CaseData[]; selected?: string; onChoose: (name: string) => void }) {
  return <section className="recognition-prompt" aria-label="PLL recognition choices"><p className="prompt-label">Which PLL is this?</p><div className="choice-grid">{choices.map((choice) => { const isSelected = selected === choice.name; const isCorrect = choice.name === item.name; const answerState = selected ? (isCorrect ? 'correct' : isSelected ? 'incorrect' : '') : ''; return <button className={`choice-button ${answerState}`} key={choice.name} onClick={() => onChoose(choice.name)} disabled={Boolean(selected)}>{choice.name}{selected && isCorrect ? ' ✓' : ''}</button>; })}</div></section>;
}

function StudyView({ deckId, queue, queueIndex, mode, progress, onBack, onShuffle, onNext, onGrade, onSaveTime }: { deckId: DeckId; queue: CaseData[]; queueIndex: number; mode: SessionMode; progress: ProgressStore; onBack: () => void; onShuffle: () => void; onNext: () => void; onGrade: (rating: Rating, elapsed?: number) => void; onSaveTime: (elapsed: number) => void }) {
  const item = queue[queueIndex];
  const isRecognition = deckId === 'pll-recognition';
  const [answerShown, setAnswerShown] = useState(false);
  const [timerState, setTimerState] = useState<'idle' | 'armed' | 'running' | 'stopped'>('idle');
  const [startAt, setStartAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<string>();
  const [autoRated, setAutoRated] = useState(false);
  const pointerStarted = useRef(false);
  const title = DECKS.find((deck) => deck.id === deckId)?.title ?? 'Study';
  const saved = item ? progress[caseKey(deckId, item)] : undefined;

  useEffect(() => { if (timerState !== 'running' || startAt == null) return; const update = () => setElapsed(performance.now() - startAt); update(); const timer = window.setInterval(update, 40); return () => window.clearInterval(timer); }, [timerState, startAt]);
  const startTimer = useCallback(() => { setTimerState('running'); setStartAt(performance.now()); setElapsed(0); }, []);
  const stopTimer = useCallback(() => { if (startAt == null) return; const finalTime = performance.now() - startAt; setElapsed(finalTime); setTimerState('stopped'); setAnswerShown(true); onSaveTime(finalTime); }, [onSaveTime, startAt]);
  const onPressStart = (event: React.PointerEvent<HTMLButtonElement>) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture?.(event.pointerId); pointerStarted.current = true; if (timerState === 'idle') setTimerState('armed'); };
  const onPressEnd = () => { if (!pointerStarted.current) return; pointerStarted.current = false; if (timerState === 'armed') startTimer(); else if (timerState === 'running') stopTimer(); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); if (timerState === 'idle') setTimerState('armed'); } };
  const onKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (timerState === 'armed') startTimer(); else if (timerState === 'running') stopTimer(); } };
  const revealAsAgain = () => { setAnswerShown(true); setAutoRated(true); onGrade('again'); };
  const choices = useMemo(() => { if (!isRecognition || !item) return []; return shuffleItems([item, ...shuffleItems(data.pll.filter((candidate) => candidate.name !== item.name)).slice(0, 3)]); }, [isRecognition, item]);
  const chooseRecognition = (name: string) => { setSelectedChoice(name); setAnswerShown(true); };
  if (!item) return <main className="page-shell"><p>No cards are available.</p></main>;

  return <main className="page-shell study-shell"><header className="study-header"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> <span>Decks</span></button><div className="study-title"><span>{title}</span><strong>{queueIndex + 1} / {queue.length}</strong></div><div className="study-actions"><span className={`mode-label ${mode}`}>{mode === 'shuffle' ? 'Shuffle' : 'Due review'}</span><button className="study-shuffle" onClick={onShuffle}><Shuffle size={14} /> Shuffle</button></div></header><div className="study-progress"><span style={{ width: `${(queueIndex / Math.max(queue.length, 1)) * 100}%` }} /></div>
    <section className="study-card"><div className="case-meta"><div><h1>{item.name}</h1></div><span className="case-count">{saved ? `reviewed ${saved.repetitions}×` : 'new card'}</span></div>
      <button className={`case-visual ${timerState}`} onPointerDown={onPressStart} onPointerUp={onPressEnd} onPointerCancel={() => { pointerStarted.current = false; if (timerState === 'armed') setTimerState('idle'); }} onKeyDown={onKeyDown} onKeyUp={onKeyUp} aria-label={timerState === 'running' ? 'Tap to stop the timer' : 'Hold and release to start the execution timer'}><div className="visual-frame">{deckId === 'oll' ? <OLLPattern item={item} /> : <><CubeView item={item} /><div className="visual-fallback"><StaticPattern item={item} /></div></>}</div><div className="timer-readout">{timerState === 'armed' && <span>Release to start</span>}{timerState === 'idle' && <span>Hold + release to start · tap to stop</span>}{timerState === 'running' && <strong>{formatTime(elapsed)}</strong>}{timerState === 'stopped' && <strong>{formatTime(elapsed)}</strong>}</div></button>
      {isRecognition && <RecognitionPrompt item={item} choices={choices} selected={selectedChoice} onChoose={chooseRecognition} />}
      {!answerShown && !selectedChoice && <button className="dont-know" onClick={revealAsAgain}><RotateCcw size={16} /> I don’t know — show algorithm</button>}
      {answerShown && <AlgorithmReveal item={item} />}
      {answerShown && !autoRated && (timerState !== 'idle' || isRecognition) && <div className="rating-section"><div className="rating-header"><span>How did that feel?</span>{elapsed > 0 && <span>{formatTime(elapsed)} attempt</span>}</div><RatingButtons progress={saved} onRate={(rating) => onGrade(rating, elapsed || undefined)} /></div>}
      {autoRated && <div className="auto-rated"><span>Recorded as Again.</span><button className="button button-primary" onClick={onNext}>Next card <ChevronRight size={16} /></button></div>}
    </section><p className="study-hint"><TimerReset size={15} /> Keyboard: hold Space or Enter to start, release to stop.</p></main>;
}

type ModelContext = { registerTool: (tool: { name: string; title?: string; description: string; inputSchema: object; annotations?: object; execute: (input: unknown) => unknown }, options?: { signal?: AbortSignal }) => void | Promise<void> };
declare global { interface Document { modelContext?: ModelContext } }

export default function Home() {
  const [view, setView] = useState<'dashboard' | 'study'>('dashboard');
  const [progress, setProgress] = useState<ProgressStore>({});
  const [deckId, setDeckId] = useState<DeckId>('oll');
  const [queue, setQueue] = useState<CaseData[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [mode, setMode] = useState<SessionMode>('due');
  const currentRef = useRef<{ deckId: DeckId; item?: CaseData }>({ deckId: 'oll' });
  const progressRef = useRef(progress);
  const actionsRef = useRef<{ start: (deck: DeckId, mode: SessionMode) => unknown; grade: (rating: Rating, elapsed?: number) => unknown }>({ start: () => null, grade: () => null });
  useEffect(() => {
    const load = window.setTimeout(() => setProgress(initialProgress()), 0);
    return () => window.clearTimeout(load);
  }, []);
  const persist = useCallback((next: ProgressStore) => { setProgress(next); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }, []);
  const startStudy = useCallback((nextDeckId: DeckId, nextMode: SessionMode) => { const deck = DECKS.find((candidate) => candidate.id === nextDeckId) ?? DECKS[0]; const items = data[deck.source]; const now = Date.now(); const eligible = nextMode === 'shuffle' ? items : items.filter((item) => { const saved = progress[caseKey(nextDeckId, item)]; return !saved || saved.due <= now; }); const nextQueue = shuffleItems(eligible.length ? eligible : items); setDeckId(nextDeckId); setMode(nextMode); setQueue(nextQueue); setQueueIndex(0); currentRef.current = { deckId: nextDeckId, item: nextQueue[0] }; setView('study'); }, [progress]);
  const saveTime = useCallback((elapsed: number) => { const current = currentRef.current; if (!current.item) return; const key = caseKey(current.deckId, current.item); const existing = progress[key]; if (!existing || existing.bestTimeMs == null || elapsed < existing.bestTimeMs) persist({ ...progress, [key]: { ...(existing ?? { due: Date.now(), interval: 0, repetitions: 0 }), bestTimeMs: elapsed } }); }, [persist, progress]);
  const resetDeck = useCallback((nextDeckId: DeckId) => { const deck = DECKS.find((candidate) => candidate.id === nextDeckId); if (!deck || !window.confirm(`Reset all progress for ${deck.title}?`)) return; const prefix = `${nextDeckId}:`; const next = Object.fromEntries(Object.entries(progress).filter(([key]) => !key.startsWith(prefix))); persist(next); }, [persist, progress]);
  const advance = useCallback(() => { setQueueIndex((index) => { const nextIndex = index + 1; if (nextIndex >= queue.length) { setView('dashboard'); return index; } currentRef.current = { deckId, item: queue[nextIndex] }; return nextIndex; }); }, [deckId, queue]);
  const nextCard = useCallback(() => { advance(); }, [advance]);
  const grade = useCallback((rating: Rating, elapsed?: number) => { const current = currentRef.current; if (!current.item) return; const key = caseKey(current.deckId, current.item); persist({ ...progress, [key]: nextProgress(progress[key], rating, Date.now(), elapsed) }); window.setTimeout(advance, 0); }, [advance, persist, progress]);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { actionsRef.current = { start: startStudy, grade }; }, [grade, startStudy]);
  useEffect(() => { const context = document.modelContext; if (!context?.registerTool) return; const lifecycle = new AbortController(); const register = async () => { await context.registerTool({ name: 'read_cube_recall_decks', title: 'Read deck status', description: 'Read current New, Learning, and Due counts for the three Cube Recall decks.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => DECKS.map((deck) => ({ deck: deck.title, ...countsFor(deck, progressRef.current) })) }, { signal: lifecycle.signal }); await context.registerTool({ name: 'start_cube_recall_session', title: 'Start study session', description: 'Start a due-review or shuffle session for an OLL, PLL, or PLL recognition deck.', inputSchema: { type: 'object', properties: { deckId: { type: 'string', enum: ['oll', 'pll', 'pll-recognition'] }, mode: { type: 'string', enum: ['due', 'shuffle'] } }, required: ['deckId', 'mode'], additionalProperties: false }, execute: (input) => { const value = input as { deckId?: DeckId; mode?: SessionMode }; if (!value.deckId || !value.mode || !DECKS.some((deck) => deck.id === value.deckId)) throw new Error('Invalid deck or mode'); actionsRef.current.start(value.deckId, value.mode); return { started: true, deckId: value.deckId, mode: value.mode }; } }, { signal: lifecycle.signal }); await context.registerTool({ name: 'rate_cube_recall_card', title: 'Rate current card', description: 'Rate the visible Cube Recall card as Again, Hard, Good, or Easy.', inputSchema: { type: 'object', properties: { rating: { type: 'string', enum: ['again', 'hard', 'good', 'easy'] } }, required: ['rating'], additionalProperties: false }, execute: (input) => { const value = input as { rating?: Rating }; if (!value.rating || !RATING_LABELS.some((rating) => rating.id === value.rating)) throw new Error('Invalid rating'); actionsRef.current.grade(value.rating); return { rated: true, rating: value.rating }; } }, { signal: lifecycle.signal }); }; void register(); return () => lifecycle.abort(); }, []);
  if (view === 'study') return <StudyView key={`${deckId}:${queueIndex}`} deckId={deckId} queue={queue} queueIndex={queueIndex} mode={mode} progress={progress} onBack={() => setView('dashboard')} onShuffle={() => startStudy(deckId, 'shuffle')} onNext={nextCard} onGrade={grade} onSaveTime={saveTime} />;
  return <DeckDashboard progress={progress} onStart={startStudy} onReset={resetDeck} />;
}

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
  primary_setup?: { setup: string; auf: string; solver_solution: string };
  case_setup?: string;
};
type Rating = 'again' | 'hard' | 'good' | 'easy';
type DeckId = 'oll' | 'pll' | 'pll-recognition' | 'f2l' | 'oh-oll' | 'oh-pll' | 'blindfold-op';
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

const data = rawData as { f2l: CaseData[]; oll: CaseData[]; pll: CaseData[] };
const STORAGE_KEY = 'cube-recall-progress-v1';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function invertMove(move: string) {
  if (move.endsWith("'")) return move.slice(0, -1);
  if (move.endsWith('2')) return move;
  return `${move}'`;
}

function invertAlgorithm(algorithm: string) {
  return algorithm.replace(/[()]/g, '').split(/\s+/).filter(Boolean).reverse().map(invertMove).join(' ');
}

function generatedCase(name: string, algorithm: string, note = ''): CaseData {
  return { name, visual_tokens: [], algorithms: [{ alg: algorithm, note }], primary: algorithm, alternate: '', case_setup: invertAlgorithm(algorithm) };
}

const OH_OLL_ALGORITHMS = [
  "x' U' R U R' x U' R' U' R U R' U R",
  "y R U2 R2 U' R U' R' U2 F R F'",
  "y' R U2 R' U' R U' R' F R U R' U' F'",
  "y' F U R U' R' F' R' U' R U' R' U2 R",
  "r U' r' U' r y R U R' f'",
  "y R U R' U' R U' R' U2 R U' R' U2 R U R'",
  "y F R U R' y' U R' U' R U' R'",
  "y2 R' U R U' R' U R U x' R U' R' U",
];

const OH_PLL_ALGORITHMS = [
  "R' U' R U' R U R U' R' U R U R2 U' R'",
  "f F' R U2 R2 U2 R2 U2 R S'",
  "R' U R U' x' U R U2 R' U' R U' R' U2 R U R' U'",
  "R2 U' R' U R U' x U' z' U' R U' R' z R' d R",
  "y R2 U R' U' y R U R' U' R U R' U' R U R' U' y' R U' R2",
  "R U R' U R U2 R' U' R U2 L' U R' U' L U' R U' R'",
  "y2 R2 u' R U' R U R' D x' U2 r U' r'",
  "R U R' U' R' U R U2 L' R' U R U' Rw U' R U' R'",
  "R U2 R' U' R U2 L' U R' U' r",
  "z U2 R U R U' R' U' R' U' R U'",
];

const OP_CORNER = "R U' R' U' R U R' F' R U R' U' R' F R";
const OP_EDGE = "R U R' U' R' F R2 U' R' U' R U R' F'";
const OP_PARITY = "R U R' F' R U2 R' U2 R' F R U R U2 R' U'";
const OP_EDGE_FLIP = "r U R' U' r' U2 R U R U' R2 U2 R";
const OP_ANTI_SEXY = "U R U' R' U R U' R'";
const OP_SEXY = "R U R' U' R U R' U'";

const EXTENSION_DATA: Record<Extract<DeckId, 'oh-oll' | 'oh-pll' | 'blindfold-op'>, CaseData[]> = {
  'oh-oll': OH_OLL_ALGORITHMS.map((algorithm, index) => generatedCase(`OH OLL ${index + 1}`, algorithm, 'Specialized one-handed variant')),
  'oh-pll': OH_PLL_ALGORITHMS.map((algorithm, index) => generatedCase(`OH PLL ${index + 1}`, algorithm, 'Specialized one-handed variant')),
  'blindfold-op': [
    generatedCase('OP corners · base swap', OP_CORNER, 'Corner buffer to swap piece'),
    generatedCase('OP edges · base swap', OP_EDGE, 'Edge buffer to swap piece'),
    generatedCase('OP corners · one-move setup', `R ${OP_CORNER} R'`, 'Setup, swap, undo'),
    generatedCase('OP corners · two-move setup', `R F ${OP_CORNER} F' R'`, 'Setup, swap, undo'),
    generatedCase('OP edges · setup drill', `F2 ${OP_EDGE} F2`, 'Setup, swap, undo'),
    generatedCase('OP edges · flip', OP_EDGE_FLIP, 'Flip the target edge pair'),
    generatedCase('OP corners · anti-sexy orientation', OP_ANTI_SEXY, 'Double Anti-Sexy'),
    generatedCase('OP corners · sexy orientation', OP_SEXY, 'Double Sexy'),
    generatedCase('OP · parity', OP_PARITY, 'Parity after edge execution'),
  ],
};

const DECK_ITEMS: Record<DeckId, CaseData[]> = {
  oll: data.oll,
  pll: data.pll,
  'pll-recognition': data.pll,
  f2l: data.f2l,
  'oh-oll': EXTENSION_DATA['oh-oll'],
  'oh-pll': EXTENSION_DATA['oh-pll'],
  'blindfold-op': EXTENSION_DATA['blindfold-op'],
};

const DECKS: Array<{
  id: DeckId;
  title: string;
  count: number;
  description: string;
}> = [
  { id: 'oll', title: 'OLL', count: 57, description: 'Orient the last layer.' },
  { id: 'pll', title: 'PLL', count: 21, description: 'Permute the last layer.' },
  { id: 'pll-recognition', title: 'PLL Recognition', count: 21, description: 'Name the PLL case.' },
  { id: 'f2l', title: 'F2L', count: 41, description: 'Solve the first two layers.' },
  { id: 'oh-oll', title: 'OH OLL', count: 8, description: 'One-handed OLL variants.' },
  { id: 'oh-pll', title: 'OH PLL', count: 10, description: 'One-handed PLL variants.' },
  { id: 'blindfold-op', title: 'Blindfolded · OP', count: 9, description: 'Old Pochmann drills.' },
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
  DECK_ITEMS[deck.id].forEach((item) => {
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

function caseSetup(item: CaseData) {
  return item.primary_setup?.setup ?? item.case_setup ?? invertAlgorithm(item.primary);
}

function moveClass(move: string) {
  const face = move[0]?.toUpperCase();
  if (face === 'R' || face === 'U') return 'move-trigger';
  if (face === 'M' || face === 'E' || face === 'S') return 'move-slice';
  if (move[0] && 'rlfbd'.includes(move[0])) return 'move-wide';
  if (move[0] && 'xyz'.includes(move[0])) return 'move-rotation';
  return 'move-face';
}

function algorithmGroups(algorithm: string) {
  return algorithm.match(/\([^)]*\)|[^\s]+/g)?.map((part) => ({
    grouped: part.startsWith('('),
    moves: part.replace(/[()]/g, '').split(/\s+/).filter(Boolean),
  })) ?? [];
}

function AlgorithmLine({ algorithm, compact = false }: { algorithm: Algorithm; compact?: boolean }) {
  return <code className={`algorithm-line ${compact ? 'compact' : ''}`} aria-label={algorithm.alg}>{algorithmGroups(algorithm.alg).map((group, groupIndex) => <span className={`move-group ${group.grouped ? 'grouped' : ''}`} key={`${groupIndex}-${group.moves.join('-')}`}>{group.moves.map((move, moveIndex) => <span className={`move-token ${moveClass(move)}`} key={`${move}-${moveIndex}`}>{move}</span>)}</span>)}</code>;
}

function MoveLegend() {
  return <div className="move-legend" aria-label="Move highlighting legend"><span><i className="move-key move-trigger" /> R/U trigger</span><span><i className="move-key move-face" /> face turn</span><span><i className="move-key move-slice" /> slice</span><span><i className="move-key move-rotation" /> rotation</span></div>;
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
      const setup = item.primary_setup ? `${caseSetup(item)} x2` : caseSetup(item);
      player = new TwistyPlayer({ puzzle: '3x3x3', experimentalSetupAlg: setup, visualization: '3D', background: 'none', controlPanel: 'none', backView: 'none', cameraLatitude: 24, cameraLongitude: 32, cameraDistance: 4.6 });
      player.style.width = '100%';
      player.style.height = '250px';
      player.setAttribute('aria-label', `${item.name} cube case`);
      hostRef.current.replaceChildren(player);
    }
    void mount();
    return () => { disposed = true; player?.remove(); };
  }, [item]);
  return <div className="cube-stage"><div ref={hostRef} className="cube-host" aria-live="polite"><div className="cube-loading">Loading case view…</div></div><span className="cube-caption">drag to inspect · {item.primary_setup ? 'yellow on top' : 'generated case view'}</span></div>;
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

function SetupPanel({ item }: { item: CaseData }) {
  return <section className="setup-panel" aria-label="Case setup"><div className="setup-heading"><span>Setup</span><span className="answer-rule" /></div><code>{caseSetup(item)}</code>{item.primary_setup?.auf && <span className="setup-auf">AUF: <code>{item.primary_setup.auf}</code></span>}<p>Apply this setup to a solved cube before starting the timer.</p></section>;
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
  const [highlighted, setHighlighted] = useState(true);
  return <section className="answer-panel" aria-label="Algorithm answer"><div className="answer-heading"><span>Algorithm</span><span className="answer-rule" /><button className="plain-toggle" onClick={() => setHighlighted((value) => !value)}>{highlighted ? 'Plain moves' : 'Highlight moves'}</button></div>{highlighted ? <AlgorithmLine algorithm={{ alg: item.primary, note: '' }} /> : <code className="algorithm-plain">{item.primary}</code>}{highlighted && <MoveLegend />}{alternates.length > 0 && <><button className="alternate-toggle" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {expanded ? 'Hide alternates' : `Show ${alternates.length} alternate${alternates.length === 1 ? '' : 's'}`}</button>{expanded && <div className="alternate-list">{alternates.map((algorithm, index) => <div key={`${algorithm.alg}-${index}`}><AlgorithmLine algorithm={algorithm} compact />{algorithm.note && <small>{algorithm.note}</small>}</div>)}</div>}</>}</section>;
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
  const choices = useMemo(() => { if (!isRecognition || !item) return []; return shuffleItems([item, ...shuffleItems(DECK_ITEMS.pll.filter((candidate) => candidate.name !== item.name)).slice(0, 3)]); }, [isRecognition, item]);
  const chooseRecognition = (name: string) => { setSelectedChoice(name); setAnswerShown(true); };
  if (!item) return <main className="page-shell"><p>No cards are available.</p></main>;

  return <main className="page-shell study-shell"><header className="study-header"><button className="back-button" onClick={onBack}><ArrowLeft size={16} /> <span>Decks</span></button><div className="study-title"><span>{title}</span><strong>{queueIndex + 1} / {queue.length}</strong></div><div className="study-actions"><span className={`mode-label ${mode}`}>{mode === 'shuffle' ? 'Shuffle' : 'Due review'}</span><button className="study-shuffle" onClick={onShuffle}><Shuffle size={14} /> Shuffle</button></div></header><div className="study-progress"><span style={{ width: `${(queueIndex / Math.max(queue.length, 1)) * 100}%` }} /></div>
    <section className="study-card"><div className="case-meta"><div><h1>{item.name}</h1></div><span className="case-count">{saved ? `reviewed ${saved.repetitions}×` : 'new card'}</span></div>
      <button className={`case-visual ${timerState}`} onPointerDown={onPressStart} onPointerUp={onPressEnd} onPointerCancel={() => { pointerStarted.current = false; if (timerState === 'armed') setTimerState('idle'); }} onKeyDown={onKeyDown} onKeyUp={onKeyUp} aria-label={timerState === 'running' ? 'Tap to stop the timer' : 'Hold and release to start the execution timer'}><div className="visual-frame">{deckId === 'oll' ? <OLLPattern item={item} /> : <><CubeView item={item} /><div className="visual-fallback"><StaticPattern item={item} /></div></>}</div><div className="timer-readout">{timerState === 'armed' && <span>Release to start</span>}{timerState === 'idle' && <span>Hold + release to start · tap to stop</span>}{timerState === 'running' && <strong>{formatTime(elapsed)}</strong>}{timerState === 'stopped' && <strong>{formatTime(elapsed)}</strong>}</div></button>
      <SetupPanel item={item} />
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
  const startStudy = useCallback((nextDeckId: DeckId, nextMode: SessionMode) => { const items = DECK_ITEMS[nextDeckId]; const now = Date.now(); const eligible = nextMode === 'shuffle' ? items : items.filter((item) => { const saved = progress[caseKey(nextDeckId, item)]; return !saved || saved.due <= now; }); const nextQueue = shuffleItems(eligible.length ? eligible : items); setDeckId(nextDeckId); setMode(nextMode); setQueue(nextQueue); setQueueIndex(0); currentRef.current = { deckId: nextDeckId, item: nextQueue[0] }; setView('study'); }, [progress]);
  const saveTime = useCallback((elapsed: number) => { const current = currentRef.current; if (!current.item) return; const key = caseKey(current.deckId, current.item); const existing = progress[key]; if (!existing || existing.bestTimeMs == null || elapsed < existing.bestTimeMs) persist({ ...progress, [key]: { ...(existing ?? { due: Date.now(), interval: 0, repetitions: 0 }), bestTimeMs: elapsed } }); }, [persist, progress]);
  const resetDeck = useCallback((nextDeckId: DeckId) => { const deck = DECKS.find((candidate) => candidate.id === nextDeckId); if (!deck || !window.confirm(`Reset all progress for ${deck.title}?`)) return; const prefix = `${nextDeckId}:`; const next = Object.fromEntries(Object.entries(progress).filter(([key]) => !key.startsWith(prefix))); persist(next); }, [persist, progress]);
  const advance = useCallback(() => { setQueueIndex((index) => { const nextIndex = index + 1; if (nextIndex >= queue.length) { setView('dashboard'); return index; } currentRef.current = { deckId, item: queue[nextIndex] }; return nextIndex; }); }, [deckId, queue]);
  const nextCard = useCallback(() => { advance(); }, [advance]);
  const grade = useCallback((rating: Rating, elapsed?: number) => { const current = currentRef.current; if (!current.item) return; const key = caseKey(current.deckId, current.item); persist({ ...progress, [key]: nextProgress(progress[key], rating, Date.now(), elapsed) }); window.setTimeout(advance, 0); }, [advance, persist, progress]);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { actionsRef.current = { start: startStudy, grade }; }, [grade, startStudy]);
  useEffect(() => { const context = document.modelContext; if (!context?.registerTool) return; const lifecycle = new AbortController(); const register = async () => { await context.registerTool({ name: 'read_cube_recall_decks', title: 'Read deck status', description: 'Read current New, Learning, and Due counts for all Cube Recall decks.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => DECKS.map((deck) => ({ deck: deck.title, ...countsFor(deck, progressRef.current) })) }, { signal: lifecycle.signal }); await context.registerTool({ name: 'start_cube_recall_session', title: 'Start study session', description: 'Start a due-review or shuffle session for any Cube Recall algorithm or recognition deck.', inputSchema: { type: 'object', properties: { deckId: { type: 'string', enum: ['oll', 'pll', 'pll-recognition', 'f2l', 'oh-oll', 'oh-pll', 'blindfold-op'] }, mode: { type: 'string', enum: ['due', 'shuffle'] } }, required: ['deckId', 'mode'], additionalProperties: false }, execute: (input) => { const value = input as { deckId?: DeckId; mode?: SessionMode }; if (!value.deckId || !value.mode || !DECKS.some((deck) => deck.id === value.deckId)) throw new Error('Invalid deck or mode'); actionsRef.current.start(value.deckId, value.mode); return { started: true, deckId: value.deckId, mode: value.mode }; } }, { signal: lifecycle.signal }); await context.registerTool({ name: 'rate_cube_recall_card', title: 'Rate current card', description: 'Rate the visible Cube Recall card as Again, Hard, Good, or Easy.', inputSchema: { type: 'object', properties: { rating: { type: 'string', enum: ['again', 'hard', 'good', 'easy'] } }, required: ['rating'], additionalProperties: false }, execute: (input) => { const value = input as { rating?: Rating }; if (!value.rating || !RATING_LABELS.some((rating) => rating.id === value.rating)) throw new Error('Invalid rating'); actionsRef.current.grade(value.rating); return { rated: true, rating: value.rating }; } }, { signal: lifecycle.signal }); }; void register(); return () => lifecycle.abort(); }, []);
  if (view === 'study') return <StudyView key={`${deckId}:${queueIndex}`} deckId={deckId} queue={queue} queueIndex={queueIndex} mode={mode} progress={progress} onBack={() => setView('dashboard')} onShuffle={() => startStudy(deckId, 'shuffle')} onNext={nextCard} onGrade={grade} onSaveTime={saveTime} />;
  return <DeckDashboard progress={progress} onStart={startStudy} onReset={resetDeck} />;
}

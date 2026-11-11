import { useMemo, useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { QRCodeSVG } from 'qrcode.react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend
} from 'chart.js';
import {
  DEFAULT_SETTINGS, PLAYER_COUNTS, MAX_HATH, computeRound, computeRounds, computeRunningTotals, computeStandings,
  computeTotals, formatPoints, multiplierFor, nextMultiplier, normalizeSettings, triggersDouble, validateRound, validateSetup
} from './scoring';
import { buildInviteUrl, parseSessionCode } from './invite';
import { computeAllTime, computePlayerStats, summarizeGame } from './stats';
import { csvFileName, gameToCsv, standingsText, whatsappUrl } from './export';
import { isCompleteHath, stepValue } from './entry';
import './App.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const WS_URL = process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:3001`;
const STORAGE_KEY = 'marriage_session';
const PLAYER_COLORS = ['#d1495b', '#00798c', '#edae49', '#30638e', '#6a994e', '#8e5572', '#f4845f', '#5f6caf', '#2a9d8f', '#7a5c3e'];
const DEFAULT_PLAYERS = ['Aakash', 'Shreya', 'Aryan', 'Paa'];

function setAddressSession(code) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('session', code);
  else url.searchParams.delete('session');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function downloadText(fileName, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function focusNextEntry(current, form) {
  const fields = Array.from(form.querySelectorAll('input[data-entry]:not(:disabled)'));
  const index = fields.indexOf(current);
  if (index >= 0 && index < fields.length - 1) {
    fields[index + 1].focus();
    fields[index + 1].select();
    return true;
  }
  return false;
}

function PointStepper({ id, label, value, onChange, max, disabled, placeholder, onKeyDown, onFocus }) {
  return (
    <div className="stepper">
      <button type="button" className="step-btn" tabIndex={-1} aria-label={`Decrease ${label}`}
        disabled={disabled} onClick={() => onChange(stepValue(value ?? '', -1, 0, max))}>−</button>
      <input
        id={id}
        data-entry=""
        className="point-input"
        type="number"
        inputMode="numeric"
        enterKeyHint="next"
        min="0"
        max={max}
        step="1"
        placeholder={placeholder}
        value={value ?? ''}
        disabled={disabled}
        onChange={event => onChange(event.target.value, event.target)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        aria-label={label}
      />
      <button type="button" className="step-btn" tabIndex={-1} aria-label={`Increase ${label}`}
        disabled={disabled} onClick={() => onChange(stepValue(value ?? '', 1, 0, max))}>+</button>
    </div>
  );
}

function InviteCard({ code, inviteInfo, expanded, onToggle }) {
  const [copyMessage, setCopyMessage] = useState('');
  useEffect(() => setCopyMessage(''), [code]);
  const addresses = inviteInfo?.addresses?.length
    ? inviteInfo.addresses
    : inviteInfo?.ip ? [inviteInfo.ip] : [];
  const inviteUrls = inviteInfo ? (addresses.length ? addresses : [null]).map(address => buildInviteUrl({
    hostname: window.location.hostname,
    port: window.location.port,
    protocol: window.location.protocol,
    lanIp: address,
    code
  })) : [];
  const inviteUrl = inviteUrls[0] || '';

  const copyInvite = async () => {
    if (!inviteUrl) return;
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(inviteUrl);
        copied = true;
      } catch (error) {
        copied = false;
      }
    }
    if (!copied) {
      const field = document.createElement('textarea');
      field.value = inviteUrl;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
      document.body.removeChild(field);
    }
    setCopyMessage(copied ? 'Invite link copied' : 'Select and copy the link above');
  };

  return (
    <section className="invite-card" aria-labelledby="invite-heading">
      <div className="invite-heading-row">
        <div>
          <h2 id="invite-heading">Invite players</h2>
          <p>Share this link or scan the QR code to join session <strong>{code}</strong>.</p>
        </div>
        <button type="button" className="qr-toggle" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? 'Hide QR' : 'Show QR'}
        </button>
      </div>
      <div className="invite-link-row">
        <input aria-label="Session invite link" value={inviteUrl || 'Detecting network address…'} readOnly onFocus={event => event.target.select()} />
        <button type="button" onClick={copyInvite} disabled={!inviteUrl}>Copy link</button>
      </div>
      {copyMessage && <p className="copy-message" role="status">{copyMessage}</p>}
      {inviteInfo?.unavailable && <p className="invite-note">LAN address unavailable; this link uses the current address and may only work on this device.</p>}
      {inviteUrls.length > 1 && (
        <details className="alternate-invites">
          <summary>Other network addresses</summary>
          {inviteUrls.slice(1).map(url => <a href={url} key={url}>{url}</a>)}
        </details>
      )}
      {expanded && (
        <div className="invite-qr" aria-label="QR code for session invite">
          {inviteUrl ? <QRCodeSVG value={inviteUrl} size={156} level="M" includeMargin /> : <span>Detecting link…</span>}
        </div>
      )}
    </section>
  );
}

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [players, setPlayers] = useState(DEFAULT_PLAYERS);
  const [settings, setSettings] = useState(() => normalizeSettings(DEFAULT_SETTINGS));
  const [rounds, setRounds] = useState([]);
  const [canUndo, setCanUndo] = useState(false);
  const [games, setGames] = useState([]);
  const [shareMessage, setShareMessage] = useState('');
  const [bandh, setBandh] = useState('');
  const [hathInputs, setHathInputs] = useState({});
  const [jokerInputs, setJokerInputs] = useState({});
  const [roundError, setRoundError] = useState('');
  const [editingRound, setEditingRound] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [draftPlayers, setDraftPlayers] = useState(DEFAULT_PLAYERS);
  const [setupError, setSetupError] = useState('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [inviteInfo, setInviteInfo] = useState(null);
  const [showQr, setShowQr] = useState(() => window.matchMedia?.('(max-width: 700px)').matches || false);
  const wsRef = useRef(null);
  const formRef = useRef(null);
  const savedSessionRef = useRef(null);
  const pendingInviteRef = useRef(false);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer;
    const inviteCode = parseSessionCode(window.location.search);
    pendingInviteRef.current = Boolean(inviteCode);
    savedSessionRef.current = inviteCode || localStorage.getItem(STORAGE_KEY);

    function applyGameState(msg) {
      setPlayers(msg.players);
      setSettings(normalizeSettings(msg.settings));
      setRounds(msg.rounds);
      setGames(Array.isArray(msg.games) ? msg.games : []);
      setCanUndo(Boolean(msg.canUndo));
    }

    function enterSession(msg) {
      localStorage.setItem(STORAGE_KEY, msg.sessionId);
      savedSessionRef.current = msg.sessionId;
      pendingInviteRef.current = false;
      setAddressSession(msg.sessionId);
      setSessionId(msg.sessionId);
      applyGameState(msg);
      setDraftPlayers(msg.players);
      setSetupError('');
      setSetupOpen(msg.rounds.length === 0);
      setLoading(false);
    }

    function connect() {
      if (stopped) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (stopped) return;
        setConnected(true);
        if (savedSessionRef.current) {
          ws.send(JSON.stringify({ type: 'join_session', sessionId: savedSessionRef.current }));
        } else {
          setLoading(false);
        }
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'session_created':
          case 'session_joined':
            enterSession(msg);
            break;
          case 'session_update':
            applyGameState(msg);
            setEditingRound(current => (current !== null && current >= msg.rounds.length ? null : current));
            break;
          case 'update_rejected':
            setRoundError(msg.message);
            break;
          case 'error':
            setSessionError(pendingInviteRef.current
              ? 'This invite link is no longer active. Ask the host to create a new session.'
              : msg.message);
            if (pendingInviteRef.current) setAddressSession(null);
            pendingInviteRef.current = false;
            localStorage.removeItem(STORAGE_KEY);
            savedSessionRef.current = null;
            setSessionId(null);
            setLoading(false);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setConnected(false);
        setLoading(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        setConnected(false);
        setLoading(false);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setInviteInfo(null);
      return undefined;
    }
    let cancelled = false;
    const infoUrl = new URL(WS_URL.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'));
    infoUrl.pathname = '/api/info';
    infoUrl.search = '';
    fetch(infoUrl.toString())
      .then(response => {
        if (!response.ok) throw new Error('Network info unavailable');
        return response.json();
      })
      .then(info => {
        if (!cancelled) setInviteInfo({ ...info, unavailable: !info.addresses?.length });
      })
      .catch(() => {
        if (!cancelled) setInviteInfo({ ip: null, addresses: [], unavailable: true });
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  const canSend = (setError) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Disconnected from the game server. Reconnecting…');
      return false;
    }
    return true;
  };

  const sendGame = (next, setError) => {
    if (!canSend(setError)) return false;
    wsRef.current.send(JSON.stringify({
      type: 'update_game', sessionId, players: next.players, settings: next.settings, rounds: next.rounds
    }));
    setPlayers(next.players);
    setSettings(next.settings);
    setRounds(next.rounds);
    setCanUndo(true);
    return true;
  };

  // ---- round form ----
  const resetRoundForm = () => {
    setBandh('');
    setHathInputs({});
    setJokerInputs({});
    setRoundError('');
  };

  const handleHathChange = (player, value, input) => {
    if (/^\d*$/.test(value)) {
      setHathInputs(previous => ({ ...previous, [player]: value }));
      setRoundError('');
      if (input && isCompleteHath(value)) focusNextEntry(input, input.form);
    }
  };

  const handleJokerChange = (player, value) => {
    if (/^\d*$/.test(value)) {
      setJokerInputs(previous => ({ ...previous, [player]: value }));
      setRoundError('');
    }
  };

  const handleBandhChange = (player) => {
    setBandh(current => (current === player ? '' : player));
    setHathInputs(previous => ({ ...previous, [player]: '' }));
    setRoundError('');
  };

  const draftRound = {
    entries: players.map(player => ({
      player,
      bandh: bandh === player,
      hath: bandh === player || !hathInputs[player] ? 0 : Number(hathInputs[player]),
      joker: jokerInputs[player] ? Number(jokerInputs[player]) : 0
    }))
  };
  const draftMultiplier = editingRound !== null ? multiplierFor(rounds, editingRound) : nextMultiplier(rounds);
  const draftError = validateRound(players, draftRound);
  const preview = draftError ? null : computeRound(draftRound, draftMultiplier);
  const totalJokerInput = draftRound.entries.reduce((sum, entry) => sum + entry.joker, 0);
  const draftTriggersDouble = triggersDouble(draftRound);

  const handleRoundSubmit = (event) => {
    event.preventDefault();
    if (draftError) {
      setRoundError(draftError);
      return;
    }
    const newRounds = editingRound !== null
      ? rounds.map((round, index) => (index === editingRound ? draftRound : round))
      : [...rounds, draftRound];
    if (!sendGame({ players, settings, rounds: newRounds }, setRoundError)) return;
    setEditingRound(null);
    resetRoundForm();
  };

  const handleEditRound = (roundIndex) => {
    if (editingRound === roundIndex) {
      setEditingRound(null);
      resetRoundForm();
      return;
    }
    const round = rounds[roundIndex];
    const nextHath = {};
    const nextJoker = {};
    let nextBandh = '';
    round.entries.forEach(item => {
      if (item.bandh) nextBandh = item.player;
      nextHath[item.player] = item.bandh ? '' : String(item.hath);
      nextJoker[item.player] = String(item.joker);
    });
    setEditingRound(roundIndex);
    setBandh(nextBandh);
    setHathInputs(nextHath);
    setJokerInputs(nextJoker);
    setRoundError('');
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const handleDeleteRound = (roundIndex) => {
    if (!window.confirm(`Delete round ${roundIndex + 1}? You can undo this.`)) return;
    const newRounds = rounds.filter((_, index) => index !== roundIndex);
    if (!sendGame({ players, settings, rounds: newRounds }, setRoundError)) return;
    setEditingRound(null);
    resetRoundForm();
  };

  const handleEntryKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!focusNextEntry(event.target, event.target.form)) event.target.form.requestSubmit();
  };
  const handleEntryFocus = (event) => event.target.select();

  const handleUndo = () => {
    if (!canUndo || !canSend(setRoundError)) return;
    wsRef.current.send(JSON.stringify({ type: 'undo', sessionId }));
    setEditingRound(null);
    resetRoundForm();
  };

  const handleFinishGame = () => {
    if (!rounds.length) return;
    if (!window.confirm(`Finish this game after ${rounds.length} ${rounds.length === 1 ? 'round' : 'rounds'}? It moves to Past games and a new game starts with the same players. You can undo this.`)) return;
    if (!canSend(setRoundError)) return;
    wsRef.current.send(JSON.stringify({ type: 'finish_game', sessionId }));
    setEditingRound(null);
    resetRoundForm();
  };

  const handleDeleteGame = (index) => {
    if (!window.confirm('Delete this past game? You can undo this.')) return;
    if (!canSend(setRoundError)) return;
    wsRef.current.send(JSON.stringify({ type: 'delete_game', sessionId, index }));
  };

  // ---- setup ----
  const playersLocked = rounds.length > 0;

  const openSetup = () => {
    setDraftPlayers(players);
    setSetupError('');
    setSetupOpen(true);
  };
  const toggleSetup = () => (setupOpen ? setSetupOpen(false) : openSetup());

  const handleDraftPlayerChange = (index, value) => {
    setDraftPlayers(previous => previous.map((name, i) => (i === index ? value : name)));
    setSetupError('');
  };
  const handleModeChange = (count) => {
    setDraftPlayers(previous => {
      if (count === previous.length) return previous;
      if (count < previous.length) return previous.slice(0, count);
      const usesPaa = previous.some(name => name.trim().toLowerCase() === 'paa');
      return [...previous, usesPaa ? 'Player 4' : 'Paa'];
    });
    setSetupError('');
  };

  const handleSetupSave = (event) => {
    event.preventDefault();
    const nextPlayers = playersLocked ? players : draftPlayers.map(name => name.trim());
    const error = validateSetup(nextPlayers);
    if (error) {
      setSetupError(error);
      return;
    }
    if (!sendGame({ players: nextPlayers, settings, rounds }, setSetupError)) return;
    setSetupOpen(false);
    if (!playersLocked) resetRoundForm();
  };

  // ---- lobby ----
  const handleCreateSession = () => {
    if (!connected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setSessionError('Not connected to server. Make sure the server is running.');
      return;
    }
    setSessionError('');
    wsRef.current.send(JSON.stringify({ type: 'create_session' }));
  };

  const handleJoinSession = () => {
    if (!connected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setSessionError('Not connected to server. Make sure the server is running.');
      return;
    }
    if (!joinCode.trim()) {
      setSessionError('Please enter a session code');
      return;
    }
    setSessionError('');
    wsRef.current.send(JSON.stringify({ type: 'join_session', sessionId: joinCode.trim().toUpperCase() }));
  };

  const handleNewGame = () => {
    localStorage.removeItem(STORAGE_KEY);
    setAddressSession(null);
    savedSessionRef.current = null;
    pendingInviteRef.current = false;
    setSessionId(null);
    setRounds([]);
    setGames([]);
    setCanUndo(false);
    resetRoundForm();
    setEditingRound(null);
    setSetupOpen(false);
    setJoinCode('');
    setSessionError('');
    setLoading(false);
  };

  // ---- derived ----
  const roundResults = useMemo(() => computeRounds(rounds), [rounds]);
  const runningTotals = useMemo(() => computeRunningTotals(rounds, players), [rounds, players]);
  const totals = useMemo(() => computeTotals(rounds, players), [rounds, players]);
  const standings = useMemo(() => computeStandings(totals, players), [totals, players]);
  const leaders = new Set(rounds.length ? standings.filter(row => row.rank === 1).map(row => row.player) : []);
  const playerStats = useMemo(() => computePlayerStats(rounds, players), [rounds, players]);
  const pastGames = useMemo(() => games.map((game, index) => ({ ...summarizeGame(game), index })).reverse(), [games]);
  const allTime = useMemo(() => computeAllTime(games), [games]);
  const shareText = standingsText(players, rounds, sessionId);
  const handleShare = async () => {
    setShareMessage('');
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Marriage Score Card', text: shareText });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    window.open(whatsappUrl(shareText), '_blank', 'noopener');
  };
  const handleDownloadCsv = () => {
    downloadText(csvFileName(new Date()), gameToCsv(players, rounds));
    setShareMessage('Score sheet downloaded.');
  };
  const handleDownloadGameCsv = (game) => downloadText(csvFileName(game.finishedAt), gameToCsv(game.players, game.rounds));

  const chartData = useMemo(() => ({
    labels: ['Start', ...rounds.map((_, index) => `R${index + 1}`)],
    datasets: players.map((player, index) => ({
      label: player,
      data: [0, ...runningTotals.map(row => row[player] || 0)],
      borderColor: PLAYER_COLORS[index % PLAYER_COLORS.length],
      backgroundColor: PLAYER_COLORS[index % PLAYER_COLORS.length],
      tension: 0.15,
      pointRadius: rounds.length > 12 ? 1 : 2,
      pointHoverRadius: 5,
      borderWidth: 2
    }))
  }), [rounds, players, runningTotals]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 10, font: { size: 11 } }
      },
      title: { display: false },
      tooltip: { intersect: false, mode: 'index' }
    },
    scales: {
      x: { ticks: { autoSkip: true, autoSkipPadding: 12, maxRotation: 0, font: { size: 10 } } },
      y: { grace: '8%', ticks: { precision: 0, maxTicksLimit: 5 } }
    }
  }), []);

  if (loading) {
    return <div className="App loading-screen"><h1>Marriage Score Card</h1><p>Loading…</p></div>;
  }

  if (!sessionId) {
    return (
      <main className="App session-screen">
        <h1>Marriage Score Card</h1>
        <p className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Disconnected — make sure the server is running'}
        </p>
        <div className="session-actions"><button onClick={handleCreateSession}>Create New Session</button></div>
        <div className="session-join">
          <h2>Join Existing Session</h2>
          <input
            type="text"
            aria-label="Session code"
            placeholder="Enter session code (e.g., MG-1234)"
            value={joinCode}
            onChange={event => { setJoinCode(event.target.value); setSessionError(''); }}
          />
          <button onClick={handleJoinSession}>Join</button>
          {sessionError && <p className="error" role="alert">{sessionError}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="App">
      <div className="session-header">
        <span className="session-code">Session: <strong>{sessionId}</strong></span>
        <span className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}>
          <span className="connection-dot" aria-hidden="true" />{connected ? 'Connected' : 'Reconnecting'}
        </span>
        <div className="header-actions">
          <button type="button" className="undo-btn" onClick={handleUndo} disabled={!canUndo}>Undo</button>
          <button type="button" className="new-game-btn" onClick={handleNewGame}>New Game</button>
        </div>
      </div>

      <h1>Marriage Score Card</h1>
      <InviteCard code={sessionId} inviteInfo={inviteInfo} expanded={showQr} onToggle={() => setShowQr(expanded => !expanded)} />

      <section className="setup-card" aria-labelledby="setup-heading">
        <div className="setup-heading-row">
          <h2 id="setup-heading">Game setup</h2>
          <button type="button" className="secondary-btn" onClick={toggleSetup} aria-expanded={setupOpen}>
            {setupOpen ? 'Close' : 'Edit setup'}
          </button>
        </div>
        {!setupOpen && (
          <p className="setup-summary">
            {players.length} players · Hath max {MAX_HATH} · Joker of 20 or more doubles the next round
          </p>
        )}
        {setupOpen && (
          <form className="setup-form" onSubmit={handleSetupSave} noValidate>
            <fieldset>
              <legend>Players</legend>
              <div className="status-group" role="radiogroup" aria-label="Game mode">
                {PLAYER_COUNTS.map(count => (
                  <label key={count} className="status-option">
                    <input type="radio" name="game-mode" value={count} checked={draftPlayers.length === count}
                      disabled={playersLocked} onChange={() => handleModeChange(count)} />
                    <span>{count} players</span>
                  </label>
                ))}
              </div>
              {draftPlayers.map((name, index) => (
                <div className="setup-player-row" key={index}>
                  <input
                    type="text"
                    aria-label={`Player ${index + 1} name`}
                    value={name}
                    maxLength={20}
                    disabled={playersLocked}
                    onChange={event => handleDraftPlayerChange(index, event.target.value)}
                  />
                </div>
              ))}
              {playersLocked && <p className="setup-note">Players are locked once rounds exist. Start a new game to change players.</p>}
            </fieldset>
            {setupError && <p className="error" role="alert">{setupError}</p>}
            <div className="setup-footer"><button type="submit">Save setup</button></div>
          </form>
        )}
      </section>

      <section className="score-input" aria-labelledby="round-entry-heading" ref={formRef}>
        <h2 id="round-entry-heading">
          {editingRound !== null ? `Edit Round ${editingRound + 1}` : `Enter Round ${rounds.length + 1}`}
        </h2>
        <form onSubmit={handleRoundSubmit} noValidate>
          {draftMultiplier === 2 && (
            <p className="double-banner" role="status">Double round — last round had 20 or more joker points. All points ×2.</p>
          )}
          <div className="player-entry-list">
            {players.map((player, index) => {
              const isCloser = bandh === player;
              return (
                <div key={player} className={`player-score ${isCloser ? 'is-winner' : ''}`}>
                  <label className="share-label" htmlFor={`hath-${index}`}>{player}</label>
                  <label className="bandh-option">
                    <input type="checkbox" checked={isCloser} aria-label={`${player} closed the Bandh`}
                      onChange={() => handleBandhChange(player)} />
                    <span>Bandh</span>
                  </label>
                  <div className="points-pair">
                    <label htmlFor={`hath-${index}`}>
                      Hath
                      <PointStepper
                        id={`hath-${index}`}
                        label={`${player} hath points`}
                        value={isCloser ? '' : hathInputs[player]}
                        max={MAX_HATH}
                        disabled={isCloser}
                        placeholder={isCloser ? '—' : '0'}
                        onChange={(value, input) => handleHathChange(player, value, input)}
                        onKeyDown={handleEntryKeyDown}
                        onFocus={handleEntryFocus}
                      />
                    </label>
                    <label htmlFor={`joker-${index}`}>
                      Joker
                      <PointStepper
                        id={`joker-${index}`}
                        label={`${player} joker points`}
                        value={jokerInputs[player]}
                        placeholder="0"
                        onChange={value => handleJokerChange(player, value)}
                        onKeyDown={handleEntryKeyDown}
                        onFocus={handleEntryFocus}
                      />
                    </label>
                  </div>
                  <output className={`resolved-preview ${preview ? 'adjusted' : ''}`}>
                    {preview
                      ? `Hath ${formatPoints(preview.hath[player])} · Joker ${formatPoints(preview.joker[player])} · Total ${formatPoints(preview.nets[player])}`
                      : 'Total: —'}
                  </output>
                </div>
              );
            })}
          </div>
          <div className="round-form-footer">
            <p className="points-counter">Total joker {totalJokerInput}{draftTriggersDouble ? ' · Next round will be doubled' : ''}</p>
            {roundError && <p className="error" role="alert">{roundError}</p>}
            {editingRound !== null && (
              <button type="button" className="secondary-btn" onClick={() => handleEditRound(editingRound)}>Cancel edit</button>
            )}
            <button type="submit">{editingRound !== null ? 'Save Round' : 'Submit Round'}</button>
          </div>
        </form>
      </section>

      <section className="standings" aria-label="Current standings">
        <h2>Standings <span>· highest score leads</span></h2>
        <div className="standing-chips">
          {standings.map(row => (
            <div className={`standing-chip ${leaders.has(row.player) ? 'leader' : ''}`} key={row.player}>
              <span className="standing-rank">#{row.rank}</span>
              <span>{row.player}</span>
              <strong>{formatPoints(row.total)}</strong>
            </div>
          ))}
        </div>
        <div className="standings-actions">
          <button type="button" className="secondary-btn" onClick={handleShare} disabled={!rounds.length}>Share</button>
          <a className={`secondary-btn whatsapp-link ${rounds.length ? '' : 'is-disabled'}`}
            href={rounds.length ? whatsappUrl(shareText) : undefined} target="_blank" rel="noreferrer"
            aria-disabled={!rounds.length}>WhatsApp</a>
          <button type="button" className="secondary-btn" onClick={handleDownloadCsv} disabled={!rounds.length}>Download CSV</button>
          <button type="button" className="finish-btn" onClick={handleFinishGame} disabled={!rounds.length}>Finish game</button>
        </div>
        {shareMessage && <p className="copy-message" role="status">{shareMessage}</p>}
      </section>

      {rounds.length > 0 && (
        <>
          <section className="score-graph" aria-label="Cumulative score graph">
            <h2>Score Progress</h2>
            <div className="chart-container"><Line options={chartOptions} data={chartData} /></div>
          </section>

          <section className="score-table">
            <h2>Round History</h2>
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Round-by-round nets and running totals</caption>
                <thead>
                  <tr>
                    <th scope="col">Round</th>
                    <th scope="col" className="col-meta">Bandh</th>
                    <th scope="col" className="col-meta">×</th>
                    {players.map(player => <th scope="col" key={player}>{player}</th>)}
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((round, roundIndex) => {
                    const result = roundResults[roundIndex];
                    return (
                      <tr key={roundIndex} className={editingRound === roundIndex ? 'editing' : ''}>
                        <th scope="row">
                          {roundIndex + 1}
                          <span className="round-meta">{result.closer ?? '—'}{result.multiplier === 2 ? ' · ×2' : ''}</span>
                        </th>
                        <td className="col-meta">{result.closer ?? '—'}</td>
                        <td className="col-meta">{result.multiplier === 2 ? '×2' : ''}</td>
                        {players.map(player => {
                          const net = result.nets[player] ?? 0;
                          return (
                            <td key={player} className={player === result.closer ? 'winner-cell' : ''}>
                              <span className={net < 0 ? 'negative-score' : ''}>{formatPoints(net)}</span>
                              <span className="score-badge"><span>H {formatPoints(result.hath[player])}</span> <span>J {formatPoints(result.joker[player])}</span></span>
                              <span className="running-total">Σ {formatPoints(runningTotals[roundIndex][player])}</span>
                            </td>
                          );
                        })}
                        <td className="row-actions">
                          <button type="button" className="edit-btn" onClick={() => handleEditRound(roundIndex)}>
                            {editingRound === roundIndex ? 'Cancel' : 'Edit'}
                          </button>
                          <button type="button" className="delete-btn" onClick={() => handleDeleteRound(roundIndex)}>Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="total-row">
                    <th scope="row">Total</th>
                    <td className="col-meta">—</td>
                    <td className="col-meta">—</td>
                    {players.map(player => (
                      <td className={totals[player] < 0 ? 'negative-score' : ''} key={player}>
                        <strong>{formatPoints(totals[player])}</strong>
                        {leaders.has(player) && <span className="leader-badge">Leading</span>}
                      </td>
                    ))}
                    <td>—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="score-table stats-table" aria-labelledby="stats-heading">
            <h2 id="stats-heading">Player Stats</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Stat</th>
                    {players.map(player => <th scope="col" key={player}>{player}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Total', row => formatPoints(row.total)],
                    ['Bandh closed', row => row.bandhs],
                    ['Hath points', row => formatPoints(row.hathPoints)],
                    ['Joker points', row => formatPoints(row.jokerPoints)],
                    ['Best round', row => (row.best === null ? '—' : formatPoints(row.best))],
                    ['Worst round', row => (row.worst === null ? '—' : formatPoints(row.worst))],
                    ['Doubles triggered', row => row.doublesTriggered]
                  ].map(([label, render]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {playerStats.map(row => <td key={row.player}>{render(row)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {games.length > 0 && (
        <section className="score-table past-games" aria-labelledby="past-games-heading">
          <h2 id="past-games-heading">Past Games</h2>
          <h3 className="subheading">All-time leaderboard</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col">Games</th>
                  <th scope="col">Wins</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {allTime.map(row => (
                  <tr key={row.player}>
                    <td>{row.rank}</td>
                    <th scope="row">{row.player}</th>
                    <td>{row.games}</td>
                    <td>{row.wins}</td>
                    <td className={row.total < 0 ? 'negative-score' : ''}>{formatPoints(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="subheading">Finished games</h3>
          <ul className="past-game-list">
            {pastGames.map(game => (
              <li key={`${game.finishedAt}-${game.index}`} className="past-game">
                <div className="past-game-head">
                  <strong>{new Date(game.finishedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</strong>
                  <span>{game.roundCount} {game.roundCount === 1 ? 'round' : 'rounds'} · Winner: {game.winners.join(', ')}</span>
                </div>
                <div className="past-game-scores">
                  {game.standings.map(row => (
                    <span key={row.player} className={row.total < 0 ? 'negative-score' : ''}>{row.player} {formatPoints(row.total)}</span>
                  ))}
                </div>
                <div className="past-game-actions">
                  <button type="button" className="secondary-btn" onClick={() => handleDownloadGameCsv(games[game.index])}>CSV</button>
                  <button type="button" className="delete-btn" onClick={() => handleDeleteGame(game.index)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default App;

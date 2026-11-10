import { useMemo, useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { computeTotals, getAdjustment, getResolvedScore, validateRound } from './scoring';
import './App.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const WS_URL = process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:3001`;
const PLAYER_COLORS = ['#d1495b', '#00798c', '#edae49', '#30638e', '#6a994e'];

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [players, setPlayers] = useState(['Aakash', 'Shreya', 'Aryan', 'Paa', 'Maa']);
  const [scores, setScores] = useState([]);
  const [currentRoundScores, setCurrentRoundScores] = useState({});
  const [roundFlags, setRoundFlags] = useState({});
  const [roundError, setRoundError] = useState('');
  const [editingRound, setEditingRound] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const savedSessionRef = useRef(null);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer;
    savedSessionRef.current = localStorage.getItem('begamchor_session');

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
            localStorage.setItem('begamchor_session', msg.sessionId);
            savedSessionRef.current = msg.sessionId;
            setSessionId(msg.sessionId);
            setPlayers(msg.players);
            setScores(msg.scores);
            setLoading(false);
            break;
          case 'session_joined':
            setSessionId(msg.sessionId);
            setPlayers(msg.players);
            setScores(msg.scores);
            setLoading(false);
            break;
          case 'session_update':
            setPlayers(msg.players);
            setScores(msg.scores);
            break;
          case 'error':
            setSessionError(msg.message);
            localStorage.removeItem('begamchor_session');
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

  const canSend = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setRoundError('Disconnected from the game server. Reconnecting…');
      return false;
    }
    return true;
  };

  const distributedPoints = players.reduce((sum, player) => {
    const value = currentRoundScores[player];
    return sum + (value === '' || value === undefined ? 0 : Number(value));
  }, 0);

  const handleScoreChange = (player, score) => {
    if (score === '' || (/^\d+$/.test(score) && Number(score) <= 25)) {
      setCurrentRoundScores(previous => ({ ...previous, [player]: score }));
      setRoundError('');
    }
  };

  const handleFlagChange = (player, flag, checked) => {
    setRoundFlags(previous => ({
      ...previous,
      [player]: { ...(previous[player] || {}), [flag]: checked }
    }));
    setRoundError('');
  };

  const resetRoundForm = () => {
    setCurrentRoundScores({});
    setRoundFlags({});
    setRoundError('');
  };

  const handleScoreSubmit = (event) => {
    event.preventDefault();
    const validationError = validateRound(players, currentRoundScores);
    if (validationError) {
      setRoundError(validationError);
      return;
    }
    if (!canSend()) return;

    const roundScores = players.map(player => ({
      player,
      score: Number(currentRoundScores[player]),
      noHands: Boolean(roundFlags[player]?.noHands),
      committed: Boolean(roundFlags[player]?.committed)
    }));

    const newScores = editingRound !== null
      ? scores.map((round, index) => index === editingRound ? roundScores : round)
      : [...scores, roundScores];

    wsRef.current.send(JSON.stringify({ type: 'update_scores', sessionId, players, scores: newScores }));
    setScores(newScores);
    setEditingRound(null);
    resetRoundForm();
  };

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
    localStorage.removeItem('begamchor_session');
    savedSessionRef.current = null;
    setSessionId(null);
    setScores([]);
    resetRoundForm();
    setEditingRound(null);
    setJoinCode('');
    setSessionError('');
    setLoading(false);
  };

  const handleEditRound = (roundScores, roundIndex) => {
    if (editingRound === roundIndex) {
      setEditingRound(null);
      resetRoundForm();
      return;
    }
    const scoreValues = {};
    const flags = {};
    roundScores.forEach(entry => {
      const hasFlags = typeof entry.noHands === 'boolean' || typeof entry.committed === 'boolean';
      const legacyNoHands = !hasFlags && Number(entry.score) === -5;
      scoreValues[entry.player] = legacyNoHands ? '0' : String(entry.score);
      flags[entry.player] = {
        noHands: hasFlags ? Boolean(entry.noHands) : legacyNoHands,
        committed: hasFlags ? Boolean(entry.committed) : false
      };
    });
    setEditingRound(roundIndex);
    setCurrentRoundScores(scoreValues);
    setRoundFlags(flags);
    setRoundError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const totals = useMemo(() => computeTotals(scores, players), [scores, players]);
  const lowestTotal = players.length ? Math.min(...players.map(player => totals[player] || 0)) : 0;

  const chartData = useMemo(() => {
    const labels = scores.map((_, index) => index === 0 ? 'Start' : `R${index}`);
    const datasets = players.map((player, index) => {
      let cumulative = 0;
      return {
        label: player,
        data: scores.map(round => {
          const entry = round.find(score => score.player === player);
          cumulative += entry ? getResolvedScore(entry) : 0;
          return cumulative;
        }),
        borderColor: PLAYER_COLORS[index % PLAYER_COLORS.length],
        backgroundColor: PLAYER_COLORS[index % PLAYER_COLORS.length],
        tension: 0.15,
        pointRadius: scores.length > 12 ? 1 : 2,
        pointHoverRadius: 5,
        borderWidth: 2
      };
    });
    return { labels, datasets };
  }, [scores, players]);

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
    return <div className="App loading-screen"><h1>Begam Chor Score Card</h1><p>Loading…</p></div>;
  }

  if (!sessionId) {
    return (
      <main className="App session-screen">
        <h1>Begam Chor Score Card</h1>
        <p className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Disconnected — make sure the server is running'}
        </p>
        <div className="session-actions"><button onClick={handleCreateSession}>Create New Session</button></div>
        <div className="session-join">
          <h2>Join Existing Session</h2>
          <input
            type="text"
            aria-label="Session code"
            placeholder="Enter session code (e.g., BC-1234)"
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
        <button className="new-game-btn" onClick={handleNewGame}>New Game</button>
      </div>

      <h1>Begam Chor Score Card</h1>

      <section className="score-input" aria-labelledby="round-entry-heading">
        <h2 id="round-entry-heading">
          {editingRound !== null ? `Edit Round ${editingRound}` : `Enter Round ${scores.length}`}
        </h2>
        <form onSubmit={handleScoreSubmit} noValidate>
          <div className="player-entry-list">
            {players.map(player => {
              const flags = roundFlags[player] || {};
              const adjustment = getAdjustment(flags);
              const score = currentRoundScores[player];
              const hasShare = score !== undefined && score !== '';
              const resolved = hasShare ? Number(score) + adjustment : null;
              return (
                <div key={player} className="player-score">
                  <label className="share-label" htmlFor={`share-${player}`}>{player}</label>
                  <input
                    id={`share-${player}`}
                    className="share-input"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="25"
                    step="1"
                    value={score ?? ''}
                    onChange={event => handleScoreChange(player, event.target.value)}
                    required
                    aria-label={`${player} share`}
                  />
                  <label className="flag-option">
                    <input
                      type="checkbox"
                      checked={Boolean(flags.noHands)}
                      onChange={event => handleFlagChange(player, 'noHands', event.target.checked)}
                    />
                    <span>No Hath</span>
                  </label>
                  <label className="flag-option">
                    <input
                      type="checkbox"
                      checked={Boolean(flags.committed)}
                      onChange={event => handleFlagChange(player, 'committed', event.target.checked)}
                    />
                    <span>Commit No Hath</span>
                  </label>
                  <output className={`resolved-preview ${adjustment ? 'adjusted' : ''}`}>
                    {hasShare ? `Round: ${resolved > 0 ? '+' : ''}${resolved}` : 'Round: —'}
                  </output>
                </div>
              );
            })}
          </div>
          <div className="round-form-footer">
            <p className={`points-counter ${distributedPoints > 25 ? 'over-limit' : ''}`}>
              {distributedPoints} of 25 shares entered
            </p>
            {roundError && <p className="error" role="alert">{roundError}</p>}
            <button type="submit">{editingRound !== null ? 'Save Round' : 'Submit Round'}</button>
          </div>
        </form>
      </section>

      <section className="standings" aria-label="Current standings">
        <h2>Standings <span>· lowest score leads</span></h2>
        <div className="standing-chips">
          {players.map(player => (
            <div className={`standing-chip ${totals[player] === lowestTotal ? 'leader' : ''}`} key={player}>
              <span>{player}</span><strong>{totals[player] > 0 ? '+' : ''}{totals[player] || 0}</strong>
            </div>
          ))}
        </div>
      </section>

      {scores.length > 0 && (
        <>
          <section className="score-graph" aria-label="Cumulative score graph">
            <h2>Score Progress</h2>
            <div className="chart-container"><Line options={chartOptions} data={chartData} /></div>
          </section>

          <section className="score-table">
            <h2>Score History</h2>
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Round-by-round scores and cumulative totals</caption>
                <thead>
                  <tr>
                    <th scope="col">Round</th>
                    {players.map(player => <th scope="col" key={player}>{player}</th>)}
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((roundScores, roundIndex) => (
                    <tr key={roundIndex} className={editingRound === roundIndex ? 'editing' : ''}>
                      <th scope="row">{roundIndex === 0 ? 'Start' : roundIndex}</th>
                      {players.map(player => {
                        const entry = roundScores.find(score => score.player === player);
                        const score = entry ? getResolvedScore(entry) : 0;
                        const adjustment = entry ? getAdjustment(entry) : 0;
                        const label = adjustment === -15 ? 'No Hath · Commit' : adjustment === -5 ? 'No Hath' : adjustment === 25 ? 'Commit failed' : '';
                        return (
                          <td key={player}>
                            <span className={score < 0 ? 'negative-score' : ''}>{score > 0 ? `+${score}` : score}</span>
                            {label && <span className="score-badge">{label}</span>}
                          </td>
                        );
                      })}
                      <td>
                        {roundIndex !== 0 && (
                          <button className="edit-btn" onClick={() => handleEditRound(roundScores, roundIndex)}>
                            {editingRound === roundIndex ? 'Cancel' : 'Edit'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="total-row">
                    <th scope="row">Total</th>
                    {players.map(player => (
                      <td className={totals[player] < 0 ? 'negative-score' : ''} key={player}>
                        <strong>{totals[player] > 0 ? `+${totals[player]}` : totals[player]}</strong>
                        {totals[player] === lowestTotal && <span className="leader-badge">Leading</span>}
                      </td>
                    ))}
                    <td>—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default App;

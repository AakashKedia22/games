import { useState, useEffect, useRef } from 'react';
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
import './App.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const WS_URL = process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:3001`;

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [players, setPlayers] = useState(['Aakash', 'Shreya', 'Aryan', 'Paa', 'Maa']);
  const [scores, setScores] = useState([]);
  const [currentRoundScores, setCurrentRoundScores] = useState({});
  const [editingRound, setEditingRound] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const savedSessionRef = useRef(null);

  useEffect(() => {
    savedSessionRef.current = localStorage.getItem('begamchor_session');
    setLoading(true);

    function connect() {
      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
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
            setLoading(false);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setLoading(false);
        setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        setConnected(false);
        setLoading(false);
      };
    }

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const getPositiveSum = (scores) => {
    return Object.values(scores)
      .map(score => Number(score))
      .filter(score => score >= 0)
      .reduce((sum, score) => sum + score, 0);
  };

  const isValidScore = (score) => {
    const numScore = Number(score);
    return numScore === -5 || (numScore >= 0 && numScore <= 25);
  };

  const handleScoreChange = (player, score) => {
    if (score === '' || isValidScore(score)) {
      const newScores = {
        ...currentRoundScores,
        [player]: score
      };

      const allScoresFilled = players.every(p => newScores[p] !== undefined && newScores[p] !== '');
      if (!allScoresFilled) {
        setCurrentRoundScores(newScores);
      } else {
        const positiveSum = getPositiveSum(newScores);
        if (positiveSum > 25) {
          alert('The sum of positive scores cannot exceed 25!');
        } else {
          setCurrentRoundScores(newScores);
        }
      }
    }
  };

  const handleScoreSubmit = (e) => {
    e.preventDefault();

    const allScoresValid = players.every(player =>
      currentRoundScores[player] && isValidScore(currentRoundScores[player])
    );

    if (!allScoresValid) {
      alert('Please enter valid scores. Only -5 or numbers between 0 and 25 are allowed.');
      return;
    }

    const hasKaaliBegam = Object.values(currentRoundScores)
      .some(score => Number(score) >= 12);

    if (!hasKaaliBegam) {
      alert('!! Kaali Begam not found !!');
      return;
    }

    const positiveSum = getPositiveSum(currentRoundScores);
    if (positiveSum !== 25) {
      alert(`The sum of positive scores must be exactly 25! Current sum: ${positiveSum}`);
      return;
    }

    const roundScores = players.map(player => ({
      player,
      score: parseInt(currentRoundScores[player])
    }));

    let newScores;
    if (editingRound !== null) {
      newScores = [...scores];
      newScores[editingRound] = roundScores;
      setEditingRound(null);
    } else {
      newScores = [...scores, roundScores];
    }

    wsRef.current.send(JSON.stringify({
      type: 'update_scores',
      sessionId,
      players,
      scores: newScores
    }));

    setCurrentRoundScores({});
  };

  const handleCreateSession = () => {
    if (!connected) {
      setSessionError('Not connected to server. Make sure the server is running.');
      return;
    }
    setSessionError('');
    wsRef.current.send(JSON.stringify({ type: 'create_session' }));
  };

  const handleJoinSession = () => {
    if (!connected) {
      setSessionError('Not connected to server. Make sure the server is running.');
      return;
    }
    if (!joinCode.trim()) {
      setSessionError('Please enter a session code');
      return;
    }
    setSessionError('');
    wsRef.current.send(JSON.stringify({
      type: 'join_session',
      sessionId: joinCode.trim().toUpperCase()
    }));
  };

  const handleNewGame = () => {
    localStorage.removeItem('begamchor_session');
    savedSessionRef.current = null;
    setSessionId(null);
    setScores([]);
    setCurrentRoundScores({});
    setEditingRound(null);
    setJoinCode('');
    setSessionError('');
    setLoading(false);
  };

  const getChartData = () => {
    const labels = scores.map((_, index) => `Round ${index}`);
    const datasets = players.map((player, index) => {
      let cumulative = 0;
      return {
        label: player,
        data: scores.map(round => {
          const playerScore = round.find(score => score.player === player);
          cumulative += playerScore ? playerScore.score : 0;
          return cumulative;
        }),
        borderColor: `hsl(${index * 90}, 70%, 50%)`,
        tension: 0.1
      };
    });

    return { labels, datasets };
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top'
      },
      title: {
        display: true,
        text: 'Begam Chor Score Card'
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        min: 0
      }
    }
  };

  if (loading) {
    return (
      <div className="App">
        <h1>Begam Chor Score Card</h1>
        <p>Loading...</p>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="App session-screen">
        <h1>Begam Chor Score Card</h1>
        <p className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Connected' : 'Disconnected — make sure the server is running'}
        </p>
        <div className="session-actions">
          <button onClick={handleCreateSession}>Create New Session</button>
        </div>
        <div className="session-join">
          <h3>Join Existing Session</h3>
          <input
            type="text"
            placeholder="Enter session code (e.g., BC-1234)"
            value={joinCode}
            onChange={(e) => { setJoinCode(e.target.value); setSessionError(''); }}
          />
          <button onClick={handleJoinSession}>Join</button>
          {sessionError && <p className="error">{sessionError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <div className="session-header">
        <span>Session: {sessionId}</span>
        <span className={`connection-dot ${connected ? 'connected' : 'disconnected'}`} />
        <button className="new-game-btn" onClick={handleNewGame}>New Game</button>
      </div>

      <h1>Begam Chor Score Card</h1>

      <div className="score-input">
        <h2>
          {editingRound !== null
            ? `Edit Round ${editingRound} Scores`
            : `Enter Round ${scores.length} Scores`
          }
        </h2>
        <form onSubmit={handleScoreSubmit}>
          {players.map(player => (
            <div key={player} className="player-score">
              <label>
                {player}:
                <input
                  type="number"
                  step="1"
                  value={currentRoundScores[player] || ''}
                  onChange={(e) => handleScoreChange(player, e.target.value)}
                  required
                  onInvalid={(e) => e.target.setCustomValidity('Please enter -5 or a number between 0 and 25')}
                  onInput={(e) => e.target.setCustomValidity('')}
                />
              </label>
            </div>
          ))}
          <button type="submit">Submit Round</button>
        </form>
      </div>

      {scores.length > 0 && (
        <>
          <div className="score-graph">
            <Line options={chartOptions} data={getChartData()} />
          </div>

          <div className="score-table">
            <h2>Score History</h2>
            <table>
              <thead>
                <tr>
                  <th>Round</th>
                  {players.map(player => (
                    <th key={player}>{player}</th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((roundScores, roundIndex) => (
                  <tr key={roundIndex} className={editingRound === roundIndex ? 'editing' : ''}>
                    <td>{roundIndex === 0 ? 'Start' : roundIndex}</td>
                    {players.map(player => (
                      <td key={player}>
                        {roundScores.find(score => score.player === player)?.score}
                      </td>
                    ))}
                    <td>
                      {roundIndex !== 0 && (
                        <button
                          onClick={() => {
                            if (editingRound === roundIndex) {
                              setEditingRound(null);
                              setCurrentRoundScores({});
                            } else {
                              setEditingRound(roundIndex);
                              const scoreObj = {};
                              roundScores.forEach(({player, score}) => {
                                scoreObj[player] = score;
                              });
                              setCurrentRoundScores(scoreObj);
                            }
                          }}
                        >
                          {editingRound === roundIndex ? 'Cancel' : 'Edit'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default App;

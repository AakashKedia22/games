import { useState } from 'react';
import { CardPicker } from './CardPicker';
import { checkCommit } from './hand';
import { commitLimit, restLimit } from './handEntry';

// One player's cards: 1 · Committed (the shown commit cards) and 2 · Bandh (or all cards, while unticked).
export function HandPanel({ player, commitCards, cards, committed, openCard, playerCount,
  onCommitCardsChange, onCardsChange, onCommittedChange }) {
  const [step, setStep] = useState(() => (committed || (cards.length > 0 && commitCards.length === 0) ? 'rest' : 'commit'));
  const check = checkCommit(commitCards, openCard, playerCount);
  const restMax = restLimit(commitCards);
  const restName = committed ? '2 · Bandh' : commitCards.length ? '2 · Other cards' : 'All cards';
  const statusClass = !commitCards.length ? 'empty' : check.ok ? 'ok' : 'bad';
  const toggle = () => {
    if (!committed && !check.ok) return;
    onCommittedChange(!committed);
    setStep(committed ? 'commit' : 'rest');
  };
  return (
    <div className="hand-panel">
      <div className="step-tabs" role="tablist" aria-label={`${player} card entry`}>
        <button type="button" role="tab" className="step-tab" aria-selected={step === 'commit'} onClick={() => setStep('commit')}>
          1 · Committed {commitCards.length}
        </button>
        <button type="button" role="tab" className="step-tab" aria-selected={step === 'rest'} onClick={() => setStep('rest')}>
          {restName} {cards.length}/{restMax}
        </button>
      </div>
      <div className="commit-row">
        <label className="commit-tick">
          <input type="checkbox" checked={committed} disabled={!committed && !check.ok}
            aria-label={`${player} committed`} onChange={toggle} />
          <span>Committed</span>
        </label>
        <p className={`commit-status ${statusClass}`} role="status">{check.message}</p>
      </div>
      {step === 'commit' ? (
        <CardPicker key="commit" player={player} label="committed cards" cards={commitCards} otherCards={cards}
          limit={commitLimit(cards)} counterText={`${commitCards.length} committed cards`} openCard={openCard}
          locked={committed} onChange={onCommitCardsChange} />
      ) : (
        <CardPicker key="rest" player={player} label={committed ? 'Bandh cards' : 'cards'} cards={cards}
          otherCards={commitCards} limit={restMax} openCard={openCard} onChange={onCardsChange} />
      )}
    </div>
  );
}

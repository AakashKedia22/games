import { useState } from 'react';
import { HAND_SIZE, PRINTED_JOKER, RANKS, SUITS, SUIT_SYMBOLS, cardCode, formatCard } from './cards';
import { isRedCode } from './handEntry';
import { needsCheck, reviewSummary, setChoice, toggleRemoved } from './recognition';

// Pick the right card for one photo crop: the model's guesses first, then any card.
function CardChooser({ card, onChoose, onRemove }) {
  const [suit, setSuit] = useState(() => (card.chosen === PRINTED_JOKER ? 'S' : card.chosen.slice(-1)));
  const guesses = [card.code, ...card.alternatives.map(item => item.code)]
    .filter((code, index, list) => list.indexOf(code) === index);
  return (
    <div className="card-chooser">
      <div className="chooser-guesses">
        {guesses.map(code => (
          <button key={code} type="button" className={`card-chip ${isRedCode(code) ? 'red' : ''} ${card.chosen === code ? 'selected' : ''}`}
            onClick={() => onChoose(code)}>
            {formatCard(code)}
          </button>
        ))}
        <button type="button" className="card-chip remove-chip" onClick={onRemove}>
          {card.removed ? 'Keep card' : 'Not a card'}
        </button>
      </div>
      <div className="suit-tabs" role="tablist" aria-label="Suit">
        {SUITS.map(item => (
          <button key={item} type="button" role="tab" aria-selected={suit === item}
            className={`suit-tab ${suit === item ? 'active' : ''} ${item === 'H' || item === 'D' ? 'red' : ''}`}
            onClick={() => setSuit(item)}>
            {SUIT_SYMBOLS[item]}
          </button>
        ))}
        <button type="button" className="suit-tab" onClick={() => onChoose(PRINTED_JOKER)}>Joker</button>
      </div>
      <div className="rank-grid">
        {RANKS.map((rank, index) => {
          const code = cardCode(index + 1, suit);
          return (
            <button key={code} type="button" className={`rank-btn ${isRedCode(code) ? 'red' : ''} ${card.chosen === code ? 'has-cards' : ''}`}
              aria-label={`Change to ${formatCard(code)}`} onClick={() => onChoose(code)}>
              {rank}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PhotoReview({ review, onChange, onUse, onCancel, keepSamples, onKeepSamplesChange }) {
  const [editing, setEditing] = useState(null);
  const summary = reviewSummary(review);
  const editingCard = review.cards.find(card => card.id === editing);

  return (
    <div className="photo-review">
      <p className="photo-review-head">
        <strong>Found {summary.found} {summary.found === 1 ? 'card' : 'cards'}</strong>
        {summary.toCheck > 0 && <span className="check-count"> · {summary.toCheck} to check</span>}
      </p>
      {summary.kept !== HAND_SIZE && (
        <p className="hand-warning">
          Using {summary.kept} of {HAND_SIZE}. Retake the photo, or add the missing cards with the picker afterwards.
        </p>
      )}
      <p className="hand-note">Tap a card to fix it. Cards marked “Check” were hard to read.</p>
      <div className="photo-grid">
        {review.cards.map(card => (
          <button
            key={card.id}
            type="button"
            className={`photo-card ${needsCheck(card) ? 'check' : ''} ${card.removed ? 'removed' : ''} ${editing === card.id ? 'active' : ''}`}
            aria-label={`${card.removed ? 'Not a card' : formatCard(card.chosen)}, tap to change`}
            onClick={() => setEditing(current => (current === card.id ? null : card.id))}
          >
            {card.thumb && <img src={card.thumb} alt="" />}
            <span className={`photo-label ${isRedCode(card.chosen) ? 'red' : ''}`}>
              {card.removed ? '✕' : formatCard(card.chosen)}
            </span>
            {needsCheck(card) && <span className="check-badge">Check</span>}
          </button>
        ))}
      </div>
      {editingCard && (
        <CardChooser
          key={editingCard.id}
          card={editingCard}
          onChoose={code => { onChange(setChoice(review, editingCard.id, code)); setEditing(null); }}
          onRemove={() => { onChange(toggleRemoved(review, editingCard.id)); setEditing(null); }}
        />
      )}
      <label className="keep-samples">
        <input type="checkbox" checked={keepSamples} onChange={event => onKeepSamplesChange(event.target.checked)} />
        <span>Keep these photos to improve recognition</span>
      </label>
      <div className="photo-actions">
        <button type="button" onClick={onUse} disabled={!summary.kept}>Use {summary.kept} cards</button>
        <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

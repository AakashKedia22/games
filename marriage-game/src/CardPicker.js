import { useState } from 'react';
import { HAND_SIZE, PRINTED_JOKER, RANKS, SUITS, SUIT_SYMBOLS, cardCode, countCards, formatCard } from './cards';
import { addCard, isRedCode, maxCopies, removeCard } from './handEntry';
import { PhotoReview } from './PhotoReview';
import { prepareUpload, recognizePhoto, reviewCards, reviewSamples, saveTrainingSamples, startReview } from './recognition';

const GROUP_LABELS = { pureRun: 'Pure run', run: 'Run', pureTriple: 'Pure triple', set: 'Set' };

export function CardPicker({ player, cards, openCard, onChange }) {
  const [suit, setSuit] = useState('S');
  const counts = countCards(cards);
  const tabs = [...SUITS, PRINTED_JOKER];
  const codes = suit === PRINTED_JOKER ? [PRINTED_JOKER] : RANKS.map((_, index) => cardCode(index + 1, suit));
  const handFull = cards.length >= HAND_SIZE;
  const [photo, setPhoto] = useState({ busy: false, error: '', review: null });
  const [keepSamples, setKeepSamples] = useState(true);

  const handlePhoto = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setPhoto({ busy: true, error: '', review: null });
    try {
      const found = await recognizePhoto(await prepareUpload(file));
      setPhoto(found.length
        ? { busy: false, error: '', review: startReview(found) }
        : { busy: false, error: 'No cards found. Lay the cards apart on a dark cloth, fill the frame and try again.', review: null });
    } catch (error) {
      setPhoto({ busy: false, error: error.message, review: null });
    }
  };

  const usePhotoCards = () => {
    // addCard enforces the hand size and the copies limit (3 decks, one fewer of the open card).
    onChange(reviewCards(photo.review).reduce((hand, code) => addCard(hand, code, openCard), []));
    if (keepSamples) saveTrainingSamples(reviewSamples(photo.review));
    setPhoto({ busy: false, error: '', review: null });
  };

  if (photo.review) {
    return (
      <div className="card-picker">
        <PhotoReview
          review={photo.review}
          onChange={review => setPhoto(current => ({ ...current, review }))}
          onUse={usePhotoCards}
          onCancel={() => setPhoto({ busy: false, error: '', review: null })}
          keepSamples={keepSamples}
          onKeepSamplesChange={setKeepSamples}
        />
      </div>
    );
  }

  return (
    <div className="card-picker">
      <div className="card-picker-head">
        <strong className={handFull ? 'hand-full' : ''}>{cards.length}/{HAND_SIZE} cards</strong>
        <div className="card-picker-actions">
          <label className={`secondary-btn photo-btn ${photo.busy ? 'is-busy' : ''}`}>
            {photo.busy ? 'Reading…' : '📷 Photo'}
            <input type="file" accept="image/*" capture="environment" className="visually-hidden"
              disabled={photo.busy} onChange={handlePhoto} aria-label={`Photo of ${player}'s cards`} />
          </label>
          <button type="button" className="secondary-btn" onClick={() => onChange([])} disabled={!cards.length}>Clear</button>
        </div>
      </div>
      {photo.error && <p className="hand-error" role="alert">{photo.error}</p>}
      <div className="suit-tabs" role="tablist" aria-label={`${player} suit`}>
        {tabs.map(tab => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={suit === tab}
            className={`suit-tab ${suit === tab ? 'active' : ''} ${tab === 'H' || tab === 'D' ? 'red' : ''}`}
            onClick={() => setSuit(tab)}
          >
            {tab === PRINTED_JOKER ? 'Joker' : SUIT_SYMBOLS[tab]}
          </button>
        ))}
      </div>
      <div className="rank-grid">
        {codes.map(code => {
          const count = counts[code] || 0;
          const disabled = handFull || count >= maxCopies(code, openCard);
          return (
            <button
              key={code}
              type="button"
              className={`rank-btn ${count ? 'has-cards' : ''} ${isRedCode(code) ? 'red' : ''}`}
              disabled={disabled}
              aria-label={`Add ${formatCard(code)}${count ? `, ${count} in hand` : ''}`}
              onClick={() => onChange(addCard(cards, code, openCard))}
            >
              <span>{code === PRINTED_JOKER ? 'Joker' : code.slice(0, -1)}</span>
              {count > 0 && <span className="rank-count">×{count}</span>}
            </button>
          );
        })}
      </div>
      {cards.length > 0 && (
        <div className="hand-chips" aria-label={`${player} cards, tap a card to remove it`}>
          {cards.map((code, index) => (
            <button
              key={`${code}-${index}`}
              type="button"
              className={`card-chip ${isRedCode(code) ? 'red' : ''}`}
              aria-label={`Remove ${formatCard(code)}`}
              onClick={() => onChange(removeCard(cards, code))}
            >
              {formatCard(code)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HandSummary({ result, isCloser }) {
  if (!result) return null;
  if (result.error) return <p className="hand-error" role="alert">{result.error}</p>;
  const status = result.committed ? (result.closed ? 'Closed' : 'Committed') : 'Not committed';
  return (
    <details className="hand-summary">
      <summary>
        {status} · Hath {isCloser ? '—' : result.hath} · Joker {result.jokerPoints}
      </summary>
      {isCloser && !result.closed && (
        <p className="hand-warning">These cards are not fully closed. Check the cards before submitting a Bandh.</p>
      )}
      {result.groups.length > 0 && (
        <ul className="group-list">
          {result.groups.map((group, index) => (
            <li key={index}>
              <span className="group-type">{GROUP_LABELS[group.type]}</span>
              {group.cards.map((code, position) => (
                <span key={position} className={`card-chip static ${isRedCode(code) ? 'red' : ''} ${group.wilds.includes(position) ? 'wild-card' : ''}`}>
                  {formatCard(code)}{group.wilds.includes(position) ? '★' : ''}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {result.leftovers.length > 0 && (
        <p className="hand-line">
          Left over ({result.hathValue} → Hath {result.hath}): {result.leftovers.map(formatCard).join(' ')}
        </p>
      )}
      <p className="hand-line">
        Joker points: {result.jokerParts.map(part => `${part.label} = ${part.points}`).join(', ') || 'no joker cards'}
        {result.triples > 0 ? `, pure triples ×${result.triples} = ${result.triplePoints}` : ''}
      </p>
      <p className="hand-note">★ = joker standing in for another card</p>
    </details>
  );
}

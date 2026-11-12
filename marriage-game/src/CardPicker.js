import { useState } from 'react';
import { HAND_SIZE, PRINTED_JOKER, RANKS, SUITS, SUIT_SYMBOLS, cardCode, countCards, formatCard } from './cards';
import { addCard, isRedCode, maxCopies, removeCard } from './handEntry';
import { DOUBLET_CLOSE_EXTRA } from './hand';
import { PhotoReview } from './PhotoReview';
import { photoCardsPlan, prepareUpload, recognizePhoto, reviewSamples, saveTrainingSamples, startReview } from './recognition';
import { PACK_HATH } from './scoring';

const GROUP_LABELS = { pureRun: 'Pure run', run: 'Run', pureTriple: 'Pure triple', set: 'Set', doublet: 'Doublet' };

// limit: the most cards this list holds; otherCards: the player's other list (copy limits count both).
// locked: show the cards read-only (the Committed tick is on).
export function CardPicker({ player, cards, openCard, onChange, label = 'cards', limit = HAND_SIZE,
  otherCards = [], counterText, locked = false }) {
  const [suit, setSuit] = useState('S');
  const counts = countCards(cards);
  const otherCounts = countCards(otherCards);
  const tabs = [...SUITS, PRINTED_JOKER];
  const codes = suit === PRINTED_JOKER ? [PRINTED_JOKER] : RANKS.map((_, index) => cardCode(index + 1, suit));
  const handFull = cards.length >= limit;
  const counter = counterText ?? `${cards.length}/${limit} cards`;
  const [photo, setPhoto] = useState({ busy: false, error: '', review: null });
  const [keepSamples, setKeepSamples] = useState(true);

  const handlePhoto = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setPhoto({ busy: true, error: '', review: null });
    try {
      const { cards: found, ignoredAtEdge } = await recognizePhoto(await prepareUpload(file));
      setPhoto(found.length
        ? { busy: false, error: '', review: startReview(found, ignoredAtEdge) }
        : {
          busy: false,
          error: ignoredAtEdge > 0
            ? `No whole cards found: ${ignoredAtEdge} at the edge of the photo were ignored. Move the cards in from the edges and try again.`
            : 'No cards found. Make sure each card\'s corner (rank and suit) is visible, fill the frame and try again.',
          review: null
        });
    } catch (error) {
      setPhoto({ busy: false, error: error.message, review: null });
    }
  };

  const usePhotoCards = () => {
    // photoCardsPlan enforces the list limit and the copies limit (3 decks, one fewer of the open card).
    onChange(photoCardsPlan(photo.review, openCard, { limit, otherCards }).cards);
    if (keepSamples) saveTrainingSamples(reviewSamples(photo.review));
    setPhoto({ busy: false, error: '', review: null });
  };

  if (locked) {
    return (
      <div className="card-picker is-locked">
        <div className="card-picker-head"><strong>{counter}</strong></div>
        <p className="hand-note">Locked. Untick Committed to change these cards.</p>
        <div className="hand-chips" aria-label={`${player} ${label}`}>
          {cards.map((code, index) => (
            <span key={`${code}-${index}`} className={`card-chip static ${isRedCode(code) ? 'red' : ''}`}>{formatCard(code)}</span>
          ))}
        </div>
      </div>
    );
  }

  if (photo.review) {
    return (
      <div className="card-picker">
        <PhotoReview
          review={photo.review}
          openCard={openCard}
          limit={limit}
          otherCards={otherCards}
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
        <strong className={handFull ? 'hand-full' : ''}>{counter}</strong>
        <div className="card-picker-actions">
          <label className={`secondary-btn photo-btn ${photo.busy ? 'is-busy' : ''}`}>
            {photo.busy ? 'Reading…' : '📷 Photo'}
            <input type="file" accept="image/*" capture="environment" className="visually-hidden"
              disabled={photo.busy} onChange={handlePhoto} aria-label={`Photo of ${player}'s ${label}`} />
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
          const disabled = handFull || count + (otherCounts[code] || 0) >= maxCopies(code, openCard);
          return (
            <button
              key={code}
              type="button"
              className={`rank-btn ${count ? 'has-cards' : ''} ${isRedCode(code) ? 'red' : ''}`}
              disabled={disabled}
              aria-label={`Add ${formatCard(code)}${count ? `, ${count} in hand` : ''}`}
              onClick={() => onChange(addCard(cards, code, openCard, { limit, otherCards }))}
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

function statusText(result) {
  if (!result.committed) return 'Not committed';
  const status = result.closed ? 'Closed' : 'Committed';
  return result.route === 'doublets' ? `${status} · ${result.doublets} doublets` : status;
}

function GroupList({ groups, className = '' }) {
  return (
    <ul className={`group-list ${className}`.trim()}>
      {groups.map((group, index) => (
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
  );
}

// hint: the un-ticked cards could have been committed. legacyResult: the old 30-card score of a saved round.
export function HandSummary({ result, isCloser, isPacked, hint = false, legacyResult = null }) {
  if (!result) return null;
  if (result.error) return <p className="hand-error" role="alert">{result.error}</p>;
  const locked = result.lockedGroups || [];
  return (
    <details className="hand-summary">
      <summary>
        {isPacked ? 'Packed · ' : ''}{statusText(result)} · Hath {isCloser ? '—' : isPacked ? PACK_HATH : result.hath} · Joker {result.jokerPoints}
      </summary>
      {isCloser && !result.closed && (
        <p className="hand-warning">These cards are not fully closed. Check the cards before submitting a Bandh.</p>
      )}
      {locked.length > 0 && (
        <>
          <p className="hand-section">Shown (locked)</p>
          <GroupList groups={locked} className="locked" />
          <p className="hand-section">Bandh</p>
          {result.groups.length > 0
            ? <GroupList groups={result.groups} />
            : <p className="hand-note">No groups in the Bandh cards.</p>}
        </>
      )}
      {locked.length === 0 && result.groups.length > 0 && <GroupList groups={result.groups} />}
      {result.route === 'doublets' && locked.length > 0 ? (
        <p className="hand-line">
          Doublets: {locked.length} shown + {result.groups.length} in Bandh ({DOUBLET_CLOSE_EXTRA} in Bandh to close)
        </p>
      ) : result.route === 'doublets' && result.doubletTarget && (
        <p className="hand-line">
          Doublets: {result.doublets} ({result.doubletTarget.commit} to commit, {result.doubletTarget.close} to close)
        </p>
      )}
      {!result.committed && result.doubletTarget && result.doublets > 0 && (
        <p className="hand-note">Doublets: {result.doublets} of {result.doubletTarget.commit} needed to commit</p>
      )}
      {!result.committed && (
        <p className="hand-note">Not committed: runs of 4–5 and pure triples are free; all other cards count.</p>
      )}
      {result.leftovers.length > 0 && (
        <p className="hand-line">
          Left over ({result.hathValue} → Hath {result.hath}): {result.leftovers.map(formatCard).join(' ')}
        </p>
      )}
      {result.otherCards.length > 0 && (
        <p className="hand-line">Other cards (not counted): {result.otherCards.map(formatCard).join(' ')}</p>
      )}
      <p className="hand-line">
        Joker points: {result.jokerParts.map(part => `${part.label} = ${part.points}`).join(', ') || 'no joker cards'}
        {result.triples > 0 ? `, pure triples ×${result.triples} = ${result.triplePoints}` : ''}
      </p>
      {result.brokenCombos.length > 0 && (
        <p className="hand-note">Played as plain cards (no joker bonus): {result.brokenCombos.map(formatCard).join(' ')}</p>
      )}
      {result.groups.some(group => group.wilds.length > 0) && (
        <p className="hand-note">★ = joker standing in for another card</p>
      )}
      {hint && (
        <p className="hand-note">These cards hold 5 pure sequences or enough doublets. If they were shown, enter them under 1 · Committed and tick Committed.</p>
      )}
      {legacyResult && !legacyResult.error && (
        <p className="hand-note">
          Saved before commit cards were split. The old 30-card search gave Hath {legacyResult.hath} · Joker {legacyResult.jokerPoints}; the boxes keep the saved values.
        </p>
      )}
    </details>
  );
}

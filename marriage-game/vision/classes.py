"""Card labels shared by training and recognition, in the app's card-code format."""
import re

SUITS = ['S', 'H', 'D', 'C']
RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
JOKER = 'JK'
CODES = [rank + suit for suit in SUITS for rank in RANKS] + [JOKER]
MAX_COPIES = 3  # a deck has three of each card (and the printed jokers come three at a time)

_RANK_WORDS = {
    'ace': 'A', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7',
    'eight': '8', 'nine': '9', 'ten': '10', 'jack': 'J', 'queen': 'Q', 'king': 'K',
}
_SUIT_WORDS = {'spades': 'S', 'hearts': 'H', 'diamonds': 'D', 'clubs': 'C'}
CODE_PATTERN = re.compile(r'^(?:(?:A|[2-9]|10|J|Q|K)[SHDC]|JK)$')


def code_from_folder(name):
    """Map a dataset folder name ('ace of clubs', 'joker', or a code like '10H') to a card code."""
    text = name.strip()
    if CODE_PATTERN.match(text):
        return text
    words = text.lower().split()
    if words == ['joker']:
        return JOKER
    if len(words) == 3 and words[1] == 'of' and words[0] in _RANK_WORDS and words[2] in _SUIT_WORDS:
        return _RANK_WORDS[words[0]] + _SUIT_WORDS[words[2]]
    return None

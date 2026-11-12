import os
import re

from classes import CODES, JOKER, RANKS, SUITS

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def js_list(source, name):
    match = re.search(r"export const %s = \[([^\]]*)\]" % name, source)
    return re.findall(r"'([^']+)'", match.group(1))


def test_labels_match_the_apps_card_codes():
    """The model's labels must be exactly the card codes the JS app understands."""
    with open(os.path.join(ROOT, 'src', 'cards.js')) as handle:
        source = handle.read()
    assert js_list(source, 'SUITS') == SUITS
    assert js_list(source, 'RANKS') == RANKS
    assert re.search(r"PRINTED_JOKER = '%s'" % JOKER, source)
    assert len(CODES) == 53 and len(set(CODES)) == 53

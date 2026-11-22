"""Build a checked root candidate in memory; no server access, write or reload."""
from pathlib import Path
import hashlib
import promote


def candidate(current, *, rollback=False, directory=Path(__file__).resolve().parent):
    _, proofs = promote.load_approval(directory)
    plan = proofs['proofs/root-plan.json']
    before = (directory/'root/before.conf').read_bytes()
    after = (directory/'root/proposed.conf').read_bytes()
    old = plan['exact_original_root']['exact_text'].encode()
    proposal = (directory/'root/proposal.conf').read_bytes()
    new = proposal[proposal.index(b'\nlocation = / {') + 1:].strip()
    promote.require(before.count(old) == 1 and after == before.replace(old, new, 1), 'exact root-only change')
    expected = after if rollback else before
    promote.require(hashlib.sha256(current).hexdigest() == hashlib.sha256(expected).hexdigest(), 'root current config drift')
    return before if rollback else after

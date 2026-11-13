"""One wire encoding for responses, byte accounting and legacy receipt projection."""
import json

JSON_PARAMS = {'ensure_ascii': False, 'separators': (',', ':')}
# Below the native 16 MiB response ceiling. A legal <=8 MiB request's single
# entity plus feed metadata fits; count alone never determines a page boundary.
MAX_PAGE_BYTES = 10 * 1024 * 1024


def encoded(value):
    return json.dumps(value, **JSON_PARAMS).encode('utf-8')


def acknowledgement(batch_id, changes):
    # Also project old receipts on read. Never reapply or prune a stored batch.
    return {'batch_id': str(batch_id), 'changes': [
        {key: change[key] for key in ('kind', 'id', 'version')} for change in changes
    ]}

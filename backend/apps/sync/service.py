import hashlib
import json
import uuid
from django.db import transaction
from django.utils import timezone
from apps.accounts.models import Account, DeviceSession
from apps.accounts.service import APIError
from .models import Entity, Change, Receipt
from .validation import KINDS, validate_data, validate_graph
from . import encoding


def wire(e):
    return {'kind': e.kind, 'id': e.entity_id, 'version': e.version, 'data': e.data}


def lock_account(session):
    account = Account.objects.select_for_update().get(pk=session.account_id)
    # Recheck under the same lock used by logout: an in-flight revoked session cannot write.
    if not DeviceSession.objects.filter(pk=session.pk, revoked_at__isnull=True, expires_at__gt=timezone.now()).exists():
        raise APIError('unauthorized', 401)
    return account


@transaction.atomic
def push(session, body):
    try:
        batch_id = uuid.UUID(body['batch_id'])
        ops = body['operations']
        if set(body) - {'batch_id', 'operations', 'require_empty'} or type(body.get('require_empty', False)) is not bool:
            raise ValueError()
        if not isinstance(ops, list) or not 1 <= len(ops) <= 5000:
            raise ValueError()
    except (KeyError, ValueError, TypeError):
        raise APIError('invalid_batch') from None
    account = lock_account(session)
    body_hash = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    previous = Receipt.objects.filter(account=account, batch_id=batch_id).first()
    if previous:
        if previous.body_hash != body_hash:
            raise APIError('batch_id_reused', 409)
        return encoding.acknowledgement(batch_id, previous.response['changes'])
    existing = {(e.kind, e.entity_id): e for e in Entity.objects.filter(account=account)}
    state = {k: e.data for k, e in existing.items()}
    seen, conflicts = set(), []
    for op in ops:
        if not isinstance(op, dict) or set(op) != {'kind', 'id', 'base_version', 'data'}:
            raise APIError('invalid_operation')
        kind, ident, version = op['kind'], op['id'], op['base_version']
        if not isinstance(kind, str) or kind not in KINDS or not isinstance(ident, str) or not 1 <= len(ident) <= 160 or type(version) is not int or version < 0:
            raise APIError('invalid_operation')
        key = kind, ident
        if key in seen:
            raise APIError('duplicate_operation')
        seen.add(key)
        validate_data(kind, ident, op['data'])
        current = existing.get(key)
        if (current.version if current else 0) != version:
            conflicts.append({k: v for k, v in wire(current).items() if k != 'data'} if current else {'kind': kind, 'id': ident, 'version': 0})
        state[key] = op['data']
    if conflicts:
        raise APIError('conflict', 409, conflicts=conflicts)
    if body.get('require_empty') and any(e.data is not None for e in existing.values()):
        raise APIError('import_requires_empty_account', 409)
    for op in ops:
        if op['kind'] == 'value' and op['data'] is None:
            field_id = op['id'].split(':')[1]
            definition = state.get(('field', field_id))
            if definition and definition['kind'] == 'file_list':
                raise APIError('invalid_data', 422, detail='Local file values cannot be synced')
    validate_graph(state)
    changed = []
    for op in ops:
        key = op['kind'], op['id']
        current = existing.get(key)
        version = (current.version if current else 0) + 1
        e, _ = Entity.objects.update_or_create(account=account, kind=op['kind'], entity_id=op['id'], defaults={'version': version, 'data': op['data']})
        account.sequence += 1
        Change.objects.create(account=account, sequence=account.sequence, kind=e.kind, entity_id=e.entity_id, version=version, data=e.data)
        changed.append({'kind': e.kind, 'id': e.entity_id, 'version': version})
    account.save(update_fields=['sequence'])
    response = encoding.acknowledgement(batch_id, changed)
    Receipt.objects.create(account=account, batch_id=batch_id, body_hash=body_hash, response=response)
    return response


@transaction.atomic
def pull(session, cursor, limit):
    account = lock_account(session)
    if cursor < 0 or cursor > account.sequence or not 1 <= limit <= 500:
        raise APIError('invalid_cursor_or_limit')
    changes, used_bytes, next_cursor = [], 0, cursor
    # Stream one candidate at a time: do not first materialize 200 large JSON
    # payloads. Leave envelope/cursor headroom, counted with the HTTP encoder.
    candidates = Change.objects.filter(account=account, sequence__gt=cursor).order_by('sequence')[:limit]
    for change in candidates.iterator(chunk_size=1):
        item = dict(wire(change), sequence=change.sequence)
        size = len(encoding.encoded(item)) + 1  # comma between entries
        if used_bytes + size + 128 > encoding.MAX_PAGE_BYTES:
            if not changes:
                raise APIError('entity_exceeds_page_limit', 422)
            break
        changes.append(item)
        used_bytes += size
        next_cursor = change.sequence
    return {'changes': changes, 'cursor': next_cursor,
            'has_more': next_cursor < account.sequence}

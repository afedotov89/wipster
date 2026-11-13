"""The wire schema mirrors persisted native columns, not arbitrary settings."""
import json
import math
import re
from apps.accounts.service import APIError

TASK_TEXT = 'title project_id status priority energy due estimate time_estimate tags dod checklist next_step return_ref promised_to comment tracker_url completed_at archived_at created_at updated_at'.split()
PROJECT_TEXT = 'name parent_id icon icon_image color created_at updated_at'.split()
FIELD_TEXT = 'key label kind options removed_at created_at column_side'.split()
KINDS = {'project', 'task', 'field', 'value', 'preference'}
FIELD_KINDS = {'text', 'long_text', 'markdown', 'number', 'date', 'checkbox', 'select', 'url', 'url_list', 'file_list', 'text_list', 'checklist'}
BUILTINS = {'builtin-project': ('project_id', 'select'), 'builtin-priority': ('priority', 'select'),
 'builtin-energy': ('energy', 'select'), 'builtin-time-estimate': ('time_estimate', 'text'),
 'builtin-due': ('due', 'date'), 'builtin-promised-to': ('promised_to', 'text'),
 'builtin-dod': ('dod', 'long_text'), 'builtin-checklist': ('checklist', 'checklist'),
 'builtin-tracker-url': ('tracker_url', 'url'), 'builtin-comment': ('comment', 'long_text')}


def invalid(message):
    raise APIError('invalid_data', 422, detail=message)


def validate_data(kind, ident, data):
    simple_id = r'[A-Za-z0-9_-]{1,80}'
    pattern = simple_id + ':' + simple_id if kind == 'value' else simple_id
    if not re.fullmatch(pattern, ident) or (kind == 'preference' and ident != 'wip_limit'):
        invalid('Invalid entity identity')
    if data is None:
        if kind == 'field':
            invalid('Field definitions use removed_at instead of hard deletion')
        return
    if not isinstance(data, dict):
        invalid('Entity data must be an object or null')
    text = {'task': TASK_TEXT, 'project': PROJECT_TEXT, 'field': FIELD_TEXT,
            'value': ['task_id', 'field_id', 'value', 'updated_at'], 'preference': ['key', 'value']}[kind]
    nums = {'task': ['position'], 'project': ['order', 'icon_mono'], 'field': ['builtin', 'enabled', 'position'], 'value': [], 'preference': []}[kind]
    fields = set(text + nums + ([] if kind in ('value', 'preference') else ['id']))
    if set(data) != fields:
        invalid(f'{kind}: unexpected or missing fields')
    if 'id' in fields and data['id'] != ident:
        invalid('Entity id mismatch')
    for key in text:
        if data[key] is not None and (not isinstance(data[key], str) or len(data[key]) > (500000 if key == 'icon_image' else 100000)):
            invalid(f'{kind}.{key}: expected bounded string')
    for key in nums:
        if data[key] is not None and (type(data[key]) is not int or abs(data[key]) > 2147483647):
            invalid(f'{kind}.{key}: expected integer')
    required = {'task': ['title', 'status', 'tags', 'checklist', 'created_at', 'updated_at'],
                'project': ['name', 'order', 'icon_mono', 'created_at', 'updated_at'],
                'field': ['key', 'kind', 'options', 'builtin', 'enabled', 'position', 'created_at'],
                'value': ['task_id', 'field_id', 'value', 'updated_at'], 'preference': ['key', 'value']}[kind]
    if any(data[k] is None for k in required):
        invalid('Required value is null')
    if kind == 'task':
        if data['return_ref'] is not None:
            invalid('Captured context is device-local')
        if data['status'] not in ('inbox', 'queue', 'doing', 'done') or data['priority'] not in (None, 'p0', 'p1', 'p2', 'p3') or data['estimate'] not in (None, 's', 'm', 'l') or data['energy'] not in (None, 'low', 'medium', 'high'):
            invalid('Invalid task enum')
        for key in ('tags', 'checklist'):
            try:
                if not isinstance(json.loads(data[key]), list):
                    invalid(f'{key} must encode an array')
            except (ValueError, TypeError):
                invalid(f'{key} must encode an array')
    if kind == 'project' and data['icon_mono'] not in (0, 1):
        invalid('Invalid icon_mono')
    if kind == 'field':
        if data['kind'] not in FIELD_KINDS or data['builtin'] not in (0, 1) or data['enabled'] not in (0, 1) or data['column_side'] not in (None, 'main', 'side'):
            invalid('Invalid field definition')
        if bool(data['builtin']) != (ident in BUILTINS) or (ident in BUILTINS and (data['key'], data['kind']) != BUILTINS[ident]):
            invalid('Invalid builtin field identity')
        if not data['builtin'] and data['key'] in {key for key, _ in BUILTINS.values()}:
            invalid('Custom field cannot use a reserved builtin key')
        try:
            options = json.loads(data['options'])
            if not isinstance(options, list) or not all(isinstance(o, str) for o in options):
                invalid('Invalid field options')
        except (ValueError, TypeError):
            invalid('Invalid field options')
    if kind == 'value':
        if ident != data['task_id'] + ':' + data['field_id']:
            invalid('Invalid value identity')
        try:
            json.loads(data['value'])
        except ValueError:
            invalid('Invalid custom value JSON')
    if kind == 'preference':
        if ident != 'wip_limit' or data['key'] != ident or data['value'] not in [str(i) for i in range(1, 21)]:
            invalid('Only wip_limit (1..20) may be synced')


def validate_graph(state):
    live = {key: data for key, data in state.items() if data is not None}
    def ref(kind, ident):
        if ident is not None and (kind, ident) not in live:
            invalid('Reference must belong to this account and exist in final batch state')
    for (kind, ident), d in live.items():
        if kind == 'project':
            ref('project', d['parent_id'])
            seen, parent = {ident}, d['parent_id']
            while parent is not None:
                if parent in seen:
                    invalid('Project hierarchy contains a cycle')
                ref('project', parent)
                seen.add(parent)
                parent = live['project', parent]['parent_id']
        if kind == 'task':
            ref('project', d['project_id'])
        if kind == 'value':
            ref('task', d['task_id'])
            ref('field', d['field_id'])
            definition = live['field', d['field_id']]
            if definition['kind'] == 'file_list':
                invalid('Local file values cannot be synced')
            if definition['builtin']:
                invalid('Builtin values live in task columns')
            try:
                value = json.loads(d['value'], parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            except (ValueError, TypeError):
                invalid('Invalid custom value JSON')
            fkind = definition['kind']
            if value is not None:
                if fkind == 'number':
                    valid = type(value) in (int, float) and math.isfinite(value)
                elif fkind == 'checkbox':
                    valid = type(value) is bool
                elif fkind in ('url_list', 'text_list'):
                    valid = isinstance(value, list) and all(isinstance(v, str) for v in value)
                elif fkind == 'date':
                    valid = isinstance(value, str) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', value))
                elif fkind == 'select':
                    # Existing values survive removing a choice from the definition,
                    # matching native behavior. Type must remain a string.
                    valid = isinstance(value, str)
                else:
                    valid = isinstance(value, str)
                if not valid:
                    invalid('Custom value does not match the field type')
    field_keys = [d['key'] for (k, _), d in live.items() if k == 'field']
    if len(field_keys) != len(set(field_keys)):
        invalid('Duplicate custom field key')
    limit = int(live.get(('preference', 'wip_limit'), {'value': '3'})['value'])
    doing = sum(k == 'task' and d['status'] == 'doing' and not d['archived_at'] for (k, _), d in live.items())
    if doing > limit:
        raise APIError('wip_limit', 422, limit=limit, doing=doing)

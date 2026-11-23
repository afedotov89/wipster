"""Read-only, run-specific commit-status authority. Never creates a status.

GitHub documents /commits/{sha}/statuses newest-first; use that ordered history,
not combined status or a post-dispatch expression variable. A newest same-context
non-success/wrong actor is terminal, never fall back to an older success.
"""
import datetime as dt
import hashlib
import json
import re
import time
import urllib.error
import urllib.request

REPOSITORY = 'afedotov89/wipster'
REPOSITORY_ID = 1138317534
WORKFLOW_ID = 427224624
WORKFLOW_PATH = '.github/workflows/promote_pwa.yml'
APPROVER_ID = 7385763
APPROVER_LOGIN = 'afedotov89'
TTL_SECONDS = 600
WAIT_SECONDS = 300
SNAPSHOT_SECONDS = 45
MAX_RUN_AGE_SECONDS = 3600
MAX_BODY = 2 * 1024 * 1024
MAX_PAGES = 10
API_ROOT = 'https://api.github.com/repos/' + REPOSITORY


class Rejected(ValueError):
    pass


class Missing(Rejected):
    """Only genuinely missing approval may be polled; all other failures stop."""


def require(ok, reason):
    if not ok:
        raise Rejected(reason)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def timestamp(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value), 'API timestamp')
    return dt.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)


def positive(value):
    return type(value) is int and 0 < value < 10 ** 20


def environment(env, head, pin):
    require(re.fullmatch('[0-9a-f]{40}', head or '') is not None, 'checkout SHA')
    for key in ['GITHUB_SHA', 'GITHUB_WORKFLOW_SHA', 'EXPECTED_PROMOTION_SOURCE']:
        require(env.get(key) == head, 'promotion source')
    require(head not in (pin['source'], pin['required_installed_ops_source'], pin['observed_installed_ops']['source']),
            'distinct promotion source')
    require((env.get('GITHUB_REPOSITORY'), env.get('GITHUB_REPOSITORY_ID')) ==
            (REPOSITORY, str(REPOSITORY_ID)) and (pin['repository'], pin['repository_id']) ==
            (REPOSITORY, REPOSITORY_ID), 'repository identity')
    require(env.get('GITHUB_WORKFLOW_REF') == REPOSITORY + '/' + WORKFLOW_PATH + '@refs/heads/main',
            'workflow ref')
    require((env.get('GITHUB_REF'), env.get('GITHUB_EVENT_NAME'), env.get('DEPLOY_ENVIRONMENT'),
             env.get('DEPLOY_ENABLED')) == ('refs/heads/main', 'workflow_dispatch', 'wipster-production', 'false'),
            'manual main / environment / closed shared gate')
    require(re.fullmatch('[1-9][0-9]{0,19}', env.get('GITHUB_RUN_ID', '')) is not None, 'run ID')
    require(env.get('GITHUB_RUN_ATTEMPT') == '1', 'attempt must be one')
    run_id = int(env['GITHUB_RUN_ID'])
    require(run_id not in (pin['build_run'], pin['compatibility_run']), 'distinct delivery run')
    return run_id


def context(head, run_id):
    require(re.fullmatch('[0-9a-f]{40}', head or '') is not None and positive(run_id), 'context identity')
    return f'wipster/pwa/v1/{head}/{run_id}/1'


def binding(head, run_id, pin, proofs):
    """Public exact inputs: a success on this context cannot approve another pin."""
    return {'schema': 1, 'repository': REPOSITORY, 'repository_id': REPOSITORY_ID,
            'workflow_id': WORKFLOW_ID, 'workflow_path': WORKFLOW_PATH, 'promotion_source': head,
            'promotion_run': run_id, 'promotion_attempt': 1,
            'image_source': pin['source'], 'build_run': pin['build_run'],
            'artifact_build_attempt': pin['artifact_build_attempt'], 'native_success_attempt': pin['successful_run_attempt'],
            'artifact_id': pin['artifact_id'], 'zip_sha256': pin['zip_sha256'], 'zip_bytes': pin['zip_bytes'],
            'archive_sha256': pin['archive_sha256'], 'image_config': pin['image'], 'oci_manifest': pin['oci_manifest'],
            'image_ops_sha256': pin['image_ops_sha256'], 'required_installed_ops': pin['required_installed_ops_sha256'],
            'required_installed_source': pin['required_installed_ops_source'],
            'context_sha256': pin['context_sha256'], 'static_manifest_sha256': pin['static_manifest_sha256'],
            'artifact_proof_pins': pin['proofs'],
            'compatibility': proofs['proofs/delivery-ops.json']['compatibility']}


def description(inputs):
    return 'wipster-pwa/v1:' + hashlib.sha256(canonical(inputs)).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ReadAPI:
    """Absolute origin fixed here; bounded GET only, no redirects or body logs."""
    def __init__(self, token, deadline):
        require(isinstance(token, str) and bool(token) and '\n' not in token and '\r' not in token, 'API token shape')
        self.token = token
        self.deadline = deadline

    def get(self, path):
        require(isinstance(path, str) and re.fullmatch(r'[A-Za-z0-9/_?=&.\-]*', path) is not None
                and not path.startswith('/') and '..' not in path, 'API relative path')
        url = API_ROOT + ('/' + path if path else '')
        remaining = self.deadline - time.monotonic()
        require(remaining > 0, 'approval API deadline')
        request = urllib.request.Request(url, method='GET', headers={
            'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
            'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache', 'X-GitHub-Api-Version': '2022-11-28'})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=min(8, remaining)) as response:
                require(response.status == 200 and response.geturl() == url, 'API response identity')
                require(response.headers.get('Content-Encoding', 'identity') == 'identity', 'API encoding')
                raw = response.read(MAX_BODY + 1)
                require(len(raw) <= MAX_BODY and time.monotonic() <= self.deadline, 'API size/deadline')
        except (urllib.error.URLError, OSError, TimeoutError):
            raise Rejected('approval API unavailable (response withheld)') from None
        def unique(pairs):
            result = {}
            for key, value in pairs:
                require(key not in result, 'duplicate approval JSON key')
                result[key] = value
            return result
        try:
            return json.loads(raw, object_pairs_hook=unique)
        except (ValueError, UnicodeError):
            raise Rejected('approval API JSON malformed') from None


def repository(data):
    require(isinstance(data, dict) and type(data.get('id')) is int and data['id'] == REPOSITORY_ID
            and data.get('full_name') == REPOSITORY, 'actual repository')


def run_metadata(data, head, run_id, now):
    require(isinstance(data, dict), 'run shape')
    for name in ['repository', 'head_repository']:
        repository(data.get(name))
    require((data.get('id'), data.get('run_attempt'), data.get('workflow_id'), data.get('path'),
             data.get('head_sha'), data.get('head_branch'), data.get('event'), data.get('status'), data.get('conclusion')) ==
            (run_id, 1, WORKFLOW_ID, WORKFLOW_PATH, head, 'main', 'workflow_dispatch', 'in_progress', None),
            'actual run/workflow/source/result')
    require(type(data.get('id')) is int and type(data.get('run_attempt')) is int and type(data.get('workflow_id')) is int,
            'run numeric fields')
    created, started = timestamp(data.get('created_at')), timestamp(data.get('run_started_at'))
    require(created <= started <= now and 0 <= (now - created).total_seconds() <= MAX_RUN_AGE_SECONDS,
            'run timestamps')
    return created


def history(api, head):
    records, ids, previous = [], set(), None
    first = None
    for page in range(1, MAX_PAGES + 1):
        rows = api.get(f'commits/{head}/statuses?per_page=100&page={page}')
        require(isinstance(rows, list) and len(rows) <= 100, 'status page shape')
        if first is None:
            first = canonical(rows)
        for row in rows:
            require(isinstance(row, dict) and positive(row.get('id')) and row['id'] not in ids
                    and isinstance(row.get('context'), str), 'status identity/duplicate')
            when = timestamp(row.get('created_at'))
            require(previous is None or when <= previous, 'status reverse chronology')
            previous = when
            ids.add(row['id'])
            records.append(row)
        if len(rows) < 100:
            break
    else:
        raise Rejected('status pagination bound; no complete snapshot')
    # A new approval/revocation during pagination must not be hidden by offsets.
    require(canonical(api.get(f'commits/{head}/statuses?per_page=100&page=1')) == first,
            'status history changed during read')
    return records


def select(records, head, run_id, inputs, created, now):
    matching = [row for row in records if row['context'].casefold() == context(head, run_id).casefold()]
    if not matching:
        raise Missing('run-specific approval not present')
    row = matching[0]  # authoritative newest-first API order, no fallback
    require(row['context'] == context(head, run_id), 'approval context spelling')
    require(not any(x['created_at'] == row['created_at'] for x in matching[1:]), 'same-context timestamp ambiguous')
    require(row.get('url') == API_ROOT + '/statuses/' + head, 'status repository/ID URL')
    require(row.get('state') == 'success', 'newest approval is not success')
    creator = row.get('creator')
    require(isinstance(creator, dict) and type(creator.get('id')) is int and creator['id'] == APPROVER_ID
            and creator.get('login') == APPROVER_LOGIN and creator.get('type') == 'User', 'trusted status creator')
    require(row.get('description') == description(inputs)
            and row.get('target_url') == f'https://github.com/{REPOSITORY}/actions/runs/{run_id}', 'approval input/run binding')
    issued, updated = timestamp(row.get('created_at')), timestamp(row.get('updated_at'))
    require(created <= issued == updated <= now and (now - issued).total_seconds() < TTL_SECONDS,
            'approval expired/future/pre-run/updated')
    return {'status_id': row['id'], 'context': row['context'], 'state': row['state'],
            'creator_id': creator['id'], 'creator_login': creator['login'], 'created_at': row['created_at'],
            'updated_at': row['updated_at'], 'expires_at': (issued + dt.timedelta(seconds=TTL_SECONDS)).isoformat(),
            'checked_at': now.isoformat(), 'description': row['description'], 'target_url': row['target_url'],
            'input_binding': inputs, 'history_sha256': hashlib.sha256(canonical(records)).hexdigest(),
            'authority': 'execution-time-commit-status-v1', 'shared_flag_job_context': 'false',
            'revocation_after_transport_starts': 'not guaranteed; latest check bounds only the pre-SSH observation'}


def check(env, head, pin, proofs, api, now=None):
    fixed_now = now
    now = now or dt.datetime.now(dt.timezone.utc)
    run_id = environment(env, head, pin)
    repository(api.get(''))
    workflow = api.get(f'actions/workflows/{WORKFLOW_ID}')
    require((workflow.get('id'), workflow.get('path'), workflow.get('state')) ==
            (WORKFLOW_ID, WORKFLOW_PATH, 'active'), 'actual workflow')
    data = api.get(f'actions/runs/{run_id}/attempts/1')
    created = run_metadata(data, head, run_id, now)
    require(api.get('branches/main')['commit']['sha'] == head, 'current main drift')
    records = history(api, head)
    # Sample time AFTER the reads: API latency cannot extend an expired lease.
    checked = fixed_now or dt.datetime.now(dt.timezone.utc)
    result = select(records, head, run_id, binding(head, run_id, pin, proofs), created, checked)
    require(api.get('branches/main')['commit']['sha'] == head, 'current main drift at approval acceptance')
    if fixed_now is None:
        result = select(records, head, run_id, binding(head, run_id, pin, proofs), created,
                        dt.datetime.now(dt.timezone.utc))
    return result


def authorize(env, head, pin, proofs, token, wait_seconds=0, *, api_factory=ReadAPI,
              clock=time.monotonic, sleep=time.sleep):
    require(type(wait_seconds) is int and 0 <= wait_seconds <= WAIT_SECONDS, 'bounded approval wait')
    deadline = clock() + wait_seconds
    while True:
        # Snapshot is also bounded when no polling is requested.
        snapshot_deadline = min(clock() + SNAPSHOT_SECONDS, deadline) if wait_seconds else clock() + SNAPSHOT_SECONDS
        try:
            return check(env, head, pin, proofs, api_factory(token, snapshot_deadline))
        except Missing:
            if not wait_seconds or clock() >= deadline:
                raise
            sleep(min(5, max(0, deadline - clock())))

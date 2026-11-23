import copy
import datetime as dt
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import promote as p
import run_approval as a

HEAD = 'a' * 40
RUN = 99001234567
NOW = dt.datetime(2026, 11, 23, 12, 3, tzinfo=dt.timezone.utc)
STAMP = '2026-11-23T12:02:00Z'


def environment():
    return {'GITHUB_SHA': HEAD, 'GITHUB_WORKFLOW_SHA': HEAD, 'EXPECTED_PROMOTION_SOURCE': HEAD,
            'GITHUB_REPOSITORY': a.REPOSITORY, 'GITHUB_REPOSITORY_ID': str(a.REPOSITORY_ID),
            'GITHUB_WORKFLOW_REF': a.REPOSITORY + '/' + a.WORKFLOW_PATH + '@refs/heads/main',
            'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'workflow_dispatch',
            'DEPLOY_ENVIRONMENT': 'wipster-production', 'DEPLOY_ENABLED': 'false',
            'GITHUB_RUN_ID': str(RUN), 'GITHUB_RUN_ATTEMPT': '1'}


class FakeAPI:
    def __init__(self, pin, proofs):
        repo = {'id': a.REPOSITORY_ID, 'full_name': a.REPOSITORY}
        self.repo = repo
        self.workflow = {'id': a.WORKFLOW_ID, 'path': a.WORKFLOW_PATH, 'state': 'active'}
        self.run = {'repository': repo.copy(), 'head_repository': repo.copy(), 'id': RUN, 'run_attempt': 1,
                    'workflow_id': a.WORKFLOW_ID, 'path': a.WORKFLOW_PATH, 'head_sha': HEAD,
                    'head_branch': 'main', 'event': 'workflow_dispatch', 'status': 'in_progress', 'conclusion': None,
                    'created_at': '2026-11-23T12:00:00Z', 'run_started_at': '2026-11-23T12:00:01Z'}
        self.status = {'id': 123, 'url': a.API_ROOT + '/statuses/' + HEAD, 'context': a.context(HEAD, RUN),
                       'state': 'success', 'description': a.description(a.binding(HEAD, RUN, pin, proofs)),
                       'target_url': f'https://github.com/{a.REPOSITORY}/actions/runs/{RUN}',
                       'created_at': STAMP, 'updated_at': STAMP,
                       'creator': {'id': a.APPROVER_ID, 'login': a.APPROVER_LOGIN, 'type': 'User'}}
        self.pages = {1: [self.status]}
        self.main = HEAD
        self.calls = []
        self.page_one_reads = 0
        self.main_reads = 0
        self.race = False
        self.main_race = False

    def get(self, path):
        self.calls.append(path)
        if path == '': return copy.deepcopy(self.repo)
        if path == f'actions/workflows/{a.WORKFLOW_ID}': return copy.deepcopy(self.workflow)
        if path == f'actions/runs/{RUN}/attempts/1': return copy.deepcopy(self.run)
        if path == 'branches/main':
            self.main_reads += 1
            return {'commit': {'sha': 'b' * 40 if self.main_race and self.main_reads > 1 else self.main}}
        prefix = f'commits/{HEAD}/statuses?per_page=100&page='
        if path.startswith(prefix):
            page = int(path[len(prefix):])
            if page == 1:
                self.page_one_reads += 1
                if self.race and self.page_one_reads > 1: return [self.status | {'state': 'failure'}]
            return copy.deepcopy(self.pages.get(page, []))
        raise AssertionError('unexpected API endpoint ' + path)


class Approval(unittest.TestCase):
    def setUp(self):
        self.pin, self.proofs = p.load_approval()
        self.env = environment()
        self.api = FakeAPI(self.pin, self.proofs)

    def check(self):
        return a.check(self.env, HEAD, self.pin, self.proofs, self.api, NOW)

    def test_success_binds_exact_original_inputs_and_actor(self):
        receipt = self.check()
        self.assertEqual(receipt['status_id'], 123)
        self.assertEqual(receipt['creator_id'], 7385763)
        self.assertEqual(receipt['input_binding']['artifact_id'], 14541275501)
        self.assertEqual(receipt['input_binding']['required_installed_ops'], self.pin['required_installed_ops_sha256'])
        self.assertEqual(dt.datetime.fromisoformat(receipt['expires_at']), a.timestamp(STAMP) + dt.timedelta(seconds=600))

    def test_wrong_environment_source_run_attempt_or_shared_flag(self):
        changes = {'GITHUB_SHA': 'b' * 40, 'GITHUB_WORKFLOW_SHA': 'b' * 40,
                   'EXPECTED_PROMOTION_SOURCE': 'b' * 40, 'GITHUB_REPOSITORY_ID': '1',
                   'GITHUB_REPOSITORY': 'elsewhere/repo', 'GITHUB_WORKFLOW_REF': 'wrong',
                   'GITHUB_REF': 'refs/heads/dev', 'GITHUB_EVENT_NAME': 'push', 'DEPLOY_ENVIRONMENT': 'dev',
                   'DEPLOY_ENABLED': 'true', 'GITHUB_RUN_ID': '0', 'GITHUB_RUN_ATTEMPT': '2'}
        for key, value in changes.items():
            with self.subTest(key=key), self.assertRaises(a.Rejected):
                a.check(self.env | {key: value}, HEAD, self.pin, self.proofs, self.api, NOW)

    def test_actual_run_repository_workflow_source_or_attempt_mismatch(self):
        for key, value in [('head_sha', 'b' * 40), ('id', RUN + 1), ('run_attempt', 2),
                           ('workflow_id', 1), ('path', '.github/workflows/promote_backend.yml'),
                           ('head_branch', 'dev'), ('event', 'push'), ('status', 'completed'),
                           ('created_at', '2026-11-23T12:04:00Z'), ('run_started_at', '2026-11-23T11:59:59Z')]:
            api = FakeAPI(self.pin, self.proofs); api.run[key] = value
            with self.subTest(key=key), self.assertRaises(a.Rejected):
                a.check(self.env, HEAD, self.pin, self.proofs, api, NOW)
        self.api.run['head_repository']['id'] = 1
        with self.assertRaises(a.Rejected): self.check()

    def test_actual_repository_and_workflow_metadata(self):
        self.api.repo['id'] = 1
        with self.assertRaises(a.Rejected): self.check()
        self.api = FakeAPI(self.pin, self.proofs); self.api.workflow['state'] = 'disabled_manually'
        with self.assertRaises(a.Rejected): self.check()

    def test_wrong_creator_context_commit_or_pinned_inputs(self):
        changes = [('creator', {'id': 7, 'login': 'afedotov89', 'type': 'User'}),
                   ('creator', {'id': True, 'login': 'afedotov89', 'type': 'User'}),
                   ('creator', {'id': a.APPROVER_ID, 'login': 'other', 'type': 'User'}),
                   ('context', a.context('b' * 40, RUN)), ('context', a.context(HEAD, RUN + 1)),
                   ('context', a.context(HEAD, RUN)[:-1] + '2'), ('description', 'caller supplied approval'),
                   ('target_url', f'https://github.com/{a.REPOSITORY}/actions/runs/{RUN + 1}'),
                   ('url', a.API_ROOT + '/statuses/' + 'b' * 40)]
        for key, value in changes:
            api = FakeAPI(self.pin, self.proofs); api.status[key] = value
            with self.subTest(key=key), self.assertRaises(a.Rejected):
                a.check(self.env, HEAD, self.pin, self.proofs, api, NOW)

    def test_expired_future_prerun_or_mutated_timestamp(self):
        for stamp in ['2026-11-23T11:50:00Z', '2026-11-23T12:04:00Z', '2026-11-23T11:59:59Z', 'bad']:
            api = FakeAPI(self.pin, self.proofs); api.status.update(created_at=stamp, updated_at=stamp)
            with self.subTest(stamp=stamp), self.assertRaises(a.Rejected):
                a.check(self.env, HEAD, self.pin, self.proofs, api, NOW)
        self.api.status['updated_at'] = '2026-11-23T12:02:01Z'
        with self.assertRaises(a.Rejected): self.check()

    def test_exact_ttl_boundary_is_expired(self):
        self.api.status.update(created_at='2026-11-23T12:00:00Z', updated_at='2026-11-23T12:00:00Z')
        with self.assertRaises(a.Rejected):
            a.check(self.env, HEAD, self.pin, self.proofs, self.api, NOW.replace(minute=10))

    def test_newest_revocation_never_falls_back_to_success(self):
        for state in ['pending', 'failure', 'error']:
            api = FakeAPI(self.pin, self.proofs)
            newer = api.status | {'id': 124, 'state': state, 'created_at': '2026-11-23T12:02:01Z', 'updated_at': '2026-11-23T12:02:01Z'}
            api.pages[1] = [newer, api.status]
            with self.subTest(state=state), self.assertRaises(a.Rejected):
                a.check(self.env, HEAD, self.pin, self.proofs, api, NOW)

    def test_newest_wrong_actor_or_case_variant_shadows_success(self):
        for change in [{'creator': {'id': 7}}, {'context': a.context(HEAD, RUN).upper(), 'state': 'failure'}]:
            api = FakeAPI(self.pin, self.proofs)
            api.pages[1] = [api.status | {'id': 124, 'created_at': '2026-11-23T12:02:01Z', 'updated_at': '2026-11-23T12:02:01Z'} | change, api.status]
            with self.assertRaises(a.Rejected): a.check(self.env, HEAD, self.pin, self.proofs, api, NOW)

    def test_tied_timestamp_duplicate_or_out_of_order_is_ambiguous(self):
        for rows in [[self.api.status | {'id': 124}, self.api.status], [self.api.status, self.api.status],
                     [self.api.status, self.api.status | {'id': 124, 'created_at': '2026-11-23T12:02:01Z'}]]:
            self.api.pages[1] = rows
            with self.assertRaises(a.Rejected): self.check()

    def test_paginated_approval_and_new_head_snapshot_race(self):
        unrelated = [self.api.status | {'id': 1000 + i, 'context': f'unrelated/{i}'} for i in range(100)]
        self.api.pages = {1: unrelated, 2: [self.api.status]}
        self.assertEqual(self.check()['status_id'], 123)
        self.assertTrue(any('page=2' in path for path in self.api.calls))
        self.api = FakeAPI(self.pin, self.proofs); self.api.race = True
        with self.assertRaises(a.Rejected): self.check()

    def test_truncated_or_unbounded_status_history_rejected(self):
        for page in range(1, a.MAX_PAGES + 1):
            self.api.pages[page] = [self.api.status | {'id': page * 1000 + i, 'context': f'unrelated/{page}/{i}'} for i in range(100)]
        with self.assertRaises(a.Rejected): self.check()

    def test_current_main_drift_before_or_after_snapshot(self):
        self.api.main = 'b' * 40
        with self.assertRaises(a.Rejected): self.check()
        self.api.main = HEAD; self.api.main_race = True; self.api.main_reads = 0
        with self.assertRaises(a.Rejected): self.check()

    def test_api_latency_does_not_extend_expiry_at_acceptance(self):
        for moments in [[NOW, NOW + dt.timedelta(seconds=600)],
                        [NOW, NOW, NOW + dt.timedelta(seconds=600)]]:
            values = list(moments)
            class ClockDateTime(dt.datetime):
                @classmethod
                def now(cls, tz=None): return values.pop(0)
            api = FakeAPI(self.pin, self.proofs)
            with patch.object(a.dt, 'datetime', ClockDateTime), self.assertRaises(a.Rejected):
                a.check(self.env, HEAD, self.pin, self.proofs, api)

    def test_late_approval_is_seen_by_execution_time_reads(self):
        clock = [0]; factories = []
        def factory(token, deadline):
            api = FakeAPI(self.pin, self.proofs)
            if not factories: api.pages = {1: []}
            factories.append(api)
            return api
        check = a.check
        with patch.object(a, 'check', side_effect=lambda *args: check(*args, now=NOW)):
            receipt = a.authorize(self.env, HEAD, self.pin, self.proofs, 'synthetic', 10,
                api_factory=factory, clock=lambda: clock[0], sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds))
        self.assertEqual(receipt['status_id'], 123)
        self.assertEqual(len(factories), 2)
        self.assertEqual(clock[0], 5)

    def test_failed_read_not_polled_and_missing_wait_is_bounded(self):
        clock = [0]; count = []
        def factory(token, deadline):
            api = FakeAPI(self.pin, self.proofs); api.pages = {1: []}; count.append(api); return api
        check = a.check
        with patch.object(a, 'check', side_effect=lambda *args: check(*args, now=NOW)), self.assertRaises(a.Missing):
            a.authorize(self.env, HEAD, self.pin, self.proofs, 'synthetic', 5, api_factory=factory,
                        clock=lambda: clock[0], sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds))
        self.assertEqual(clock[0], 5)
        with patch.object(a, 'check', side_effect=a.Rejected('API failure')) as call, self.assertRaises(a.Rejected):
            a.authorize(self.env, HEAD, self.pin, self.proofs, 'synthetic', 300)
        self.assertEqual(call.call_count, 1)


class HTTP(unittest.TestCase):
    def response(self, body=b'{}', *, status=200, url=a.API_ROOT):
        class Response:
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def geturl(self): return url
            def read(self, n): return body[:n]
        result = Response(); result.status = status
        return result

    def test_get_only_exact_origin_and_no_token_logging(self):
        with patch.object(a.urllib.request, 'build_opener') as build:
            opener = build.return_value; opener.open.return_value = self.response()
            with patch.object(a.time, 'monotonic', return_value=0):
                self.assertEqual(a.ReadAPI('synthetic-sensitive-token', 100).get(''), {})
            request = opener.open.call_args.args[0]
            self.assertEqual(request.get_method(), 'GET')
            self.assertEqual(request.full_url, a.API_ROOT)
            self.assertEqual(request.get_header('Authorization'), 'Bearer synthetic-sensitive-token')
            self.assertLessEqual(opener.open.call_args.kwargs['timeout'], 8)
        self.assertIsNone(a.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other/'))

    def test_redirect_http_error_timeout_bad_json_duplicates_and_size_fail_closed(self):
        cases = [self.response(status=302), self.response(url='https://other/'), self.response(body=b'{'),
                 self.response(body=b'{"id":1,"id":2}'), self.response(body=b'x' * (a.MAX_BODY + 1))]
        for response in cases:
            with self.subTest(response=response), patch.object(a.time, 'monotonic', return_value=0), patch.object(a.urllib.request, 'build_opener') as build:
                build.return_value.open.return_value = response
                with self.assertRaises(a.Rejected): a.ReadAPI('synthetic', 100).get('')
        for error in [urllib.error.HTTPError(a.API_ROOT, 302, 'synthetic-sensitive-token', {}, None), TimeoutError('synthetic-sensitive-token')]:
            with patch.object(a.time, 'monotonic', return_value=0), patch.object(a.urllib.request, 'build_opener') as build:
                build.return_value.open.side_effect = error
                with self.assertRaises(a.Rejected) as caught: a.ReadAPI('synthetic-sensitive-token', 100).get('')
                self.assertNotIn('synthetic-sensitive-token', str(caught.exception))

    def test_deadline_and_unsafe_path_fail_without_network(self):
        with patch.object(a.urllib.request, 'build_opener') as build:
            for path in ['https://other/', '/other', '../escape', 'x#fragment', 'x%2fother']:
                with self.assertRaises(a.Rejected): a.ReadAPI('synthetic', 100).get(path)
            with patch.object(a.time, 'monotonic', return_value=100), self.assertRaises(a.Rejected):
                a.ReadAPI('synthetic', 100).get('')
            build.assert_not_called()


class Ordering(unittest.TestCase):
    def setUp(self):
        self.pin, self.proofs = p.load_approval()
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name); self.output = self.folder / 'verified'

    def invoke(self, mode, failure=False):
        def download(path, *args): path.write_bytes(b'zip')
        def verify(*args): self.output.mkdir(); return {'synthetic': True}
        stack = __import__('contextlib').ExitStack()
        stack.enter_context(patch.object(sys, 'argv', ['promote.py', mode, str(self.output)]))
        stack.enter_context(patch.dict(os.environ, environment() | {'GH_TOKEN': 'synthetic', 'GITHUB_OUTPUT': str(self.folder / 'outputs')}, clear=True))
        stack.enter_context(patch.object(p.subprocess, 'check_output', return_value=HEAD + '\n'))
        stack.enter_context(patch.object(p, 'load_approval', return_value=(self.pin, self.proofs)))
        metadata = stack.enter_context(patch.object(p, 'original_metadata'))
        approved = a.check(environment(), HEAD, self.pin, self.proofs, FakeAPI(self.pin, self.proofs), NOW)
        auth = stack.enter_context(patch.object(a, 'authorize', side_effect=a.Rejected('revoked') if failure else None, return_value=approved))
        fetched = stack.enter_context(patch.object(p, 'download', side_effect=download))
        stack.enter_context(patch.object(p, 'verify_package', side_effect=verify))
        return stack, auth, fetched, metadata

    def test_verify_only_never_authorizes_or_writes_delivery_outputs(self):
        stack, auth, fetched, _ = self.invoke('verify-only')
        with stack: p.main()
        auth.assert_not_called()
        self.assertTrue(json.loads((self.output / 'pwa-promotion-receipt.json').read_text())['validation_only'])
        self.assertIsNone(json.loads((self.output / 'pwa-promotion-receipt.json').read_text())['run_approval'])
        self.assertFalse((self.folder / 'outputs').exists())

    def test_failed_fetch_approval_never_downloads_or_writes_outputs(self):
        stack, auth, fetched, metadata = self.invoke('fetch', failure=True)
        with stack, self.assertRaises(a.Rejected): p.main()
        metadata.assert_called_once(); auth.assert_called_once(); fetched.assert_not_called()
        self.assertFalse(self.output.exists()); self.assertFalse((self.folder / 'outputs').exists())

    def test_original_ci_failure_prevents_approval_and_fetch(self):
        stack, auth, fetched, metadata = self.invoke('fetch')
        metadata.side_effect = p.Invalid('original CI proof rejected')
        with stack, self.assertRaises(p.Invalid): p.main()
        auth.assert_not_called(); fetched.assert_not_called()
        self.assertFalse(self.output.exists()); self.assertFalse((self.folder / 'outputs').exists())

    def test_successful_fetch_has_approval_before_outputs(self):
        stack, auth, fetched, _ = self.invoke('fetch')
        with stack: p.main()
        self.assertEqual(json.loads((self.output / 'pwa-promotion-receipt.json').read_text())['run_approval']['status_id'], 123)
        self.assertIn('ops=' + self.pin['required_installed_ops_sha256'], (self.folder / 'outputs').read_text())

    def test_verify_only_receipt_cannot_be_rechecked_for_delivery(self):
        stack, _, _, _ = self.invoke('verify-only')
        with stack: p.main()
        with self.assertRaises(p.Invalid): p.fetch_receipt(self.output, environment(), HEAD, self.pin, self.proofs)

    def test_pre_ssh_revocation_rejects_before_new_receipt(self):
        self.output.mkdir(); stack, auth, fetched, _ = self.invoke('check-delivery', failure=True)
        with stack, patch.object(p, 'fetch_receipt'), self.assertRaises(a.Rejected): p.main()
        self.assertFalse((self.output / 'run-approval-pre-ssh.json').exists()); fetched.assert_not_called()

    def test_last_mile_requires_fresh_same_run_lease(self):
        self.output.mkdir(); approved = a.check(environment(), HEAD, self.pin, self.proofs, FakeAPI(self.pin, self.proofs), NOW)
        (self.output / 'run-approval-pre-ssh.json').write_text(json.dumps(approved))
        with patch.object(p, 'fetch_receipt'):
            self.assertEqual(p.transport_ready(self.output, environment(), HEAD, self.pin, self.proofs, NOW)['status_id'], 123)
            with self.assertRaises(p.Invalid): p.transport_ready(self.output, environment(), HEAD, self.pin, self.proofs, NOW + dt.timedelta(seconds=31))
            with self.assertRaises(p.Invalid): p.transport_ready(self.output, environment() | {'GITHUB_RUN_ID': str(RUN + 1)}, HEAD, self.pin, self.proofs, NOW)

    def test_workflow_rechecks_without_key_then_limits_secret_to_transport(self):
        raw = (p.ROOT / '.github/workflows/promote_pwa.yml').read_text()
        before_key, after_key = raw.split('          DEPLOY_KEY:', 1)
        self.assertIn('check-delivery verified', before_key)
        self.assertIn('statuses: read', before_key)
        self.assertNotIn('statuses: write', raw)
        self.assertIn('transport-ready verified', after_key)
        self.assertNotIn('DEPLOY_ENABLED: true', raw)
        self.assertIn("vars.WIPSTER_DEPLOY_ENABLED == 'false'", raw)
        self.assertNotIn('WIPSTER_PWA_APPROVED_RUN_ID', raw)


if __name__ == '__main__':
    unittest.main()

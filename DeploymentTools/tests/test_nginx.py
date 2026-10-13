"""Local tests; never connect to EC2 or change system Nginx files."""
import importlib.util
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('task_management_nginx', Path(__file__).parents[1] / 'configure_task_management_nginx.py')
nginx = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = nginx
spec.loader.exec_module(nginx)
HOST = 'app.parallelsystems.com.au'
CONFIG = '''# comment with { braces }
server {
    listen 80;
    server_name app.parallelsystems.com.au;
    root /var/www/parallel-systems-timesheet/current;
    location / { try_files $uri $uri/ /index.html; }
    location /api/ { proxy_pass http://127.0.0.1:5185; }
    location = /health { proxy_pass http://127.0.0.1:5185; }
    add_header X-Example "literal { brace ; # text }";
}
'''


def temporary_fixture(prefix):
    root = Path(__file__).parents[2] / 'test-results'
    root.mkdir(exist_ok=True)
    return tempfile.TemporaryDirectory(prefix=prefix, dir=root)


class NginxSetupChecks(unittest.TestCase):
    def test_task_upload_proxy_preserves_headers_and_does_not_change_shared_api(self):
        original = CONFIG.replace('proxy_pass http://127.0.0.1:5185;',
                                  'proxy_pass http://127.0.0.1:5185; proxy_set_header X-Forwarded-Proto $scheme; client_max_body_size 1m;')
        location = nginx.task_api_location(original, HOST)[0]
        self.assertIn('location ^~ /api/task-management/', location)
        self.assertIn('proxy_set_header X-Forwarded-Proto $scheme;', location)
        self.assertIn('client_max_body_size 12m;', location)
        self.assertNotIn('client_max_body_size 1m;', location)
        self.assertIn('proxy_pass http://127.0.0.1:5185;', location)
        self.assertIn('client_max_body_size 1m;', nginx.plan_config(original, HOST)[0])

    def test_task_upload_proxy_preserves_api_uri_mapping(self):
        original = CONFIG.replace('proxy_pass http://127.0.0.1:5185;', 'proxy_pass http://127.0.0.1:5185/api/;')
        self.assertIn('proxy_pass http://127.0.0.1:5185/api/task-management/;', nginx.task_api_location(original, HOST)[0])

    def test_custom_api_rewrites_stop_before_upload_configuration(self):
        with self.assertRaises(ValueError):
            nginx.task_api_location(CONFIG.replace('proxy_pass http://127.0.0.1:5185;', 'proxy_pass http://127.0.0.1:5185/custom/;'), HOST)
        with self.assertRaises(ValueError):
            nginx.task_api_location(CONFIG.replace('location /api/', 'location /custom-api/'), HOST)

    def test_existing_ip_named_site_can_be_selected_explicitly(self):
        original = CONFIG.replace(HOST, '3.24.250.195')
        updated, matched = nginx.plan_config(original, '3.24.250.195')
        self.assertEqual(matched, 1)
        self.assertIn(nginx.INCLUDE, updated)
        self.assertIn('server_name 3.24.250.195;', updated)

    def test_preserves_timesheet_api_and_health(self):
        updated, matched = nginx.plan_config(CONFIG, HOST)
        self.assertEqual(matched, 1)
        self.assertIn(nginx.INCLUDE, updated)
        self.assertIn('root /var/www/parallel-systems-timesheet/current;', updated)
        for route in ['location / { try_files $uri $uri/ /index.html; }',
                      'location /api/ { proxy_pass http://127.0.0.1:5185; }',
                      'location = /health { proxy_pass http://127.0.0.1:5185; }']:
            self.assertIn(route, updated)
        self.assertEqual(len(nginx.parse(updated)), 1)

    def test_existing_receipts_include_and_locations_are_preserved(self):
        receipts = 'include /etc/nginx/snippets/parallel-systems-receipts.conf;'
        original = CONFIG.replace('listen 80;', f'listen 80; {receipts}')
        updated, count = nginx.plan_config(original, HOST)
        self.assertEqual(count, 1)
        self.assertIn(receipts, updated)
        self.assertIn(nginx.INCLUDE, updated)
        direct_location = 'location /receipts/ { root /var/www/parallel-systems-receipts/current; }'
        original = CONFIG.replace('listen 80;', f'listen 80; {direct_location}')
        updated, count = nginx.plan_config(original, HOST)
        self.assertEqual(count, 1)
        self.assertIn(direct_location, updated)

    def test_second_deployment_is_idempotent(self):
        first, _ = nginx.plan_config(CONFIG, HOST)
        second, count = nginx.plan_config(first, HOST)
        self.assertEqual(first, second)
        self.assertEqual(count, 1)

    def test_other_domain_untouched(self):
        original = CONFIG.replace(HOST, 'other.example.com')
        self.assertEqual(nginx.plan_config(original, HOST), (original, 0))

    def test_other_root_untouched(self):
        original = CONFIG.replace(nginx.TIMESHEET_ROOT, '/var/www/something-else')
        self.assertEqual(nginx.plan_config(original, HOST), (original, 0))

    def test_unnamed_default_can_be_selected_explicitly(self):
        original = CONFIG.replace(HOST, '_').replace('listen 80;', 'listen 80 default_server;')
        self.assertEqual(nginx.plan_config(original, HOST)[1], 0)
        updated, count = nginx.plan_config(original, HOST, default_server=True)
        self.assertEqual(count, 1)
        self.assertIn(nginx.INCLUDE, updated)

    def test_named_other_default_is_never_selected(self):
        original = CONFIG.replace(HOST, 'other.example.com').replace('listen 80;', 'listen 80 default_server;')
        self.assertEqual(nginx.plan_config(original, HOST, default_server=True), (original, 0))

    def test_unnamed_nondefault_is_never_selected(self):
        original = CONFIG.replace(HOST, '_')
        self.assertEqual(nginx.plan_config(original, HOST, default_server=True), (original, 0))

    def test_redirect_block_untouched(self):
        original = CONFIG.replace('listen 80;', 'listen 80; return 301 https://$host$request_uri;')
        self.assertEqual(nginx.plan_config(original, HOST), (original, 0))

    def test_http_and_https_content_blocks(self):
        updated, count = nginx.plan_config(CONFIG + CONFIG.replace('listen 80;', 'listen 443 ssl;'), HOST)
        self.assertEqual(count, 2)
        self.assertEqual(updated.count(nginx.INCLUDE), 2)

    def test_quoted_root_and_nested_if(self):
        original = CONFIG.replace(nginx.TIMESHEET_ROOT, '"' + nginx.TIMESHEET_ROOT + '"')
        original = original.replace('listen 80;', 'listen 80; if ($scheme = http) { return 301 https://$host$request_uri; }')
        self.assertEqual(nginx.plan_config(original, HOST)[1], 1)

    def test_conflicting_task_location_fails(self):
        original = CONFIG.replace('listen 80;', 'listen 80; location /task-management/ { root /other; }')
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            nginx.plan_config(original, HOST)

    def test_duplicate_include_fails(self):
        original = CONFIG.replace('listen 80;', 'listen 80; ' + nginx.INCLUDE * 2)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            nginx.plan_config(original, HOST)

    def test_invalid_config_fails_closed(self):
        for text in ['server {', 'server { root "unfinished;', '}', 'server root /oops']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                nginx.parse(text)

    def test_paths_outside_nginx_rejected(self):
        with self.assertRaises(ValueError):
            nginx.checked_nginx_path('/var/www/other.conf')

    def test_syntax_failure_restores_config_and_removes_only_new_snippet(self):
        with temporary_fixture('task-nginx-check-') as folder:
            root = Path(folder)
            config = root / 'site.conf'
            config.write_text(CONFIG)
            snippet = root / 'snippets' / 'tasks.conf'
            source = Path(__file__).parents[1] / 'task-management.nginx.conf'
            state = root / 'backups' / 'state.json'
            result = subprocess.CompletedProcess([], 0, stdout=f'# configuration file {config}:\n', stderr='')
            with patch.object(nginx, 'SNIPPET', snippet), \
                 patch.object(nginx, 'INCLUDE', f'include {snippet};'), \
                 patch.object(nginx, 'checked_nginx_path', side_effect=lambda path: Path(path).resolve()), \
                 patch.object(nginx.subprocess, 'run', side_effect=[result, subprocess.CalledProcessError(1, 'nginx')]):
                with self.assertRaises(subprocess.CalledProcessError):
                    nginx.prepare(HOST, source, state)
                self.assertEqual(config.read_text(), CONFIG)
                self.assertFalse(snippet.exists())
                self.assertTrue(state.exists())

    def test_success_and_explicit_restore_preserve_existing_snippet(self):
        with temporary_fixture('task-nginx-check-') as folder:
            root = Path(folder)
            config = root / 'site.conf'
            config.write_text(CONFIG)
            snippet = root / 'tasks.conf'
            original_snippet = '# Parallel Systems Task Management deployment-managed snippet\n# older version\n'
            snippet.write_text(original_snippet)
            source = Path(__file__).parents[1] / 'task-management.nginx.conf'
            state = root / 'backups' / 'state.json'
            result = subprocess.CompletedProcess([], 0, stdout=f'# configuration file {config}:\n', stderr='')
            with patch.object(nginx, 'SNIPPET', snippet), \
                 patch.object(nginx, 'INCLUDE', f'include {snippet};'), \
                 patch.object(nginx, 'checked_nginx_path', side_effect=lambda path: Path(path).resolve()), \
                 patch.object(nginx.subprocess, 'run', side_effect=[result, subprocess.CompletedProcess([], 0)]):
                nginx.prepare(HOST, source, state)
                self.assertIn(f'include {snippet};', config.read_text())
                self.assertTrue(snippet.read_text().startswith(source.read_text()))
                self.assertIn('location ^~ /api/task-management/', snippet.read_text())
                self.assertIn('client_max_body_size 12m;', snippet.read_text())
                nginx.restore(state)
                self.assertEqual(config.read_text(), CONFIG)
                self.assertEqual(snippet.read_text(), original_snippet)


class TaskManagementReadinessChecks(unittest.TestCase):
    """Execute the actual Bash probe with fake curl/sleep; no network or sudo."""

    def run_probe(self, scenario):
        git_bash = Path('C:/Program Files/Git/bin/bash.exe')
        bash = str(git_bash) if os.name == 'nt' and git_bash.exists() else shutil.which('bash')
        if not bash:
            self.fail('Bash is required to verify the task deployment readiness checks.')
        source = (Path(__file__).parents[1] / 'deploy_task_management.sh').read_text()
        start = source.index('site_curl() {')
        functions = source[start:source.index('\nfor tool in ', start)]
        task = b'<html>task release</html>'
        timesheet = b'<html>timesheet release</html>'
        harness = r'''
set -Eeuo pipefail
# Git Bash launched from Python on Windows does not initialize its utility PATH.
export PATH="/usr/bin:/bin:$PATH"
origin=http://3.24.250.195
site_host=3.24.250.195
scenario=$1
expected=$2
timesheet_before=$3
curl() {
    printf '%s\n' "$@" > curl-args.txt
    local output='' calls body=task.txt status=200 code=0
    while [ "$#" -gt 0 ]; do
        if [ "$1" = '--output' ]; then
            output=$2
            shift 2
        else
            shift
        fi
    done
    calls=$(<attempts.txt)
    calls=$((calls + 1))
    printf '%s' "$calls" > attempts.txt
    case "$scenario" in
        delayed)
            if [ "$calls" -lt 3 ]; then
                body=timesheet.txt
            fi
            ;;
        permanent-timesheet)
            body=timesheet.txt
            ;;
        unknown-body)
            body=other.txt
            ;;
        non-200)
            status=503
            ;;
        transport-error)
            if [ "$calls" -eq 1 ]; then
                status=000
                code=7
            fi
            ;;
    esac
    cp "$body" "$output" || return 99
    printf '%s' "$status"
    return "$code"
}
sleep() {
    printf '%s\n' "$1" >> sleeps.txt
}
'''
        harness += functions + '\nwait_for_task_shell "$expected" response.body\n'
        with temporary_fixture('task-readiness-') as folder:
            root = Path(folder)
            (root / 'task.txt').write_bytes(task)
            (root / 'timesheet.txt').write_bytes(timesheet)
            (root / 'other.txt').write_bytes(b'wrong page')
            (root / 'attempts.txt').write_text('0')
            result = subprocess.run(
                [bash, '-c', harness, 'task-probe-test', scenario,
                 hashlib.sha256(task).hexdigest(), hashlib.sha256(timesheet).hexdigest()],
                cwd=root, capture_output=True, text=True, timeout=15,
            )
            self.assertTrue((root / 'curl-args.txt').exists(), result.stderr)
            sleeps = (root / 'sleeps.txt').read_text().splitlines() if (root / 'sleeps.txt').exists() else []
            return result, int((root / 'attempts.txt').read_text()), sleeps, (root / 'curl-args.txt').read_text()

    def test_immediate_correct_page_needs_no_delay(self):
        result, attempts, sleeps, args = self.run_probe('immediate')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(attempts, 1)
        self.assertEqual(sleeps, [])
        for argument in ['Host: 3.24.250.195', 'Cache-Control: no-cache', '--max-time\n3',
                         '--connect-timeout\n2', 'http://3.24.250.195/task-management/']:
            self.assertIn(argument, args)

    def test_old_timesheet_workers_are_retried_until_tasks_appears(self):
        result, attempts, sleeps, _ = self.run_probe('delayed')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(attempts, 3)
        self.assertEqual(sleeps, ['1', '1'])
        self.assertIn('attempt 3/10', result.stdout)

    def test_persistent_timesheet_fallback_fails_with_diagnostics(self):
        result, attempts, sleeps, _ = self.run_probe('permanent-timesheet')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(attempts, 10)
        self.assertEqual(sleeps, ['1'] * 9)
        self.assertIn('The response is the Timesheet page', result.stderr)
        self.assertIn('Expected SHA-256:', result.stderr)
        self.assertIn('HTTP 200, curl exit 0', result.stderr)
        self.assertIn('Last response retained for inspection: response.body', result.stderr)
        self.assertNotIn('<html>', result.stderr)

    def test_another_wrong_page_is_not_accepted(self):
        result, attempts, _, _ = self.run_probe('unknown-body')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(attempts, 10)
        self.assertNotIn('The response is the Timesheet page', result.stderr)

    def test_matching_body_with_error_http_status_is_not_accepted(self):
        result, attempts, _, _ = self.run_probe('non-200')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(attempts, 10)
        self.assertIn('HTTP 503', result.stderr)

    def test_transport_error_is_retried_even_with_matching_body(self):
        result, attempts, sleeps, _ = self.run_probe('transport-error')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(attempts, 2)
        self.assertEqual(sleeps, ['1'])
        self.assertIn('curl exit 7', result.stderr)


if __name__ == '__main__':
    unittest.main()

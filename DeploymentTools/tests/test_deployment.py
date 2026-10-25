"""Exercise the actual Bash API probe and rollback with local command mocks."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import json
import unittest

from test_nginx import temporary_fixture


def run_bash(source, arguments, directory):
    git_bash = Path('C:/Program Files/Git/bin/bash.exe')
    bash = str(git_bash) if os.name == 'nt' and git_bash.exists() else shutil.which('bash')
    if not bash:
        raise AssertionError('Bash is required for the deployment checks.')
    return subprocess.run(
        [bash, '-c', source, 'task-deployment-test', *arguments],
        cwd=directory,
        capture_output=True,
        text=True,
        timeout=15,
    )


class PreflightChecks(unittest.TestCase):
    def test_failed_routes_identify_the_url_before_activation(self):
        source = (Path(__file__).parents[1] / 'deploy_task_management.sh').read_text()
        preflight = source[source.index('if ! timesheet_before='):source.index('\nif [ -L "$current" ]')]
        preflight = preflight.replace('/var/www/parallel-systems-receipts/current', 'receipts-current')
        harness = '''
set -Eeuo pipefail
origin=https://app.parallelsystems.com.au
site_host=app.parallelsystems.com.au
failed_path=$1
site_curl() {
    local url="${@: -1}"
    if [ "$url" = "$origin$failed_path" ]; then
        echo 'curl: (22) The requested URL returned error: 404' >&2
        return 22
    fi
    printf 'page\n'
}
test() {
    return 0
}
sha256sum() {
    if [ "$#" -eq 0 ]; then
        cat >/dev/null
    fi
    printf 'expected-hash  file\n'
}
'''
        for path, label in [('/', 'Timesheet'), ('/receipts/', 'Receipts'), ('/health', 'Shared API health')]:
            with self.subTest(path=path), temporary_fixture('task-preflight-') as folder:
                (Path(folder) / 'receipts-current').mkdir()
                result = run_bash(harness + preflight, [path], folder)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn(label + ' preflight failed', result.stderr)
                self.assertIn('https://app.parallelsystems.com.au' + path, result.stderr)
                self.assertIn('No release was activated.', result.stderr)

    def test_passing_preflight_preserves_hashes(self):
        source = (Path(__file__).parents[1] / 'deploy_task_management.sh').read_text()
        preflight = source[source.index('if ! timesheet_before='):source.index('\nif [ -L "$current" ]')]
        preflight = preflight.replace('/var/www/parallel-systems-receipts/current', 'receipts-current')
        harness = '''
set -Eeuo pipefail
origin=https://app.parallelsystems.com.au
site_host=app.parallelsystems.com.au
site_curl() {
    printf 'page\n'
}
test() {
    return 0
}
sha256sum() {
    if [ "$#" -eq 0 ]; then
        cat >/dev/null
    fi
    printf 'expected-hash  file\n'
}
check_task_api() {
    printf 'Task API checked.\n'
}
'''
        with temporary_fixture('task-preflight-') as folder:
            (Path(folder) / 'receipts-current').mkdir()
            result = run_bash(harness + preflight + '\nprintf "%s|%s\\n" "$timesheet_before" "$receipts_before"\n', [], folder)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('expected-hash|expected-hash', result.stdout)
            self.assertIn('Task API checked.', result.stdout)


class SessionProbeChecks(unittest.TestCase):
    def test_only_unauthenticated_401_is_accepted(self):
        source = (Path(__file__).parents[1] / 'deploy_task_management.sh').read_text()
        function = source[source.index('check_task_api() {'):source.index('\nfor tool in ')]
        harness = '''
set -Eeuo pipefail
origin=https://app.parallelsystems.com.au
probe_status=$1
transport=$2
site_curl() {
    printf '%s\n' "$@" > args.txt
    printf '%s' "$probe_status"
    return "$transport"
}
'''
        harness += function + '\ncheck_task_api\n'
        for status, transport, expected in [('401', '0', 0), ('404', '0', 1),
                                            ('200', '0', 1), ('302', '0', 1), ('401', '7', 7)]:
            with self.subTest(status=status, transport=transport), temporary_fixture('task-api-') as folder:
                result = run_bash(harness, [status, transport], folder)
                self.assertEqual(result.returncode, expected, result.stderr)
                arguments = (Path(folder) / 'args.txt').read_text()
                self.assertIn('/api/task-management/auth/me', arguments)
                self.assertNotIn('--location', arguments)
                self.assertNotIn('--cookie', arguments)


class RollbackChecks(unittest.TestCase):
    def run_rollback(self, previous, activated='1', restore_failure='0'):
        source = (Path(__file__).parents[1] / 'deploy_task_management.sh').read_text()
        function = source[source.index('rollback() {'):source.index('\ntrap rollback EXIT')]
        harness = '''
set -Eeuo pipefail
previous=$1
activated=$2
restore_failure=$3
current=task-current
stamp=test-release
release=task-release
state=state.json
helper=helper.py
ln() {
    printf 'ln %s\n' "$*" >> operations.txt
}
mv() {
    printf 'mv %s\n' "$*" >> operations.txt
}
unlink() {
    printf 'unlink %s\n' "$*" >> operations.txt
}
test() {
    printf 'test %s\n' "$*" >> operations.txt
}
python3() {
    printf 'python3 %s\n' "$*" >> operations.txt
    return "$restore_failure"
}
nginx() {
    printf 'nginx %s\n' "$*" >> operations.txt
}
systemctl() {
    printf 'systemctl %s\n' "$*" >> operations.txt
}
'''
        harness += function + '\ntrap rollback EXIT\nexit 7\n'
        with temporary_fixture('task-rollback-') as folder:
            (Path(folder) / 'state.json').write_text('{}')
            result = run_bash(harness, [previous, activated, restore_failure], folder)
            self.assertEqual(result.returncode, 7, result.stderr)
            operations = (Path(folder) / 'operations.txt').read_text()
            return result, operations

    def test_previous_release_and_nginx_are_restored(self):
        result, operations = self.run_rollback('previous-task-release')
        self.assertIn('ln -s previous-task-release task-current.rollback-test-release', operations)
        self.assertIn('mv -Tf task-current.rollback-test-release task-current', operations)
        self.assertIn('python3 helper.py restore --state state.json', operations)
        self.assertIn('systemctl reload nginx', operations)
        self.assertNotIn('unlink', operations)
        self.assertIn('Rollback completed.', result.stderr)

    def test_first_deployment_only_unlinks_the_new_current(self):
        result, operations = self.run_rollback('')
        self.assertIn('test -L task-current\nunlink task-current', operations)
        self.assertNotIn('mv ', operations)
        self.assertIn('Rollback completed.', result.stderr)

    def test_failure_before_switch_does_not_touch_current(self):
        _, operations = self.run_rollback('previous-task-release', activated='0')
        self.assertNotIn('ln ', operations)
        self.assertNotIn('mv ', operations)
        self.assertNotIn('unlink ', operations)
        self.assertIn('restore --state state.json', operations)

    def test_restore_failure_reports_attention_and_preserves_original_exit(self):
        result, _ = self.run_rollback('previous-task-release', restore_failure='1')
        self.assertIn('ROLLBACK NEEDS ATTENTION.', result.stderr)


@unittest.skipUnless(os.name == 'nt', 'Tests the Windows-built SSH command.')
class RemoteCommandChecks(unittest.TestCase):
    def run_remote_command(self, missing_script=False, script_exit=0, sed_failure=False):
        launcher = (Path(__file__).parents[1] / 'Deploy-ParallelSystems-TaskManagement.ps1').read_text()
        assignments = launcher[launcher.index('    $remotePipeline ='):launcher.index("    Invoke-NativeCommand 'ssh.exe'")]
        with temporary_fixture('task-command-') as folder:
            root = Path(folder)
            script = root / 'helper.sh'
            script.write_bytes(b'printf \'%s|%s\\n\' "$1" "$8"\r\n' + f'exit {script_exit}\r\n'.encode())
            if missing_script:
                script.unlink()
            script_path = '/c' + script.as_posix()[2:]
            capture = root / 'capture_remote.py'
            capture.write_text('import json, sys\nprint(json.dumps(sys.argv[1:]))\n')
            command_source = f"""
$remoteScript = '{script_path}'
$remoteZip = 'task.zip'
$remoteHelper = 'helper.py'
$remoteSnippet = 'snippet.conf'
$origin = 'https://example.com'
$siteHost = 'example.com'
$stamp = '20261012-120000-12345678'
$skip = '0'
$archiveHash = '{'a' * 64}'
{assignments}
# Exercise Windows PowerShell's native argument serialization, as ssh.exe does.
& '{sys.executable}' '{capture}' '-i' 'fixture-key' 'ubuntu@example.com' $remoteCommand
"""
            powershell_script = root / 'capture.ps1'
            powershell_script.write_text(command_source)
            built = subprocess.run(
                ['powershell.exe', '-NoProfile', '-File', str(powershell_script)],
                capture_output=True, text=True, timeout=15,
            )
            self.assertEqual(built.returncode, 0, built.stderr)
            native_arguments = json.loads(built.stdout)
            self.assertEqual(native_arguments[:-1], ['-i', 'fixture-key', 'ubuntu@example.com'])
            # Remove only command prefixes. The actual emitted quoting/pipeline is used.
            harness = '''
export PATH="/usr/bin:/bin:$PATH"
sudo() {
    "$@"
}
flock() {
    shift 2
    "$@"
}
export -f sudo flock
'''
            if sed_failure:
                harness += 'sed() { return 9; }\nexport -f sed\n'
            return run_bash(harness + native_arguments[-1], [], folder)

    def test_generated_command_preserves_arguments_and_normalizes_crlf(self):
        result = self.run_remote_command()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'task.zip|' + 'a' * 64)

    def test_missing_remote_script_fails_instead_of_reporting_success(self):
        result = self.run_remote_command(missing_script=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('No such file', result.stderr)

    def test_remote_script_failure_is_propagated(self):
        result = self.run_remote_command(script_exit=7)
        self.assertEqual(result.returncode, 7, result.stderr)

    def test_failed_script_reader_is_propagated_even_when_bash_receives_empty_input(self):
        result = self.run_remote_command(sed_failure=True)
        self.assertEqual(result.returncode, 9, result.stderr)


if __name__ == '__main__':
    unittest.main()

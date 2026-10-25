import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('../DeploymentTools/Deploy-ParallelSystems-TaskManagement.ps1', import.meta.url));
const windows = process.platform === 'win32';

function runLauncher(argumentsList = []) {
    return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, ...argumentsList], {
        input: 'NO\n',
        encoding: 'utf8',
        timeout: 15000,
    });
}

test('deployment PowerShell parses without syntax errors', { skip: !windows }, () => {
    const escaped = launcher.replaceAll("'", "''");
    const command = [
        '$tokens = $null',
        '$errors = $null',
        `[System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref] $tokens, [ref] $errors) | Out-Null`,
        'if ($errors.Count -gt 0) {',
        '    $errors | Out-String | Write-Output',
        '    exit 1',
        '}',
    ].join('\n');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
        encoding: 'utf8',
        timeout: 15000,
    });
    assert.equal(result.status, 0, result.error?.message || result.stdout || result.stderr);
});

test('declining deployment exits before building or uploading', { skip: !windows }, () => {
    const result = runLauncher();
    assert.equal(result.status, 0, result.error?.message || result.stdout || result.stderr);
    assert.match(result.stdout, /Cancelled\. Nothing was built, uploaded, or deployed\./);
    assert.match(result.stdout, /Deployment\/check URL: https:\/\/app\.parallelsystems\.com\.au\/task-management\//);
    assert.match(result.stdout, /Nginx hostname: app\.parallelsystems\.com\.au/);
    assert.doesNotMatch(result.stdout, /\[1\/5\]/);
});

test('deployment rejects unsafe URL and SSH arguments before work begins', { skip: !windows }, () => {
    for (const argumentsList of [
        ['-SiteUrl', 'http://example.com/receipts/'],
        ['-SiteUrl', 'https://example.com/?unexpected=1'],
        ['-SiteUrl', 'https://user:password@example.com'],
        ['-Server', 'ubuntu@example.com;echo unsafe'],
        ['-Server', '-ubuntu@example.com'],
        ['-NginxHost', 'example.com;echo unsafe'],
    ]) {
        const result = runLauncher(argumentsList);
        assert.equal(result.status, 1, result.error?.message || result.stdout || result.stderr);
        assert.match(result.stdout, /DEPLOYMENT FAILED:/);
        assert.doesNotMatch(result.stdout, /\[1\/5\]/);
    }
});

test('public deployment verification rejects Timesheet fallback and missing HTML despite HTTP success', { skip: !windows }, () => {
    const source = readFileSync(launcher, 'utf8');
    const assertion = source.match(/function Assert-TaskManagementShell \{[\s\S]*?\r?\n\}/)?.[0];
    assert.ok(assertion, 'Expected the actual launcher shell assertion.');
    const folder = mkdtempSync(join(tmpdir(), 'task-shell-'));
    const expected = join(folder, 'expected.html');
    const response = join(folder, 'response.html');
    const script = join(folder, 'check.ps1');
    const html = '<title>Task Management</title><script src="/task-management/assets/task.js"></script>';
    writeFileSync(expected, html);
    writeFileSync(script, `${assertion}\ntry {\n    Assert-TaskManagementShell -ExpectedPath '${expected}' -ResponsePath '${response}'\n}\ncatch {\n    Write-Output $_.Exception.Message\n    exit 1\n}\n`);
    try {
        for (const [body, status] of [[null, 1], ['<title>Parallel Systems</title><script src="/assets/timesheet.js"></script>', 1], [html, 0]]) {
            if (body !== null) {
                writeFileSync(response, body);
            }
            const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
                encoding: 'utf8',
                timeout: 15000,
                // PowerShell 5 must load its own modules when tests start from PowerShell 7.
                env: { ...process.env, PSModulePath: join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') },
            });
            assert.equal(result.status, status, result.error?.message || result.stdout || result.stderr);
            if (body?.includes('timesheet.js')) {
                assert.match(result.stdout + result.stderr, /Timesheet fallback/);
            }
        }
    }
    finally {
        rmSync(folder, { recursive: true, force: true });
    }
});

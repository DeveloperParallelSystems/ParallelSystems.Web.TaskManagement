"""Add one app-owned include to the active Timesheet vhost; restore on failure.

Run on EC2 with sudo. No third-party Python modules are required. Unknown or
ambiguous layouts stop before writes rather than replacing a whole server block.
"""
import argparse
from dataclasses import dataclass, field
from pathlib import Path
import re
import shutil
import subprocess
import json
from urllib.parse import urlsplit

SNIPPET = Path('/etc/nginx/snippets/parallel-systems-task-management.conf')
TIMESHEET_ROOT = '/var/www/parallel-systems-timesheet/current'
INCLUDE = f'include {SNIPPET};'


@dataclass
class Node:
    words: list
    start: int
    end: int
    closing: int = -1
    children: list = field(default_factory=list)


def tokenize(text):
    """Respect quotes, escapes and comments, including braces in quoted regexes."""
    tokens = []
    i = 0
    while i < len(text):
        if text[i].isspace():
            i += 1
            continue
        if text[i] == '#':
            newline = text.find('\n', i)
            i = len(text) if newline == -1 else newline + 1
            continue
        start = i
        if text[i] in '{};':
            tokens.append((text[i], start, i + 1))
            i += 1
            continue
        value = ''
        while i < len(text) and not text[i].isspace() and text[i] not in '{};#':
            if text[i] in "\"'":
                quote = text[i]
                i += 1
                while i < len(text) and text[i] != quote:
                    if text[i] == '\\' and i + 1 < len(text):
                        value += text[i:i + 2]
                        i += 2
                    else:
                        value += text[i]
                        i += 1
                if i >= len(text):
                    raise ValueError('Unclosed quote in Nginx configuration.')
                i += 1
            elif text.startswith('${', i):
                end = text.find('}', i + 2)
                if end == -1:
                    raise ValueError('Unclosed Nginx variable.')
                value += text[i:end + 1]
                i = end + 1
            elif text[i] == '\\' and i + 1 < len(text):
                value += text[i:i + 2]
                i += 2
            else:
                value += text[i]
                i += 1
        tokens.append((value, start, i))
    return tokens


def parse(text):
    tokens = tokenize(text)

    def level(index, nested=False):
        nodes = []
        while index < len(tokens):
            if tokens[index][0] == '}':
                if not nested:
                    raise ValueError('Unexpected closing brace in Nginx configuration.')
                return nodes, index + 1, tokens[index][1]
            start = tokens[index][1]
            words = []
            while index < len(tokens) and tokens[index][0] not in '{};':
                words.append(tokens[index][0])
                index += 1
            if not words or index == len(tokens):
                raise ValueError('Unsupported/incomplete Nginx directive.')
            symbol, _, end = tokens[index]
            index += 1
            if symbol == ';':
                nodes.append(Node(words, start, end))
            elif symbol == '{':
                children, index, closing = level(index, True)
                nodes.append(Node(words, start, tokens[index - 1][2], closing, children))
            else:
                raise ValueError('Unexpected Nginx block terminator.')
        if nested:
            raise ValueError('Unclosed Nginx block.')
        return nodes, index, -1

    return level(0)[0]


def walk(nodes):
    for node in nodes:
        yield node
        yield from walk(node.children)


def plan_config(text, host, default_server=False):
    edits = []
    matched = 0
    for server in walk(parse(text)):
        if server.words != ['server']:
            continue
        roots = [n.words[1:] for n in server.children if n.words[0] == 'root']
        names = [name for n in server.children if n.words[0] == 'server_name' for name in n.words[1:]]
        exact_host = host in names
        unnamed_default = not names or all(name == '_' for name in names)
        has_default_listener = any(n.words[0] == 'listen' and 'default_server' in n.words for n in server.children)
        selected_host = unnamed_default and has_default_listener if default_server else exact_host
        if [TIMESHEET_ROOT] not in roots or not selected_host:
            continue
        # Do not modify HTTP-to-HTTPS redirect-only servers.
        if any(n.words[0] == 'return' for n in server.children):
            continue
        matched += 1
        includes = [n for n in server.children if n.words == ['include', str(SNIPPET)]]
        if len(includes) > 1:
            raise ValueError('Duplicate task-management includes found; resolve these manually first.')
        for node in server.children:
            if node.words[0] == 'location' and any('task-management' in word for word in node.words[1:]):
                raise ValueError('An existing task-management location conflicts with the managed include.')
        if not includes:
            edits.append(server.closing)
    for closing in sorted(edits, reverse=True):
        text = text[:closing] + f'\n    # Parallel Systems Task Management (deployment-managed)\n    {INCLUDE}\n' + text[closing:]
    return text, matched


def checked_nginx_path(path):
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(Path('/etc/nginx')):
        raise ValueError(f'Refusing to modify configuration outside /etc/nginx: {resolved}')
    return resolved


def task_api_location(text, host, default_server=False):
    """Clone the existing API proxy settings into a task-only upload location."""
    locations = []
    for server in walk(parse(text)):
        if server.words != ['server']:
            continue
        names = [name for node in server.children if node.words[0] == 'server_name' for name in node.words[1:]]
        roots = [node.words[1:] for node in server.children if node.words[0] == 'root']
        unnamed = not names or all(name == '_' for name in names)
        default = any(node.words[0] == 'listen' and 'default_server' in node.words for node in server.children)
        selected = unnamed and default if default_server else host in names
        if not selected or [TIMESHEET_ROOT] not in roots or any(node.words[0] == 'return' for node in server.children):
            continue
        api = [node for node in server.children if node.words in (['location', '/api/'], ['location', '^~', '/api/'])]
        if len(api) != 1:
            raise ValueError('Expected one direct /api/ proxy to configure Task Management upload limits.')
        proxy = [node for node in api[0].children if node.words[0] == 'proxy_pass']
        if len(proxy) != 1 or len(proxy[0].words) != 2:
            raise ValueError('Expected one explicit API proxy_pass; configure Task Management uploads manually.')
        url = urlsplit(proxy[0].words[1])
        if url.scheme not in ('http', 'https') or not url.netloc or url.path not in ('', '/api/') or url.query or url.fragment or '$' in proxy[0].words[1]:
            raise ValueError('Unsupported API proxy URL; configure Task Management uploads manually.')
        body = []
        for node in api[0].children:
            if node.words[0] in ('rewrite', 'location', 'if'):
                raise ValueError('Custom API rewrite/nesting requires manual Task Management upload configuration.')
            if node.words[0] in ('client_max_body_size', 'proxy_read_timeout', 'proxy_send_timeout', 'client_body_timeout'):
                continue
            if node.words[0] == 'proxy_pass' and url.path == '/api/':
                body.append(f'proxy_pass {url.scheme}://{url.netloc}/api/task-management/;')
            else:
                body.append(text[node.start:node.end])
        body.extend(['client_max_body_size 12m;', 'proxy_read_timeout 180s;',
                     'proxy_send_timeout 180s;', 'client_body_timeout 180s;'])
        locations.append('location ^~ /api/task-management/ {\n    ' + '\n    '.join(body) + '\n}\n')
    return locations


def restore(state_path):
    state = json.loads(state_path.read_text())
    for entry in state['files']:
        target = checked_nginx_path(entry['path'])
        if entry['existed']:
            backup = Path(entry['backup'])
            if not backup.resolve().is_relative_to(state_path.parent.resolve()):
                raise ValueError('Invalid backup path.')
            shutil.copy2(backup, target)
        elif target == SNIPPET:
            target.unlink(missing_ok=True)
        else:
            raise ValueError('Refusing to remove an unexpected configuration file.')


def prepare(host, source, state_path):
    if not re.fullmatch(r'[A-Za-z0-9.-]+', host):
        raise ValueError('Expected an exact domain hostname.')
    if state_path.exists():
        raise ValueError('Backup state already exists; use a fresh release directory.')
    result = subprocess.run(['nginx', '-T'], capture_output=True, text=True)
    if result.returncode:
        raise ValueError('Current Nginx configuration is invalid; fix it before deploying.')
    paths = re.findall(r'^# configuration file (.+):$', result.stdout, re.MULTILINE)
    configs = {}
    for path in sorted(set(paths)):
        target = checked_nginx_path(path)
        configs[target] = target.read_text()
    updates = {}
    matches = 0
    task_proxies = []
    for target, text in configs.items():
        updated, count = plan_config(text, host)
        matches += count
        if count:
            task_proxies.extend(task_api_location(text, host))
        if updated != text:
            updates[target] = updated
    if not matches:
        # Some Timesheet setups use server_name _ and default_server. Only a
        # single known Timesheet config file may qualify; never another named site.
        defaults = []
        for target, text in configs.items():
            updated, count = plan_config(text, host, default_server=True)
            if count:
                defaults.append((target, text, updated, count))
        if len(defaults) == 1:
            target, text, updated, matches = defaults[0]
            task_proxies.extend(task_api_location(text, host, default_server=True))
            if updated != text:
                updates[target] = updated
            print('Using the unique unnamed default Timesheet server configuration.')
    if not matches:
        raise ValueError(
            f'No unambiguous active Timesheet server matches {host} and root {TIMESHEET_ROOT}. '
            'No files changed. See the deployment README for manual include setup.'
        )
    snippet = source.read_text()
    if not snippet.startswith('# Parallel Systems Task Management deployment-managed snippet'):
        raise ValueError('Unexpected task-management snippet source.')
    if len(set(task_proxies)) != 1:
        raise ValueError('Task Management API proxy differs between server blocks; configure uploads manually.')
    snippet += '\n# Task-only API upload limits; proxy settings copied from the active /api/ location.\n' + task_proxies[0]
    snippet_target = checked_nginx_path(SNIPPET)
    if snippet_target != SNIPPET:
        raise ValueError('Task Management snippet must not be a symlink.')
    if SNIPPET.exists() and not SNIPPET.read_text().startswith('# Parallel Systems Task Management deployment-managed snippet'):
        raise ValueError('Existing snippet is not deployment-managed; refusing to overwrite it.')
    updates[SNIPPET] = snippet
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.parent.chmod(0o700)
    entries = []
    for index, target in enumerate(updates):
        backup = state_path.parent / f'config-{index}.before'
        existed = target.exists()
        if existed:
            shutil.copy2(target, backup)
        entries.append({'path': str(target), 'backup': str(backup), 'existed': existed})
    state_path.write_text(json.dumps({'files': entries}, indent=2))
    try:
        for target, contents in updates.items():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(contents)
            if target == SNIPPET:
                target.chmod(0o644)
        subprocess.run(['nginx', '-t'], check=True)
    except Exception:
        restore(state_path)
        raise
    print(f'Task Management include ready in {matches} matching Timesheet server block(s).')
    print(f'Nginx backup state: {state_path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'restore'])
    parser.add_argument('--state', required=True, type=Path)
    parser.add_argument('--host')
    parser.add_argument('--snippet-source', type=Path)
    args = parser.parse_args()
    try:
        if args.action == 'restore':
            restore(args.state)
        else:
            if not args.host or not args.snippet_source:
                parser.error('prepare requires --host and --snippet-source')
            prepare(args.host, args.snippet_source, args.state)
    except Exception as error:
        raise SystemExit(f'Nginx task-management setup stopped: {error}')

#!/usr/bin/env python3
"""Native Pi/package/tmux tests; private sockets, temporary settings, no model calls."""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shlex
import shutil
import struct
import subprocess
import tempfile
import termios
import threading
import time
import unittest

REPO = Path(__file__).resolve().parent.parent


def eventually(predicate, message, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.05)
    raise AssertionError(message() if callable(message) else message)


def prompt_cursor_visible(screen):
    """Read tmux's captured SGR cells, not the hardware cursor or a guess."""
    inverse = False
    cells = []
    index = 0
    while index < len(screen):
        match = re.match(r"\x1b\[([0-9;]*)m", screen[index:])
        if match:
            for code in (int(part or 0) for part in match[1].split(';')):
                if code in (0, 27):
                    inverse = False
                elif code == 7:
                    inverse = True
            index += len(match[0])
        else:
            cells.append((screen[index], inverse))
            index += 1
    text = ''.join(cell[0] for cell in cells)
    start = text.find('CURSORTEST')
    return None if start < 0 else any(cell[1] for cell in cells[start:start + len('CURSORTEST') + 1])


@unittest.skipUnless(shutil.which('pi') and shutil.which('tmux'), 'Pi and tmux required')
class NativeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pi-focus-cursor-test-')
        self.root = Path(self.temporary.name)
        self.agent = self.root / 'agent'
        self.agent.mkdir()
        self.cwd = self.root / 'workspace'
        self.cwd.mkdir()
        self.env = {
            'PATH': os.environ['PATH'], 'HOME': str(self.root / 'home'),
            'LANG': 'C.UTF-8', 'TERM': 'xterm-256color',
            'XDG_CONFIG_HOME': str(self.root / 'config'),
            'XDG_DATA_HOME': str(self.root / 'data'),
            'XDG_CACHE_HOME': str(self.root / 'cache'),
            'PI_CODING_AGENT_DIR': str(self.agent),
            'PI_CODING_AGENT_SESSION_DIR': str(self.root / 'sessions'),
            'PI_OFFLINE': '1', 'PI_SKIP_VERSION_CHECK': '1', 'PI_TELEMETRY': '0',
        }
        (self.agent / 'settings.json').write_text(json.dumps({
            'defaultProvider': 'openai', 'defaultModel': 'gpt-4o', 'theme': 'dark',
            'enableInstallTelemetry': False, 'defaultProjectTrust': 'never',
        }))
        self.socket = str(self.root / "socket ' with spaces")
        self.clients = []
        self.readers = []
        self.fds = []
        self.stop = threading.Event()

    def tearDown(self):
        self.tmux('kill-server', check=False)
        for client in self.clients:
            try:
                client.wait(timeout=3)
            except subprocess.TimeoutExpired:
                client.kill()
                client.wait()
        self.stop.set()
        for reader in self.readers:
            reader.join(timeout=2)
        for fd in self.fds:
            os.close(fd)
        self.temporary.cleanup()

    def command(self, *args, check=True):
        return subprocess.run(args, cwd=self.cwd, env=self.env, text=True,
                              capture_output=True, check=check, timeout=30)

    def tmux(self, *args, check=True):
        return self.command('tmux', '-S', self.socket, '-f', os.devnull, *args,
                            check=check).stdout.rstrip('\n')

    def install(self, source=str(REPO)):
        self.command('pi', 'install', source)
        settings = json.loads((self.agent / 'settings.json').read_text())
        if source.startswith('git:'):
            self.assertEqual(settings['packages'], [source])
        else:
            self.assertEqual(len(settings['packages']), 1)
            self.assertEqual((self.agent / settings['packages'][0]).resolve(), Path(source).resolve())
        self.assertIn(REPO.name, self.command('pi', 'list').stdout)

    def attach(self):
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
        client = subprocess.Popen(['tmux', '-S', self.socket, 'attach-session', '-t', 'pi'],
                                  stdin=slave, stdout=slave, stderr=slave, env=self.env)
        os.close(slave)
        self.clients.append(client)
        self.fds.append(master)

        def drain():
            while not self.stop.is_set():
                try:
                    if select.select([master], [], [], 0.1)[0] and not os.read(master, 65536):
                        break
                except OSError:
                    break

        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        self.readers.append(reader)
        eventually(lambda: self.tmux('list-clients', '-F', '#{client_pid}') == str(client.pid),
                   'client did not attach')
        # Our fake outer terminal must report that this tmux client has focus.
        os.write(master, b'\x1b[I')
        return master

    def test_local_install_discovery_noninteractive_and_remove(self):
        self.install()
        result = self.command('pi', '--offline', '--no-context-files', '--no-approve', '--help')
        self.assertNotIn('\x1b', result.stdout + result.stderr)
        self.assertNotIn('Failed to load extension', result.stdout + result.stderr)
        # RPC initializes a real session, but must never emit terminal escapes.
        rpc = subprocess.Popen(['pi', '--offline', '--mode', 'rpc', '--no-session',
                                '--no-context-files', '--no-approve'], cwd=self.cwd, env=self.env,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True)
        stdout, stderr = rpc.communicate('{"id":"test","type":"get_state"}\n', timeout=20)
        self.assertEqual(rpc.returncode, 0, stderr)
        self.assertNotIn('\x1b', stdout + stderr)
        self.assertIn('get_state', stdout)
        self.command('pi', 'remove', str(REPO))
        self.assertEqual(json.loads((self.agent / 'settings.json').read_text())['packages'], [])

    def test_github_install_via_local_git_mirror_without_network(self):
        if not shutil.which('git'):
            self.skipTest('Git required')
        if subprocess.run(['git', '-C', str(REPO), 'rev-parse', '--verify', 'HEAD'],
                          capture_output=True).returncode:
            self.skipTest('Commit the repository before testing Git installation')
        # Exercise Pi's real GitHub-source parsing and clone flow, but route the
        # clone to this committed local repository using isolated Git settings.
        git_config = self.root / 'gitconfig'
        self.env['GIT_CONFIG_GLOBAL'] = str(git_config)
        self.env['GIT_CONFIG_NOSYSTEM'] = '1'
        self.env['GIT_TERMINAL_PROMPT'] = '0'
        source = 'git:github.com/micha/pi-focus-cursor'
        self.command('git', 'config', '--file', str(git_config),
                     'url.' + REPO.as_uri() + '.insteadOf',
                     'https://github.com/micha/pi-focus-cursor')
        self.install(source)
        result = self.command('pi', '--offline', '--no-context-files', '--no-approve', '--help')
        self.assertNotIn('Failed to load extension', result.stdout + result.stderr)
        self.command('pi', 'remove', source)
        self.assertEqual(json.loads((self.agent / 'settings.json').read_text())['packages'], [])

    def test_focus_and_reload_regular(self):
        self.focus_and_reload('regular')

    def test_focus_and_reload_fullscreen(self):
        self.focus_and_reload('fullscreen')

    def focus_and_reload(self, mode):
        self.install()
        self.tmux('new-session', '-d', '-s', 'bootstrap', 'sleep 180')
        self.tmux('set-option', '-s', 'focus-events', 'on')
        command = shlex.join(['pi', '--offline', '--no-session', '--no-context-files',
                             '--no-approve', '--no-tools', '--no-skills', '--no-prompt-templates',
                             '--tui-mode', mode])
        pane = self.tmux('new-session', '-d', '-s', 'pi', '-x', '120', '-y', '40',
                         '-P', '-F', '#{pane_id}', command)
        capture = lambda: self.tmux('capture-pane', '-pe', '-t', pane)
        master = self.attach()
        # Pi mounts a default editor before session_start and replaces it later.
        # Wait for resource initialization, not just the early footer render.
        eventually(lambda: '[Extensions]' in capture(), lambda: 'Pi did not initialize: ' + capture())
        self.assertIn('focus-cursor.ts', capture())
        os.write(master, b'\x1b[I')
        self.tmux('send-keys', '-t', pane, '-l', 'CURSORTEST')
        self.tmux('send-keys', '-t', pane, 'Home')
        eventually(lambda: prompt_cursor_visible(capture()) is True, 'focused cursor missing: ' + capture())
        other = self.tmux('split-window', '-h', '-t', pane, '-P', '-F', '#{pane_id}', 'sleep 180')
        eventually(lambda: prompt_cursor_visible(capture()) is False, lambda: 'blurred cursor remained: ' + capture())
        self.tmux('select-pane', '-t', pane)
        eventually(lambda: prompt_cursor_visible(capture()) is True, lambda: 'cursor did not return: ' + capture())
        # A slash command, not a prompt: reinitialize resources without a model call.
        self.tmux('send-keys', '-t', pane, 'C-c')
        self.tmux('send-keys', '-t', pane, '-l', '/reload')
        self.tmux('send-keys', '-t', pane, 'Enter')
        eventually(lambda: 'Reloaded' in capture() or 'reloaded' in capture(), lambda: 'reload did not complete: ' + capture())
        self.tmux('send-keys', '-t', pane, '-l', 'CURSORTEST')
        self.tmux('send-keys', '-t', pane, 'Home')
        eventually(lambda: prompt_cursor_visible(capture()) is True, 'cursor missing after reload')
        self.tmux('select-pane', '-t', other)
        eventually(lambda: prompt_cursor_visible(capture()) is False, 'blur failed after reload')
        self.tmux('select-pane', '-t', pane)
        eventually(lambda: prompt_cursor_visible(capture()) is True, 'focus failed after reload')


if __name__ == '__main__':
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Linux PTY smoke test. Does not claim Windows console coverage."""
import errno, fcntl, json, os, pty, select, signal, struct, subprocess, termios, time
from pathlib import Path
root = Path(__file__).resolve().parent.parent
node = os.environ.get('TUI_TEST_NODE', '/opt/codex/cua_node/bin/node')
if not Path(node).is_file():
    import shutil
    node = shutil.which('node')
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
before = termios.tcgetattr(slave)
proc = subprocess.Popen([node, str(root/'scripts/tui.js')], stdin=slave, stdout=slave, stderr=slave, cwd=root, close_fds=True, env={**os.environ, 'CONTROL_PANEL_ENABLE_LIVE':'1', 'CONTROL_PANEL_ISOLATED_ENV':'1'})
output = bytearray()
def collect(seconds):
    end = time.monotonic()+seconds
    while time.monotonic() < end:
        ready,_,_ = select.select([master],[],[],0.05)
        if ready:
            try:
                data=os.read(master,65536)
                if not data: break
                output.extend(data)
            except OSError as exc:
                if exc.errno==errno.EIO: break
                raise
try:
    collect(0.5)
    assert b'\x1b[?1049h' in output and b'\x1b[?25l' in output
    assert b'DEMO / SYNTHETIC EVENTS' in output
    # Real key input and interrupted scenario switches.
    for key in [b'2', b'3', b'1', b'r', b'l', b'l', b'v', b'v', b'\x1b[A', b'\x1b[B']:
        os.write(master,key);collect(0.25)
    fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',20,60,0,0));os.kill(proc.pid,signal.SIGWINCH);collect(0.3)
    assert b'enlarge to 80x32+' in output
    fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,120,0,0));os.kill(proc.pid,signal.SIGWINCH);collect(0.3)
    os.write(master,b'rq');collect(2.2);proc.wait(timeout=3)
    assert proc.returncode==0
    assert b'\x1b[?25h\x1b[?1049l' in output
    after=termios.tcgetattr(slave)
    assert (after[3] & (termios.ICANON|termios.ECHO)) == (before[3] & (termios.ICANON|termios.ECHO)), 'Terminal modes not restored'
    report={'platform':'Linux PTY','passed':True,'checks':['alternate screen','cursor hide/show','demo-only label','1/2/3/r/l/v keyboard input','scroll keys','resize 60x20 and 120x40','coalesced rq input exits 0','ICANON/ECHO restoration'],'realInference':False}
    (root/'docs/tui-pty-result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
finally:
    if proc.poll() is None: proc.terminate();proc.wait(timeout=3)
    os.close(master);os.close(slave)

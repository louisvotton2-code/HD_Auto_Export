"""Exercise the timer's collector with isolated gateway and importer commands."""

from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parent/'production/collect-page-documents.py'
COLLECTOR = runpy.run_path(str(SCRIPT))


def latest_hour():
    now = datetime.now(COLLECTOR['BEIJING'])
    return (now-timedelta(seconds=60)).replace(minute=0, second=0, microsecond=0)-timedelta(hours=1)


def line(value):
    return json.dumps(value, separators=(',', ':')).encode()+b'\n'


def heartbeat(time):
    return line({'kind': 'page_document_coverage_v1', 'time': time})


def document(time):
    return line({'kind': 'page_document_v1', 'time': time, 'locale': 'ru', 'pageType': 'catalog', 'cache': 'cold'})


class Coverage(unittest.TestCase):
    def test_complete_zero_requires_continuous_beats_bracketing_the_hour(self):
        hour = latest_hour()
        start = int(hour.timestamp())
        beats = b''.join(heartbeat(now) for now in range(start-15, start+3630, 15) if now != start+900)
        self.assertEqual(COLLECTOR['snapshot'](beats, hour),
                         {'version': 1, 'hour': hour.isoformat(), 'status': 'complete', 'rows': []})
        gap = b''.join(heartbeat(now) for now in range(start-15, start+3630, 15) if not start+900 <= now <= start+945)
        self.assertEqual(COLLECTOR['snapshot'](gap, hour)['status'], 'partial')
        self.assertEqual(COLLECTOR['snapshot'](heartbeat(start+60)+document(start+1), hour)['status'], 'partial')
        self.assertEqual(COLLECTOR['snapshot'](document(start+1), hour)['status'], 'partial')
        self.assertIsNone(COLLECTOR['snapshot'](heartbeat(start-15)+heartbeat(start+3615), hour))
        self.assertIsNone(COLLECTOR['snapshot'](b'ordinary gateway output\n', hour))


class TimerCollector(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='hd-doc-hours-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.state = self.root/'state'
        self.state.mkdir(mode=0o700)
        self.config = self.root/'config.json'
        self.env = {**os.environ, 'PATH': str(self.root)+os.pathsep+os.environ['PATH'],
                    'HD_COLLECTOR_TEST_ROOT': str(self.root)}
        fixture = self.root/'docker'
        fixture.write_text(f'#!{sys.executable}\n'+'''import os, pathlib, sys
root = pathlib.Path(os.environ['HD_COLLECTOR_TEST_ROOT'])
assert len(sys.argv) == 7 and sys.argv[1:3] == ['logs', '--since']
assert sys.argv[4] == '--until' and sys.argv[-1] == 'fixture-gateway'
with (root/'reads').open('a') as out: out.write('1\\n')
if (root/'bad-read').exists():
    sys.stdout.buffer.write((root/'gateway.log').read_bytes())
    sys.exit(7)
sys.stdout.buffer.write((root/'gateway.log').read_bytes())
''')
        # The collector starts the same reviewed command array as in production.
        # This fixture simulates a committed import whose acknowledgement was lost.
        fixture.chmod(0o700)
        importer = self.root/'importer.py'
        importer.write_text('''import json, os, pathlib, sys
root = pathlib.Path(os.environ['HD_COLLECTOR_TEST_ROOT'])
pending = pathlib.Path(sys.argv[1])
assert pending.stat().st_mode & 0o077 == 0
data = pending.read_bytes()
result = root/'imported'
attempts = root/'attempts'
with attempts.open('a') as out: out.write('1\\n')
if (root/'conflict').exists():
    print('private test input', file=sys.stderr)
    sys.exit(12)
if not result.exists():
    result.write_bytes(data)
    sys.exit(4)
assert result.read_bytes() == data
snapshot = json.loads(data)
print(json.dumps({'outcome':'duplicate','hour':snapshot['hour'],'status':snapshot['status'],'rows':len(snapshot['rows'])}))
''')
        self.write_config({'enabled': True, 'gatewayContainer': 'fixture-gateway',
                           'stateDirectory': str(self.state), 'importCommand': [sys.executable, str(importer)]})

    def write_config(self, value):
        self.config.write_text(json.dumps(value))
        self.config.chmod(0o600)

    def run_collector(self):
        return subprocess.run([sys.executable, str(SCRIPT), '--config', str(self.config)], env=self.env,
                              capture_output=True, text=True, timeout=5)

    def test_gateway_and_import_failures_leave_cursor_and_resend_exact_bytes(self):
        hour = latest_hour()
        start = int(hour.timestamp())
        (self.root/'gateway.log').write_bytes(document(start+10))
        (self.root/'bad-read').touch()
        pending = self.state/'pending.json'
        checkpoint = self.state/'next-hour.json'
        bad_read = self.run_collector()
        self.assertEqual(bad_read.returncode, 1, bad_read.stderr)
        self.assertIn('gateway hour', bad_read.stderr)
        self.assertFalse(pending.exists())
        self.assertEqual(json.loads(checkpoint.read_text()), {'hour': hour.isoformat()})
        (self.root/'bad-read').unlink()

        failed_ack = self.run_collector()
        self.assertEqual(failed_ack.returncode, 1, failed_ack.stderr)
        self.assertEqual(pending.read_bytes(), (self.root/'imported').read_bytes())
        self.assertEqual(json.loads(checkpoint.read_text()), {'hour': hour.isoformat()})
        (self.root/'bad-read').touch()  # The retry must work even after log rotation or loss.

        replay = self.run_collector()
        self.assertEqual(replay.returncode, 0, replay.stderr)
        self.assertEqual(json.loads(replay.stdout)['hours'], [{'hour': hour.isoformat(), 'outcome': 'duplicate'}])
        self.assertFalse(pending.exists())
        self.assertEqual(json.loads(checkpoint.read_text()), {'hour': (hour+timedelta(hours=1)).isoformat()})
        self.assertEqual((self.root/'attempts').read_text().count('\n'), 2)
        self.assertEqual((self.root/'reads').read_text().count('\n'), 2)

    def test_disabled_and_missing_dont_call_importer(self):
        config = json.loads(self.config.read_text())
        self.write_config({**config, 'enabled': False})
        disabled = self.run_collector()
        self.assertEqual(disabled.returncode, 0, disabled.stderr)
        self.assertEqual(json.loads(disabled.stdout), {'enabled': False})
        self.assertFalse((self.root/'reads').exists())

        self.write_config(config)
        hour = latest_hour()
        (self.root/'gateway.log').write_bytes(b'')
        missing = self.run_collector()
        self.assertEqual(missing.returncode, 0, missing.stderr)
        self.assertEqual(json.loads(missing.stdout)['hours'], [{'hour': hour.isoformat(), 'outcome': 'missing'}])
        self.assertFalse((self.root/'attempts').exists())
        self.assertFalse((self.state/'pending.json').exists())

    def test_conflict_reports_the_hour_and_preserves_the_pending_snapshot(self):
        hour = latest_hour()
        (self.root/'gateway.log').write_bytes(document(hour.timestamp()+10))
        (self.root/'conflict').touch()
        conflict = self.run_collector()
        self.assertEqual(conflict.returncode, 1, conflict.stderr)
        self.assertIn(f'Conflicting finalized snapshot for {hour.isoformat()}', conflict.stderr)
        self.assertNotIn('private test input', conflict.stderr)
        self.assertEqual(json.loads((self.state/'pending.json').read_text())['hour'], hour.isoformat())
        self.assertEqual(json.loads((self.state/'next-hour.json').read_text())['hour'], hour.isoformat())

    def test_visit_audit_contains_only_acknowledged_address_free_totals(self):
        hour = latest_hour()
        start = int(hour.timestamp())
        audit = self.root/'audit'
        audit.mkdir(mode=0o750)
        config = json.loads(self.config.read_text())
        self.write_config({**config, 'visitAuditDirectory': str(audit)})
        (self.root/'gateway.log').write_bytes(document(start+10))
        failed_ack = self.run_collector()
        self.assertEqual(failed_ack.returncode, 1)
        self.assertEqual(list(audit.iterdir()), [])
        accepted = self.run_collector()
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        receipt = audit/f'hour-{start}.json'
        self.assertEqual(receipt.stat().st_mode & 0o777, 0o640)
        self.assertEqual(json.loads(receipt.read_text()), {'hour': start, 'status': 'partial', 'requests': 1})

    def test_catchup_limits_each_run_and_keeps_the_next_hour(self):
        start = latest_hour()-timedelta(hours=5)
        checkpoint = self.state/'next-hour.json'
        checkpoint.write_text(json.dumps({'hour': start.isoformat()}))
        checkpoint.chmod(0o600)
        (self.root/'gateway.log').write_bytes(b'')
        result = self.run_collector()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)['hours']), 3)
        next_hour = start + timedelta(hours=3)
        self.assertEqual(json.loads(checkpoint.read_text()), {'hour': next_hour.isoformat()})


if __name__ == '__main__':
    unittest.main()

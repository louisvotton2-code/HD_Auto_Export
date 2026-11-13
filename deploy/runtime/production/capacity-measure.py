"""Single measured peak model. Slow probes run outside the minute decision service."""
import datetime as dt
import fcntl
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import time
import uuid

ROOT = Path('/srv/hd-auto')
STATE = ROOT/'data/full-sync-capacity'
CONFIG = Path('/etc/hd-auto/capacity.json')
MODEL = 'hd-ext07-peak-v1'


def private_json(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 65536:
        raise ValueError('Invalid private measurement file')
    return json.loads(path.read_text())


def config():
    c = private_json(CONFIG)
    if not re.fullmatch(r'hd_release_[a-f0-9]{16}', c['database']):
        raise ValueError('Invalid database')
    if subprocess.check_output(['findmnt','--mountpoint',str(ROOT/'data'),'-no','UUID'],text=True).strip() != c['filesystemUuid']:
        raise ValueError('Unexpected filesystem')
    return c


def sql(c, query):
    return json.loads(subprocess.check_output(['docker','exec','-u','postgres','hd-auto-postgres-1','psql','-X','-U','postgres','-d',c['database'],'-Atq','-v','ON_ERROR_STOP=1','-c',query],text=True,timeout=30))


def evidence(c):
    return sql(c,'SELECT capacity_estimate FROM external_full_sync WHERE id=1')


def allocated(path):
    path=Path(path)
    if not path.is_absolute() or '..' in path.parts or path.is_symlink() or not path.exists() or ROOT not in path.parents:
        raise ValueError('Invalid measurement root')
    return int(subprocess.check_output(['du','-s','-B1','--',str(path)],text=True,timeout=30).split()[0])


def stream_size(argv, timeout=600, maximum=2*1024**3):
    """Drain compressed output without retaining business contents in memory/files."""
    p=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
    count=0; deadline=time.monotonic()+timeout
    selector=selectors.DefaultSelector(); selector.register(p.stdout,selectors.EVENT_READ)
    try:
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0: raise TimeoutError('Probe deadline')
            if not selector.select(min(remaining,1)): continue
            chunk=os.read(p.stdout.fileno(),65536)
            if not chunk: break
            count+=len(chunk)
            if count>maximum: raise ValueError('Probe byte limit')
        if p.wait(timeout=max(1,deadline-time.monotonic())): raise ValueError('Probe failed')
        return count
    finally:
        selector.close(); p.stdout.close()
        if p.poll() is None:
            os.killpg(p.pid,signal.SIGTERM)
            try: p.wait(timeout=5)
            except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL); p.wait()


def project(e, probe, *, used, total, media, controls, daily, raw):
    n=e['distinctProcessed']; target=e['targetRows']
    if not e.get('sampleEvidenceSufficient') or n<=0 or target<n: raise ValueError('Insufficient sample')
    for value in (used,total,media,controls,daily,raw,n,target,e['businessBytes'],e['sqlStagingBytes'],e['archiveDirectoryBytes'],e['walBytes']):
        if type(value) is not int or value<0: raise ValueError('Invalid byte measurement')
    business=max(e['businessBytes'],math.ceil(e['projectedBytesPerDetail']*target))
    history=math.ceil(raw*target/n)
    stage=e['sqlStagingBytes']; csv=e['archiveDirectoryBytes']; wal=max(e['walBytes'],2*1024**3)
    # Archive directory is conservatively all fixed CSV, never scaled by details.
    full_dump=math.ceil((probe['businessDumpBytes']+probe['rawDumpBytes'])*target/probe['processedRows'])
    point=full_dump+3*stage+3*csv+media+controls
    protected=max(0,used-e['businessBytes']-stage-csv-media-e['walBytes']-daily)
    recovery=math.ceil(point*73/10)
    components=dict(protectedBytes=protected,businessBytes=business,historyBytes=history,
                    sqlSnapshotsBytes=3*stage,csvSnapshotsBytes=3*csv,mediaBytes=media,
                    controlsBytes=controls,walBytes=wal,recoveryPeakBytes=recovery,
                    recoveryPointBytes=point)
    peak=max(used,sum(v for k,v in components.items() if k!='recoveryPointBytes'))
    return dict(projectedPeakBytes=peak,diskTotalBytes=total,currentUsedBytes=used,components=components)


def daily_bytes():
    root=ROOT/'backups/ext07'; total=0
    if root.exists():
        for p in root.glob('daily-*'):
            if p.is_dir() and not p.is_symlink() and (p/'routine.json').is_file():
                proof=private_json(p/'routine.json')
                if proof.get('complete') is True and proof.get('kind')=='daily' and proof.get('name')==p.name:
                    total+=allocated(p)
    return total


def measure():
    c=config(); e=evidence(c)
    if not e or not e.get('sampleEvidenceSufficient'): return None
    try: cached=private_json(STATE/'probe.json')
    except (OSError,ValueError): cached={}
    if cached.get('model')!=MODEL or cached.get('evidenceHash')!=e['evidenceHash'] or cached.get('snapshotId')!=e['snapshotId'] or time.time()-cached.get('measuredEpoch',0)>86400:
        subprocess.run(['systemctl','start','--no-block','hd-auto-ext07-capacity-probe.service'],check=True,timeout=5)
        return None
    fs=os.statvfs(ROOT/'data'); total=fs.f_blocks*fs.f_frsize; used=(fs.f_blocks-fs.f_bfree)*fs.f_frsize
    raw=sql(c,"SELECT coalesce(sum(pg_total_relation_size(c.oid)),0)::bigint FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('external_source_blobs','external_source_documents')")
    result=project(e,cached,used=used,total=total,media=sum(allocated(p) for p in c['mediaRoots']),controls=sum(allocated(p) for p in c['controlRoots']),daily=daily_bytes(),raw=raw)
    latest=evidence(c)
    if latest.get('evidenceHash')!=e['evidenceHash']: return None
    return {**e,**result}


def dump_command(c, image, name, extra):
    return ['docker','run','--rm','--name',name,'--network',c['dumpNetwork'],
            '--cpus','0.25','--memory','256m','--memory-swap','256m','--pids-limit','64',
            '--read-only','--user','0:0','--cap-drop=ALL','--security-opt=no-new-privileges',
            '--tmpfs','/tmp:rw,noexec,nosuid,size=16m',
            '--mount',f"type=bind,src={c['dumpPgpassFile']},dst=/run/pgpass,readonly",
            '--env','PGPASSFILE=/run/pgpass','--env','PGCONNECT_TIMEOUT=10',
            '--env','PGOPTIONS=-c statement_timeout=600000 -c lock_timeout=5000 -c default_transaction_read_only=on',
            '--entrypoint','pg_dump',image,'-h',c['dumpHost'],'-U',c['dumpUser'],
            '-d',c['database'],'-Fc','-Z','6','--no-owner','--no-acl','--lock-wait-timeout=5000',*extra]


def dump_target(c):
    # The existing password file is mounted read-only, never read into argv/logs.
    path=Path(c['dumpPgpassFile'])
    if not path.is_absolute() or '..' in path.parts or ROOT/'secrets' not in path.parents:
        raise ValueError('Probe credential must be in the private secrets directory')
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode & 0o077:
        raise ValueError('Probe credential must be root-owned 0600')
    if any(not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',c[key]) for key in ('dumpNetwork','dumpHost','dumpUser')):
        raise ValueError('Invalid internal dump target')
    network=json.loads(subprocess.check_output(['docker','network','inspect',c['dumpNetwork']],text=True,timeout=10))[0]
    pg=json.loads(subprocess.check_output(['docker','inspect','hd-auto-postgres-1'],text=True,timeout=10))[0]
    attachment=pg['NetworkSettings']['Networks'].get(c['dumpNetwork'])
    if network.get('Internal') is not True or not attachment or c['dumpHost'] not in attachment.get('Aliases',[]):
        raise ValueError('Probe must use the existing internal PostgreSQL network alias')
    if not pg['State']['Running'] or not re.fullmatch(r'sha256:[a-f0-9]{64}',pg['Image']):
        raise ValueError('Expected running pinned PostgreSQL image')
    # Client quotas do not cap database-server computation. Defer during host pressure.
    if os.getloadavg()[0] >= max(1,(os.cpu_count() or 1)*0.75):
        raise ValueError('Host pressure defers the read-only probe')
    return pg['Image']


def compressed_dump(c, image, extra):
    name='hd-auto-capacity-probe-'+uuid.uuid4().hex
    try:
        return stream_size(dump_command(c,image,name,extra))
    finally:
        # Cancel the actual dump container too, including client timeout/disconnect.
        subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)


def probe():
    os.umask(0o077)
    with (STATE/'probe.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        c=config(); e=evidence(c)
        if not e or not e.get('sampleEvidenceSufficient'): return
        image=dump_target(c)
        business=compressed_dump(c,image,['--exclude-table=public.external_full_stage'])
        raw=compressed_dump(c,image,['--table=public.external_source_blobs','--table=public.external_source_documents'])
        if evidence(c).get('evidenceHash')!=e['evidenceHash']: return
        data=dict(processedRows=e['distinctProcessed'],measuredEpoch=time.time(),model=MODEL,snapshotId=e['snapshotId'],evidenceHash=e['evidenceHash'],businessDumpBytes=business,rawDumpBytes=raw,measuredAt=dt.datetime.now(dt.timezone.utc).isoformat())
        temp=STATE/'probe.json.tmp'
        with temp.open('w') as f: json.dump(data,f); f.flush(); os.fsync(f.fileno())
        os.replace(temp,STATE/'probe.json')


if __name__=='__main__':
    import sys
    if sys.argv[1:]!=['--probe']: raise SystemExit('Use --probe')
    probe()

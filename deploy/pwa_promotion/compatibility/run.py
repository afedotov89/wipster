#!/usr/bin/env python3
"""Real PG18 rollback proof. Requires disposable local DB admin URL, never production."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit
import psycopg
from psycopg import sql
OLD='6e275c26c1f9bcd2722445641a3c7982a8c56ef6'
NEW='e16d2918d263440e32d328fbc1c67273c36831da'
p=argparse.ArgumentParser();p.add_argument('--old',type=Path,required=True);p.add_argument('--new',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
for path, expected in [(args.old,OLD),(args.new,NEW)]:
    assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=path,text=True).strip()==expected
url=os.environ['COMPAT_ADMIN_URL']; parsed=urlsplit(url)
assert parsed.hostname in ('127.0.0.1','localhost') and parsed.path in ('/compat','/postgres'), 'disposable loopback PG only'
root=Path(__file__).resolve().parent; helper=root.parent/'runtime_ops/pwa_migrate.py'
args.output.mkdir(parents=True,exist_ok=True)
admin=psycopg.connect(url,autocommit=True)
assert admin.info.server_version//10000==18
results=[]; databases=[]; children=[]
baseenv=dict(os.environ,DEBUG='true',DEV_OTP_ENABLED='true',OTP_PROVIDER='disabled',YANDEX_ENABLED='true',YANDEX_CLIENT_ID='1'*32,GOOGLE_ENABLED='false',PYTHONDONTWRITEBYTECODE='1',COMPAT_HELPER=str(helper))
def dburl(name): return urlunsplit(parsed._replace(path='/'+name))
def env(db,source,app='compat'):
    return dict(baseenv,DATABASE_URL=dburl(db),COMPAT_BACKEND=str(source.resolve()/'backend'),COMPAT_STATE=str(args.output/(db+'.state.json')),PGAPPNAME=app)
def launch(db,source,mode):
    log=(args.output/(db+'-'+mode+'.log')).open('w')
    e=env(db,source,mode)
    e.update(COMPAT_PAUSED=str(args.output/(db+'.paused')),COMPAT_RELEASE=str(args.output/(db+'.release')))
    proc=subprocess.Popen([sys.executable,str(root/'fixture.py'),mode],cwd=source/'backend',env=e,stdout=log,stderr=subprocess.STDOUT)
    children.append((proc,log));return proc
def wait(proc,expected=0,timeout=85):
    rc=proc.wait(timeout=timeout)
    assert (rc==0 if expected==0 else rc!=0), f'fixture exit={rc}, expected={expected}; see logs'
def fixture(db,source,mode,expected=0): wait(launch(db,source,mode),expected)
def migrate(db,source):
    r=subprocess.run([sys.executable,'manage.py','migrate','--noinput'],cwd=source/'backend',env=env(db,source),capture_output=True,text=True,timeout=60)
    (args.output/(db+'-migrate-'+source.name+'.log')).write_text(r.stdout+r.stderr);assert r.returncode==0

def fresh(label):
    db='wipster_compat_'+os.urandom(5).hex();databases.append(db)
    admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(db)))
    migrate(db,args.old);fixture(db,args.old,'seed');return db

def schema(db):
    with psycopg.connect(dburl(db),autocommit=True) as c:
        columns=c.execute("SELECT table_name,column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2").fetchall()
        migrations=c.execute('SELECT app,name FROM django_migrations ORDER BY 1,2').fetchall()
        return {'columns':columns,'migrations':migrations}
def retained(db):
    with psycopg.connect(dburl(db),autocommit=True) as c:
        # Exact preserved rows, excluding later legitimately created records.
        rows={t:c.execute(sql.SQL('SELECT * FROM {} ORDER BY 1').format(sql.Identifier(t))).fetchall() for t in ['accounts_account','accounts_externalidentity','sync_entity','sync_change','sync_receipt']}
        for t in ['accounts_devicesession','accounts_yandexattempt']:
            cols=c.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s AND column_name!='channel' ORDER BY ordinal_position",(t,)).fetchall()
            rows[t]=c.execute(sql.SQL('SELECT {} FROM {} ORDER BY 1').format(sql.SQL(',').join(sql.Identifier(x[0]) for x in cols),sql.Identifier(t))).fetchall()
        return rows

def defaults(db):
    state=schema(db); ds=[x for x in state['columns'] if x[1]=='channel']
    assert len(ds)==2 and all(x[2]=='NO' and "'native'" in x[3] for x in ds),ds

def passed(name,**details): results.append(dict(case=name,result='PASS',**details));print(name+' PASS',flush=True)
def until(fn,timeout=20):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if fn():return
        time.sleep(.05)
    raise TimeoutError('observable test condition not reached')
try:
    db=fresh('baseline'); before=retained(db)
    fixture(db,args.old,'old-semantics');passed('old0005 actual old auth, durable Yandex finish/retry and sync read/write')
    # Re-seed separate DB to keep exact latest rows before migration.
    db=fresh('unwrapped');before=retained(db)
    migrate(db,args.new);assert retained(db)==before
    assert all(x[3] is None for x in schema(db)['columns'] if x[1]=='channel')
    fixture(db,args.old,'old-inserts-fail');passed('unwrapped0006/7 both old INSERT fail exact SQLSTATE23502/channel')
    fixture(db,args.new,'helper');defaults(db);assert retained(db)==before
    fixture(db,args.old,'old-semantics');fixture(db,args.new,'new-channels');passed('already migrated schema compatible defaults; old and new channels')
    db=fresh('fresh');before=retained(db)
    fixture(db,args.new,'helper');defaults(db);assert retained(db)==before
    fixture(db,args.old,'old-semantics');fixture(db,args.new,'new-channels');passed('fresh0005 atomic migrate retains rows and old/new behavior')
    for migrated in [False,True]:
        db=fresh('failure')
        if migrated:migrate(db,args.new)
        before_schema=schema(db);before=retained(db)
        fixture(db,args.new,'helper-failure',1)
        assert schema(db)==before_schema and retained(db)==before
        fixture(db,args.old,'old-inserts-fail' if migrated else 'old-semantics')
        passed('induced failure rolls schema migration records defaults and data back',already_migrated=migrated)
    db=fresh('overlap');before=retained(db)
    migration=launch(db,args.new,'helper-overlap');until(lambda:(args.output/(db+'.paused')).exists())
    old=launch(db,args.old,'overlap-write')
    def blocked():
        return admin.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND application_name='overlap-write' AND query LIKE 'INSERT INTO%' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0",(db,)).fetchone()[0]>0
    until(blocked);assert old.poll() is None
    (args.output/(db+'.release')).write_text('commit allowed')
    wait(migration);wait(old);defaults(db)
    passed('old operation observed blocked by DDL then succeeds after atomic defaults commit')
    db=fresh('lock_timeout');before_schema=schema(db);before=retained(db)
    with psycopg.connect(dburl(db)) as blocker:
        blocker.execute('LOCK accounts_devicesession IN ACCESS SHARE MODE')
        started=time.monotonic();fixture(db,args.new,'helper',1);elapsed=time.monotonic()-started
    log=(args.output/(db+'-helper.log')).read_text();assert 'lock timeout' in log and 4<elapsed<20
    assert schema(db)==before_schema and retained(db)==before
    fixture(db,args.old,'old-semantics');passed('real lock timeout no partial schema/data',seconds=elapsed)
    db=fresh('statement_timeout');before_schema=schema(db);before=retained(db)
    started=time.monotonic();fixture(db,args.new,'helper-statement-timeout',1);elapsed=time.monotonic()-started
    assert 'statement timeout' in (args.output/(db+'-helper-statement-timeout.log')).read_text() and 59<elapsed<80
    assert schema(db)==before_schema and retained(db)==before
    fixture(db,args.old,'old-semantics');passed('real statement timeout rolls migrations and defaults back',seconds=elapsed)
finally:
    for proc,log in children:
        if proc.poll() is None:
            proc.terminate()
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=5)
        log.close()
    for db in databases:admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(db)))
    admin.close()
    receipt=dict(old_source=OLD,new_source=NEW,postgres_major=18,helper_sha256=hashlib.sha256(helper.read_bytes()).hexdigest(),cases=results,expected_cases=9,synthetic_only=True,no_live_access=True,cleanup_databases=len(databases))
    (args.output/'compatibility-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
assert len(results)==9,results

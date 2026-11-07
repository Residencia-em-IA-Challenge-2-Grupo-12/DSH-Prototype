"""Isolated DSH SDK executor probe. Run from project root; no model calls."""
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

root=Path.cwd()
plugin=Path(__file__).resolve().with_name('plugin.mjs')
with tempfile.TemporaryDirectory(prefix='dsh-worker-sdk-') as directory:
 run=Path(directory)
 report_path=run/'report.json'
 canary=run/'host-canary.txt'
 canary.write_text('fictional canary',encoding='utf-8')
 patch=run/'patch.yml'
 patch.write_text('''- id: tool-fs
  disabled: true
- id: tool-working-directory
  disabled: true
- id: persistent-bash
  disabled: true
- id: persistent-pwsh
  disabled: true
- insert:
    - id: synthetic-worker-spike
      name: ''' + json.dumps(str(plugin),ensure_ascii=False) + '''
      inject: [tools]
''',encoding='utf-8')
 # Deliberately do not forward host credentials or provider environment.
 env={'PATH':os.environ.get('PATH','/usr/bin:/bin'), 'DSH_HOME':str(run/'home'),
      'STUDY_WORKER_PROBE_REPORT':str(report_path), 'STUDY_WORKER_HOST_CANARY':str(canary)}
 if os.environ.get('SYNTHETIC_WORKER_TEST_IMAGE'):
  env['SYNTHETIC_WORKER_TEST_IMAGE']=os.environ['SYNTHETIC_WORKER_TEST_IMAGE']
 process=subprocess.Popen([str(root/'node_modules/.bin/dsh'),'sdk-minimal','--patch',str(patch)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,text=True)
 try:
  for _ in range(150):
   if report_path.exists() or process.poll() is not None:break
   time.sleep(.1)
  if process.poll() is None:
   process.stdin.write(json.dumps({'jsonrpc':'2.0','id':1,'method':'shutdown'})+'\n');process.stdin.flush()
  try: stdout,stderr=process.communicate(timeout=5)
  except subprocess.TimeoutExpired:process.kill();stdout,stderr=process.communicate()
  if not report_path.exists():raise RuntimeError('SDK report missing; inspect isolated DSH startup separately')
  report=json.loads(report_path.read_text())
  if report.get('catalog')!=['synthetic_bash']:raise RuntimeError(f"Unexpected global tool catalog: {report.get('catalog')}")
  if report.get('error'):raise RuntimeError('Tool executor probe failed: '+report['error']['message'])
  results={item['callId']:item['result'] for item in report['batch']['results']}
  for index in range(9):
   if results[f'denied-{index}'].get('error',{}).get('info',{}).get('code')!='UNKNOWN_TOOL':
    raise RuntimeError(f'Disabled host tool {index} was unexpectedly reachable')
  worker=results['worker']
  if 'SYNTHETIC_WORKER_TEST_IMAGE' in env:
   if worker.get('isError') is True:raise RuntimeError('Worker execution failed: '+worker.get('error',{}).get('message','unknown'))
   if 'fictional syllabus' not in json.dumps(worker):raise RuntimeError('Expected fictional result missing')
  elif worker.get('isError') is not True:raise RuntimeError('Unconfigured worker unexpectedly ran')
  if process.returncode!=0:raise RuntimeError(f'SDK did not exit cleanly: {process.returncode}')
  print('global_catalog=synthetic_bash host_tool_probes=UNKNOWN_TOOL worker='+('ok' if 'SYNTHETIC_WORKER_TEST_IMAGE' in env else 'fail-closed-no-image'))
 finally:
  if process.poll() is None:process.kill();process.wait()

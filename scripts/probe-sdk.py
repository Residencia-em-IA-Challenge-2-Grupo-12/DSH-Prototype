import os,json,subprocess,time,threading,queue,uuid
root=os.getcwd();env=os.environ.copy();env['DSH_HOME']=root+'/.runtime/dsh';env['DSH_PERMISSION_MODE']='read-only'
p=subprocess.Popen([root+'/node_modules/.bin/node',root+'/node_modules/@deepseek-ai/dsh/lib/bin.js','--profile','sdk','--patch',root+'/dsh-study.patch.yml'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,bufsize=1,env=env)
q=queue.Queue()
def reader():
 for line in p.stdout:
  try:q.put(json.loads(line))
  except json.JSONDecodeError:pass
threading.Thread(target=reader,daemon=True).start()
def send(obj):p.stdin.write(json.dumps(obj)+'\n');p.stdin.flush()
def rpc(id,method,params=None):
 obj={'jsonrpc':'2.0','id':id,'method':method}
 if params is not None:obj['params']=params
 send(obj)
def wait_for(id,seconds=20):
 deadline=time.time()+seconds
 while time.time()<deadline:
  try:msg=q.get(timeout=max(0,deadline-time.time()))
  except queue.Empty:break
  if msg.get('id')==id and ('result' in msg or 'error' in msg):return msg
 return None
try:
 rpc(1,'initialize',{'cwd':root+'/.runtime/workspaces/ana','provider':'codex','model':'gpt-6-luna','capabilities':{'userQuestions':True},'approvalRequests':True})
 init=wait_for(1)
 if not init or 'error'in init:raise RuntimeError('initialize failed')
 sid='synthetic-sdk-'+uuid.uuid4().hex
 prompt=('This is a synthetic integration test. Simulated today is 2026-11-02. First call the native ask_user_question tool, asking exactly how many study hours per week with options 3 hours and 5 hours; wait for the answer. Then use mcp__study__list_synthetic_files and mcp__study__list_calendar for ana, and briefly report what you found and the answer. Do not request approval and do not change the calendar.')
 rpc(2,'session/query',{'sessionId':sid,'contentBlocks':[{'type':'text','text':prompt}]})
 asked=False; sent_wait=False; finished=False; methods=set(); study_tools=set(); event_count=0; deadline=time.time()+90
 while time.time()<deadline:
  try:msg=q.get(timeout=max(0,deadline-time.time()))
  except queue.Empty:break
  method=msg.get('method');params=msg.get('params') or {}
  if method:methods.add(method)
  if method=='user-question/ask' and 'id'in msg:
   questions=params.get('questions',[]);answers=[]
   for item in questions:
    options=item.get('options') or [];labels=[x.get('label','') for x in options if isinstance(x,dict)];choice=next((x for x in labels if '3' in x),None)
    answers.append({'id':item['id'],'selected':[choice]} if choice else {'id':item['id'],'selected':[],'custom':'3 hours'})
   send({'jsonrpc':'2.0','id':msg['id'],'result':{'answers':answers}});asked=True
  elif method=='approval/request' and 'id'in msg:send({'jsonrpc':'2.0','id':msg['id'],'result':{'outcome':'rejected'}})
  elif method=='session.event':
   event_count+=1
   event=json.dumps(params)
   for tool in ('list_synthetic_files','list_calendar'):
    if 'mcp__study__'+tool in event:study_tools.add(tool)
  if msg.get('id')==2:
   if 'error'in msg:print('QUERY_ERROR',msg['error'].get('code'));break
   rpc(3,'session/wait',{'sessionId':sid});sent_wait=True
  if msg.get('id')==3:
   print('WAIT', 'error' if 'error'in msg else 'completed');finished='error' not in msg;break
 print('QUESTION_FORWARDED',asked,'EVENT_COUNT',event_count,'WAIT_SENT',sent_wait,'NOTIFICATIONS',','.join(sorted(methods)),'STUDY_TOOLS',','.join(sorted(study_tools)))
 rpc(4,'shutdown');wait_for(4,10)
 if not (asked and finished):raise SystemExit('Synthetic SDK question probe did not complete')
finally:
 if p.poll() is None:p.terminate()
 try:p.wait(timeout=5)
 except subprocess.TimeoutExpired:p.kill();p.wait()

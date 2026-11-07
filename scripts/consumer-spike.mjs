// Local, synthetic terminal demonstration. Never attach an agent to this host.
import { readFile,mkdtemp,writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDomainService } from '../src/domain-service.mjs';
import { startCalendarExperiment } from '../src/foundation/calendar-experiment.mjs';
import { DomainObservationClient } from '../src/foundation/domain-http-observer-client.mjs';
import { createSyntheticConsumer } from '../src/foundation/sdk-app-consumer.mjs';

async function syntheticToken(run,redirectUri) {
  const credentials=run.syntheticCredentials(),state=randomBytes(16).toString('hex');
  const authorization=new URL('/oauth/authorize',run.origin);
  authorization.search=new URLSearchParams({client_id:credentials.id,redirect_uri:redirectUri,response_type:'code',scope:'https://www.googleapis.com/auth/calendar',state});
  const page=await fetch(authorization,{signal:AbortSignal.timeout(5000)});
  if(!page.ok)throw new Error('Synthetic authorization failed');
  const nonce=(await page.text()).match(/name="consent" value="([^"]+)"/)?.[1];
  if(!nonce)throw new Error('Synthetic consent missing');
  const accepted=await fetch(`${run.origin}/oauth/authorize`,{method:'POST',redirect:'manual',headers:{origin:run.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({consent:nonce,user_id:'ana',decision:'approve'}),signal:AbortSignal.timeout(5000)});
  if(accepted.status!==302)throw new Error('Synthetic consent failed');
  const callback=new URL(accepted.headers.get('location'));
  if(callback.origin+callback.pathname!==redirectUri||callback.searchParams.get('state')!==state)throw new Error('Invalid synthetic OAuth callback');
  const code=callback.searchParams.get('code');if(!code)throw new Error('Synthetic authorization code missing');
  const exchange=await fetch(`${run.origin}/oauth/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:credentials.id,client_secret:credentials.secret}),signal:AbortSignal.timeout(5000)});
  if(!exchange.ok)throw new Error('Synthetic token exchange failed');
  const token=(await exchange.json()).access_token;if(!token)throw new Error('Synthetic token missing');return token;
}

if(!stdin.isTTY||!stdout.isTTY)throw new Error('Run the synthetic demo interactively in a local terminal');
const fixture=JSON.parse(await readFile(new URL('../fixtures/calendars/ana.json',import.meta.url),'utf8'));
const profile=JSON.parse(await readFile(new URL('../fixtures/students/ana/courses.json',import.meta.url),'utf8'));
process.umask(0o077);
const artifactDir=await mkdtemp(path.join(tmpdir(),'study-consumer-spike-'));
const domainService=createDomainService({filename:path.join(artifactDir,'domain.sqlite')});let experiment,terminal,domain,approvalAttempted=false,applicationSettled=false;
try {
  const address=await domainService.listen();
  domain=new DomainObservationClient(`http://127.0.0.1:${address.port}`);
  const redirectUri='http://127.0.0.1:4175/callback';
  experiment=await startCalendarExperiment({fixture,redirectUri,context:{scenarioId:'ana',simulatedClock:'2026-11-02T00:00:00-03:00',timeZone:'America/Sao_Paulo',generatorVersion:'fixture-v1',seed:'0'}});
  const accessToken=await syntheticToken(experiment,redirectUri);
  const provider=experiment.provider(accessToken);
  const {agent,human}=await createSyntheticConsumer({domain,provider,student:'ana',profile,origin:experiment.origin,accessToken});
  const context=await agent.readContext();
  stdout.write('\nSynthetic student, fixed simulated week of 2 November 2026\n');
  for(const course of context.profile.courses)stdout.write(`Course: ${course.name}; deadline: ${course.deadline}; source: ${course.source}\n`);
  const observation=await agent.readCalendar();
  stdout.write(`\nExisting calendar events in the week (${observation.payload.timeZone}):\n`);
  for(const event of observation.payload.events)stdout.write(`- ${event.start?.dateTime||event.start?.date}  ${event.summary||'(untitled)'}\n`);
  const proposal=await agent.draftOneBlock(),event=proposal.payload.sections.near.action.event;
  stdout.write(`\nProposed one-hour block (nothing has been written):\n${JSON.stringify(event,null,2)}\n`);
  stdout.write(`Sources: ${proposal.payload.sources.join(', ')}\n${proposal.payload.assumptions.join(' ')}\n`);
  terminal=createInterface({input:stdin,output:stdout});
  const decision=(await terminal.question('\nType APPROVE to add this one synthetic event; any other answer rejects it: ')).trim();
  if(decision!=='APPROVE') {
    await human.reject(proposal.id);stdout.write('Rejected. No event was created.\n');
  } else {
    approvalAttempted=true;
    const result=await human.approveAndApply(proposal.id,decision);
    applicationSettled=['completed','failed'].includes(result.state);
    stdout.write(`Application state: ${result.state}\n`);
    if(result.result?.requiresReview)stdout.write('The resulting calendar needs review.\n');
    if(result.state!=='completed')stdout.write('Do not retry; inspect the application record and reconcile.\n');
  }
  const checkpoint=await experiment.checkpoint();
  const checkpointName=approvalAttempted&&!applicationSettled?'checkpoint-provisional.json':'checkpoint.json';
  await writeFile(path.join(artifactDir,checkpointName),JSON.stringify(checkpoint,null,2),{mode:0o600});
  stdout.write(`Synthetic records: ${artifactDir}\n`);
} finally {
  terminal?.close();
  let blocking=!!experiment;
  if(experiment&&domain&&(!approvalAttempted||applicationSettled))try {blocking=(await domain.applications('ana')).some(item=>['pending','unknown','review'].includes(item.state));}catch{/* Keep the simulator when the outcome cannot be inspected. */}
  if(experiment&&blocking)stdout.write(`Simulator retained for manual investigation: run ${experiment.runId}, local address ${experiment.origin}; records ${artifactDir}. No reconciliation workflow is implemented.\n`);
  const cleanup=await Promise.allSettled([!blocking?experiment?.close():undefined,domainService.close()]);
  const failure=cleanup.find(item=>item.status==='rejected');
  if(failure)throw new Error('Cleanup failed; inspect the synthetic run and its records',{cause:failure.reason});
}

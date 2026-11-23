import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { ROOT } from '../src/core.mjs';
import { packBundle, readBundle } from '../src/paired-replay/bundle.mjs';
import { createDshBrunoAdapter } from '../src/paired-replay/dsh-runner.mjs';
import { createHttpRunnerAdapter } from '../src/paired-replay/http-adapter.mjs';
import { runPortableReplay, scenarios } from '../src/paired-replay/runner.mjs';

const exec = promisify(execFile);

function createInMemoryHarness() {
  let events = [];
  return {
    async startExperiment({ fixture, runId }) {
      events = structuredClone(fixture.events);
      return {
        runId,
        origin: 'http://127.0.0.1:0',
        async authorize() { return 'in-memory-token'; },
        provider() { return {}; },
        async close() {},
      };
    },
    createCalendar({ scenario, faults }) {
      return {
        async events() {
          if (scenario === 'unknown-unavailable' && faults.lostResponse) throw new Error('Injected observation loss');
          return structuredClone(events);
        },
        async create(_student, event) {
          faults.providerAttempts++;
          const stored = structuredClone(event);
          events.push(stored);
          if (scenario.startsWith('unknown') && !faults.lostResponse) {
            faults.lostResponse = true;
            throw new Error('Injected loss after calendar accepted a write');
          }
          return stored;
        },
        async remove(_student, id) {
          faults.providerAttempts++;
          events = events.filter(item => item.id !== id);
        },
      };
    },
    async observe() {
      return structuredClone(events);
    },
    async editExistingEvent(_experiment, _student, eventId) {
      const target = events.find(item => item.id === eventId);
      target.description = 'Fictional operator edit during the review.';
    },
    async verifyRetired() {},
  };
}

test('runPortableReplay executes all five safety scenarios offline with the DSH adapter', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'portable-runner-dsh-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const bundleDir = path.join(work, 'bruno');
  await packBundle('bruno', bundleDir);
  const bundle = await readBundle(bundleDir);

  for (const scenario of scenarios) {
    const harness = createInMemoryHarness();
    let saved = null;
    const { result, failures } = await runPortableReplay(bundle, scenario, {
      adapter: createDshBrunoAdapter(scenario),
      saveResult: async evidence => { saved = evidence; },
      ...harness,
    });
    assert.deepEqual(failures, [], `Unexpected failure in scenario ${scenario}`);
    assert.ok(saved, `Expected saved result for ${scenario}`);
    assert.equal(result.retirement, 'verified');
    assert.ok(result.checks.every(check => check.outcome === 'pass'), `Failed checks in ${scenario}: ${JSON.stringify(result.checks)}`);
  }
});

test('createHttpRunnerAdapter enforces loopback-only URLs', () => {
  assert.throws(() => createHttpRunnerAdapter({ url: 'https://example.com/replay' }), /loopback/i);
  assert.throws(() => createHttpRunnerAdapter({ url: 'http://10.0.0.5:8000' }), /loopback/i);
});

const PYTHON_RUNNER = `
import json, sys, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

COURSES = [
    {"name": "Algoritmos", "date": "2026-12-14", "time": "09:00", "citation": {
        "path": "notices/aviso-turma-n02.md",
        "quote": "A prova escrita de grafos de Algoritmos foi transferida de 07/12/2026 para 14/12/2026 às 09:00, horário de São Paulo."
    }},
    {"name": "Banco de Dados", "date": "2026-12-14", "time": "18:00", "citation": {
        "path": "courses/banco-de-dados.md",
        "quote": "Envio final do projeto de modelagem: 14/12/2026 às 18:00, horário de São Paulo"
    }},
]
WINDOWS = [
    {"weekday": 1, "start": "19:00", "end": "21:15"},
    {"weekday": 3, "start": "19:00", "end": "21:15"},
    {"weekday": 6, "start": "14:00", "end": "16:15"},
    {"weekday": 0, "start": "10:00", "end": "12:15"},
]
RECORD = {
    "courses": COURSES,
    "studyWindows": WINDOWS,
    "through": "2026-11-15",
    "targetHours": 5,
    "maxDailyStudyHours": 2,
    "studyBreakMinutes": 15,
    "assumption": "Disponibilidade provisória para duas semanas, sujeita ao calendário.",
}
SESSIONS = {}

def call_bridge(bridge, method, args=None, token=None):
    data = json.dumps({"method": method, "args": args or {}}).encode()
    req = urllib.request.Request(
        bridge["url"], data=data, method="POST",
        headers={"content-type": "application/json", "x-study-run-token": token if token is not None else bridge["token"]},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read())

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def send_json(self, status, payload):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def read_json(self):
        n = int(self.headers.get("content-length", "0"))
        return json.loads(self.rfile.read(n)) if n else {}
    def do_POST(self):
        body = self.read_json()
        if self.path == "/sessions":
            sid = "py-session-1"
            SESSIONS[sid] = {"bridge": body["toolBridge"], "messages": [], "question": None, "phase": "initial"}
            # Probe security boundaries on the Trusted Tool Bridge:
            code_bad_tok, _ = call_bridge(body["toolBridge"], "list_calendar", token="wrong-token")
            assert code_bad_tok == 401, f"Expected 401 for bad token, got {code_bad_tok}"
            code_write, _ = call_bridge(body["toolBridge"], "applyApproved", {"planId": "x", "section": "near"})
            assert code_write == 403, f"Expected 403 for forbidden write tool, got {code_write}"
            return self.send_json(200, {
                "sessionId": sid,
                "engine": {"name": "Python external runner (test)", "revision": "py-1", "mode": "scripted", "model": None, "harness": "python-http-v1"},
                "usage": {"availability": "not_applicable"},
            })
        parts = self.path.strip("/").split("/")
        sid, action = parts[1], parts[2]
        s = SESSIONS[sid]
        if action == "prompt":
            text = body["text"]
            s["messages"].append({"type": "user", "text": text})
            if s["phase"] == "initial":
                for folder in ("courses", "notices"):
                    code, _ = call_bridge(s["bridge"], "list_synthetic_files", {"path": folder})
                    assert code == 200
                for p in ("courses/algoritmos.md", "notices/aviso-turma-n02.md", "courses/banco-de-dados.md"):
                    code, _ = call_bridge(s["bridge"], "read_synthetic_file", {"path": p})
                    assert code == 200
                code, _ = call_bridge(s["bridge"], "list_calendar")
                assert code == 200
                s["question"] = {"requestId": "availability", "questions": [{"id": "availability", "question": "Quantas horas por semana?", "options": []}]}
                s["phase"] = "awaiting_answer"
            elif s["phase"] in ("initial_review", "revised_review"):
                code, _ = call_bridge(s["bridge"], "draft_study_plan", {"weeks": 2})
                assert code == 200
                s["phase"] = "initial_proposal" if s["phase"] == "initial_review" else "revised_proposal"
            elif s["phase"] == "initial_proposal":
                revised = dict(RECORD, studyWindows=[w for w in WINDOWS if w["weekday"] != 1])
                code, _ = call_bridge(s["bridge"], "propose_planning_context", {"record": revised})
                assert code == 200
                s["phase"] = "revised_review"
            return self.send_json(200, {"messages": s["messages"], "question": s["question"], "busy": False, "error": None})
        if action == "answer":
            reply = body["answers"][0]["custom"]
            s["messages"].append({"type": "user", "text": reply})
            s["question"] = None
            code, _ = call_bridge(s["bridge"], "propose_planning_context", {"record": RECORD})
            assert code == 200
            s["phase"] = "initial_review"
            return self.send_json(200, {"messages": s["messages"], "question": None, "busy": False, "error": None})
        return self.send_json(404, {"error": "unknown"})
    def do_GET(self):
        parts = self.path.strip("/").split("/")
        s = SESSIONS[parts[1]]
        return self.send_json(200, {"messages": s["messages"], "question": s["question"], "busy": False, "error": None})
    def do_DELETE(self):
        parts = self.path.strip("/").split("/")
        SESSIONS.pop(parts[1], None)
        return self.send_json(200, {})

server = HTTPServer(("127.0.0.1", 0), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
`;

test('cross-language Python HTTP runner completes Bruno replay through Trusted Tool Bridge and passes probe', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'portable-runner-py-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const bundleDir = path.join(work, 'bruno');
  await packBundle('bruno', bundleDir);
  const bundle = await readBundle(bundleDir);

  const child = spawn('python3', ['-c', PYTHON_RUNNER], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { child.kill('SIGTERM'); });
  const port = await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Python runner exited early (${code}): ${stderr}`)));
    child.stdout.once('data', chunk => resolve(Number(String(chunk).trim())));
  });

  const harness = createInMemoryHarness();
  const resultPath = path.join(work, 'py-result.json');
  const { result, failures } = await runPortableReplay(bundle, 'success', {
    adapter: createHttpRunnerAdapter({ url: `http://127.0.0.1:${port}` }),
    saveResult: async evidence => { await writeFile(resultPath, JSON.stringify(evidence, null, 2) + '\n'); },
    ...harness,
  });

  assert.deepEqual(failures, []);
  assert.equal(result.retirement, 'verified');
  assert.equal(result.engine.name, 'Python external runner (test)');
  assert.equal(result.engine.harness, 'python-http-v1');
  assert.deepEqual(result.engine.tools, [
    'draft_study_plan',
    'list_calendar',
    'list_synthetic_files',
    'propose_planning_context',
    'read_synthetic_file',
  ]);
  assert.ok(result.checks.every(check => check.outcome === 'pass'), JSON.stringify(result.checks));

  const probe = await exec('python3', [path.join(ROOT, 'scripts/paired-replay-probe.py'), '--check-result', bundleDir, resultPath]);
  assert.match(probe.stdout, /Checked case bruno/);
});

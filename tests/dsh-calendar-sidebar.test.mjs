import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const script = await readFile(new URL('../experiments/dsh-calendar-sidebar/client.js', import.meta.url), 'utf8');

test('DSH sidebar spike registers its tab and labels illustrative data', () => {
  let module;
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  const context = { window: { __ModuleLoader__: { load: definition => { assert.equal(definition.id, 'dsh-study-calendar-spike'); module = definition.factory(name => { assert.equal(name, 'react'); return React; }); } } }, navigator: { language: 'en' } };
  vm.runInNewContext(script, context);
  let definition, body;
  module.apply({ effect: fn => fn(), sidebarRightTabs: { register: value => { definition = value; } }, slots: { inject: (name, fn) => { assert.equal(name, 'sidebar.right.pane.tab'); fn(); }, register: (slot, component) => { assert.equal(slot.key, 'dsh-study-calendar-spike'); body = component; } } });
  assert.equal(definition.kind, 'study-calendar-spike');
  const tree = body();
  assert.match(JSON.stringify(tree), /Illustrative synthetic data only/);
  assert.match(JSON.stringify(tree), /not connected to the calendar or approvals/);
  assert.match(JSON.stringify(tree), /560/);
});

test('pinned DSH host registry resolves the package and browser entry', async () => {
  const { ClientModuleRegistry } = await import('@deepseek-ai/dsh-client-modules');
  const registry = Object.create(ClientModuleRegistry.prototype);
  Object.defineProperty(registry, 'ctx', { value: { loader: {} } });
  const entry = new URL('../experiments/dsh-calendar-sidebar/index.js', import.meta.url);
  const metadata = registry.resolveMeta(entry.href, import.meta.url);
  assert.equal(metadata.packageName, 'dsh-study-calendar-spike');
  assert.equal(metadata.meta.clientPath, fileURLToPath(new URL('../experiments/dsh-calendar-sidebar/client.js', import.meta.url)));
  assert.ok(metadata.meta.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'));
});

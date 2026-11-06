import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('English and Brazilian Portuguese contain the same interface keys',async()=>{
  const script=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const prefix=script.slice(0,script.indexOf('await i18next.init'));
  const data=vm.runInNewContext(prefix+'\n;({en,pt})');
  assert.deepEqual(Object.keys(data.en).sort(),Object.keys(data.pt).sort());
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  for(const match of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) {
    assert.ok(data.en[match[1]],'Missing English key '+match[1]);
    assert.ok(data.pt[match[1]],'Missing Portuguese key '+match[1]);
  }
});

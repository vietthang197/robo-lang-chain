import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectUid, endpointUid, configUid, deploymentUid, capabilityUid, serviceUid,
  isShared, parseUid, checkUid,
} from '../core/uid.mjs';

test('builds project uids', () => {
  assert.equal(projectUid('uat','robo-lang-chain','operation','com.x.ChatController#chat'),
    'uat:robo-lang-chain:operation:com.x.ChatController#chat');
  assert.equal(endpointUid('uat','t24','ofs','FUNDS.TRANSFER,ACTR'), 'uat:t24:endpoint:ofs:FUNDS.TRANSFER,ACTR');
  assert.equal(endpointUid('dev','robo-lang-chain','http','GET /document/rag/process/{documentId}'),
    'dev:robo-lang-chain:endpoint:http:GET /document/rag/process/{documentId}');
  assert.equal(configUid('uat','robo-lang-chain','nas.path'), 'uat:robo-lang-chain:config:nas.path');
  assert.equal(deploymentUid('uat','robo-lang-chain'), 'uat:robo-lang-chain:deployment');
  assert.equal(capabilityUid('uat','robo-lang-chain','document-rag'), 'uat:robo-lang-chain:capability:document-rag');
  assert.equal(serviceUid('uat','robo-lang-chain'), 'uat:robo-lang-chain:service:robo-lang-chain');
});

test('recognises shared uids', () => {
  for (const u of ['ext:a.B#c','lib:maven:g:a','tag:java:x.Y','ds:uat:mongodb:db.c','ch:uat:kafka:t','sys:uat:ollama','gap:uat:system:ambiguous-target:ab12','domain:payments'])
    assert.equal(isShared(u), true, u);
  assert.equal(isShared('uat:svc:component:a.B'), false);
});

test('parses project and shared uids', () => {
  assert.deepEqual(parseUid('uat:svc:endpoint:http:GET /a/{id}'),
    { scope: 'project', env: 'uat', projectKey: 'svc', group: 'endpoint', rest: 'http:GET /a/{id}' });
  assert.deepEqual(parseUid('uat:svc:deployment'),
    { scope: 'project', env: 'uat', projectKey: 'svc', group: 'deployment', rest: '' });
  assert.deepEqual(parseUid('ds:uat:mongodb:db.c'),
    { scope: 'shared', env: 'uat', group: 'ds', rest: 'mongodb:db.c' });
  assert.deepEqual(parseUid('lib:maven:g:a'), { scope: 'shared', group: 'lib', rest: 'maven:g:a' });
});

test('checkUid rejects wrong env, project or group', () => {
  const scan = { env: 'uat', projectKey: 'svc' };
  assert.equal(checkUid({ type:'Component', uid:'uat:svc:component:a.B' }, scan), null);
  assert.match(checkUid({ type:'Component', uid:'dev:svc:component:a.B' }, scan), /env/);
  assert.match(checkUid({ type:'Component', uid:'uat:other:component:a.B' }, scan), /projectKey/);
  assert.match(checkUid({ type:'Component', uid:'uat:svc:operation:a.B#x' }, scan), /group/);
  assert.equal(checkUid({ type:'Library', uid:'lib:maven:g:a' }, scan), null);
});

test('checkUid handles shared prefixes, ext and special project types', () => {
  const scan = { env: 'uat', projectKey: 'svc' };
  assert.match(checkUid({ type:'Library', uid:'tag:java:x.Y' }, scan), /prefix/);
  assert.match(checkUid({ type:'DataStore', uid:'ds:dev:mongodb:db.c' }, scan), /env/);
  assert.equal(checkUid({ type:'Domain', uid:'domain:payments' }, scan), null);
  assert.equal(checkUid({ type:'Operation', uid:'ext:a.B#c', props: { external: true } }, scan), null);
  assert.match(checkUid({ type:'Operation', uid:'ext:a.B#c' }, scan), /external/);
  assert.equal(checkUid({ type:'Deployment', uid:'uat:svc:deployment' }, scan), null);
  assert.equal(checkUid({ type:'Service', uid:'uat:svc:service:svc' }, scan), null);
  assert.match(checkUid({ type:'Service', uid:'uat:svc:service:other' }, scan), /Service/);
  assert.match(checkUid({ type:'Widget', uid:'uat:svc:widget:x' }, scan), /type/);
});

test('checkUid skips projectKey comparison for __system__ link bundles', () => {
  const scan = { env: 'uat', projectKey: '__system__' };
  assert.equal(checkUid({ type:'Component', uid:'uat:svc:component:a.B' }, scan), null);
  assert.equal(checkUid({ type:'Service', uid:'uat:other:service:other' }, scan), null);
  assert.match(checkUid({ type:'Component', uid:'dev:svc:component:a.B' }, scan), /env/);
  assert.match(checkUid({ type:'Component', uid:'uat:svc:operation:a.B#x' }, scan), /group/);
});

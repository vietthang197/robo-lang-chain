import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, templateToRegex, stripContextPath } from '../core/url.mjs';

test('normalizes BA urls', () => {
  assert.deepEqual(normalizeUrl('http://localhost:8080/document/rag/process/123?x=1'),
    { host: 'localhost', port: 8080, path: '/document/rag/process/123' });
  assert.deepEqual(normalizeUrl('http://localhost:8080/document/'),
    { host: 'localhost', port: 8080, path: '/document' });
  const re = new RegExp(templateToRegex('/document/rag/process/{documentId}'));
  assert.equal(re.test('/document/rag/process/123'), true);
  assert.equal(re.test('/document/rag/process/123/x'), false);
  assert.equal(new RegExp(templateToRegex('/a.b/{id}')).test('/aXb/1'), false);
  assert.equal(stripContextPath('/b/items/1', '/b'), '/items/1');
  assert.equal(stripContextPath('/items/1', '/b'), null);
});

test('normalizeUrl: default ports, userinfo, fragment, root, bare paths', () => {
  assert.deepEqual(normalizeUrl('https://u:p@API.Partner.com/v1/x/#frag'), { host: 'api.partner.com', port: 443, path: '/v1/x' });
  assert.deepEqual(normalizeUrl('http://h'), { host: 'h', port: 80, path: '/' });
  assert.deepEqual(normalizeUrl('lb://b-service/items/{id}'), { host: 'b-service', port: null, path: '/items/{id}' });
  assert.deepEqual(normalizeUrl('http://[::1]:9000/a'), { host: '[::1]', port: 9000, path: '/a' });
  assert.deepEqual(normalizeUrl('/items/{id}?q=1'), { host: null, port: null, path: '/items/{id}' });
  assert.deepEqual(normalizeUrl('${b.base-url}/items/{id}'), { host: null, port: null, path: '/items/{id}' });
});

test('templateToRegex: anchored, spring {x:regex} vars, escapes', () => {
  assert.equal(templateToRegex('/a/{id}'), '^/a/[^/]+$');
  assert.equal(new RegExp(templateToRegex('/a/{id:\\d+}')).test('/a/12'), true);
  assert.equal(new RegExp(templateToRegex('/a+b')).test('/aab'), false);
});

test('stripContextPath: none, slash, exact, trailing slash', () => {
  assert.equal(stripContextPath('/items/1', null), '/items/1');
  assert.equal(stripContextPath('/items/1', '/'), '/items/1');
  assert.equal(stripContextPath('/b', '/b'), '/');
  assert.equal(stripContextPath('/b/x', 'b/'), '/x');
  assert.equal(stripContextPath('/bx/y', '/b'), null);
});

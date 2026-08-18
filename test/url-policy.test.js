import test from 'node:test';
import assert from 'node:assert/strict';

import { assertPublicHttpUrl, isPrivateAddress } from '../src/url-policy.js';

test('identifies private IPv4 and IPv6 addresses', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.0.0.5'), true);
  assert.equal(isPrivateAddress('172.16.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.20'), true);
  assert.equal(isPrivateAddress('169.254.1.1'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('fd00::1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('accepts public HTTPS URL after public DNS resolution', async () => {
  const result = await assertPublicHttpUrl('https://audio.example.com/track.mp3', async () => [
    { address: '203.0.113.20', family: 4 }
  ]);
  assert.equal(result.protocol, 'https:');
  assert.equal(result.hostname, 'audio.example.com');
});

test('blocks localhost and credential-bearing URLs', async () => {
  await assert.rejects(() => assertPublicHttpUrl('http://localhost/audio.mp3'), /Local\/private/);
  await assert.rejects(() => assertPublicHttpUrl('https://user:pass@example.com/audio.mp3'), /Credentials/);
});

test('blocks hosts that resolve to private networks', async () => {
  await assert.rejects(
    () => assertPublicHttpUrl('https://audio.example.com/track.mp3', async () => [
      { address: '192.168.1.10', family: 4 }
    ]),
    /local\/private network/
  );
});

test('blocks non-http protocols', async () => {
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'), /Only public HTTP or HTTPS/);
});

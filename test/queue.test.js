import test from 'node:test';
import assert from 'node:assert/strict';

import { GuildQueue } from '../src/queue.js';

test('plays queued tracks in order', () => {
  const queue = new GuildQueue(3);
  queue.enqueue({ url: 'https://example.com/a.mp3', name: 'A' });
  queue.enqueue({ url: 'https://example.com/b.mp3', name: 'B' });
  assert.equal(queue.startNext().name, 'A');
  assert.equal(queue.finishCurrent().name, 'B');
  assert.equal(queue.finishCurrent(), null);
});

test('enforces waiting queue limit', () => {
  const queue = new GuildQueue(1);
  queue.enqueue({ url: 'https://example.com/a.mp3' });
  assert.throws(() => queue.enqueue({ url: 'https://example.com/b.mp3' }), /limited to 1/);
});

test('clear removes current and waiting tracks', () => {
  const queue = new GuildQueue(3);
  queue.enqueue({ url: 'https://example.com/a.mp3' });
  queue.enqueue({ url: 'https://example.com/b.mp3' });
  queue.startNext();
  queue.clear();
  assert.deepEqual(queue.snapshot(), { current: null, waiting: [], maxLength: 3 });
});

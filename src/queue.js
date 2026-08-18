export class GuildQueue {
  constructor(maxLength = 50) {
    this.maxLength = maxLength;
    this.current = null;
    this.items = [];
  }

  enqueue(track) {
    if (!track?.url) throw new Error('Track requires a URL.');
    if (this.items.length >= this.maxLength) throw new Error(`Queue is limited to ${this.maxLength} waiting tracks.`);
    this.items.push(Object.freeze({ ...track }));
    return this.items.length;
  }

  startNext() {
    if (this.current) return this.current;
    this.current = this.items.shift() ?? null;
    return this.current;
  }

  finishCurrent() {
    this.current = null;
    return this.startNext();
  }

  skip() {
    this.current = null;
    return this.startNext();
  }

  clear() {
    this.current = null;
    this.items.length = 0;
  }

  snapshot() {
    return {
      current: this.current,
      waiting: [...this.items],
      maxLength: this.maxLength
    };
  }
}

export class SessionError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

export class SessionManager {
  constructor(provider, { maxDurationSeconds = 60, heartbeatMs = 15_000, closeTimeoutMs = 15_000 } = {}) {
    if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 1 || maxDurationSeconds > 300) throw new Error('Session duration must be between 1 and 300 seconds.');
    this.provider = provider;
    this.maxDurationSeconds = maxDurationSeconds;
    this.heartbeatMs = heartbeatMs;
    this.closeTimeoutMs = closeTimeoutMs;
    this.state = 'idle';
    this.shuttingDown = false;
  }

  status() {
    return { state: this.state, ...(this.id ? { id: this.id } : {}), ...(this.usage !== undefined ? { usage: this.usage } : {}), ...(this.error ? { error: this.error } : {}), maxDurationSeconds: this.maxDurationSeconds };
  }

  clearTimers() {
    clearTimeout(this.durationTimer);
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.closeTimer);
  }

  fail(message) {
    if (this.state === 'closed') return;
    this.clearTimers();
    this.state = 'unconfirmed';
    this.error = message;
    this.resolveClose?.();
  }

  async create(sdp) {
    if (this.shuttingDown || !['idle', 'closed'].includes(this.state)) throw new SessionError('A session is already reserved, or its closure is unconfirmed.');
    this.control?.dispose();
    this.generation = Symbol();
    this.startedAt = Date.now();
    this.closePromise = undefined;
    this.resolveClose = undefined;
    this.state = 'creating';
    this.id = undefined;
    this.error = undefined;
    this.usage = undefined;
    this.pending = this.createReserved(sdp);
    return this.pending;
  }

  async createReserved(sdp) {
    const generation = this.generation;
    try {
      const result = await this.provider.create(sdp);
      this.id = result.session.id;
      this.control = this.provider.attach(this.id, {
        onClosed: (usage) => {
          if (generation !== this.generation) return;
          this.clearTimers();
          this.usage = usage;
          this.error = undefined;
          this.state = 'closed';
          this.resolveClose?.();
        },
        onLost: () => { if (generation === this.generation) this.fail('Control connection lost; session closure and final usage are unconfirmed.'); },
        onUsage: (usage) => { if (generation === this.generation) this.usage = usage; },
      });
      await this.control.ready;
      if (this.state !== 'creating') throw new Error('Session ended before setup completed.');
      this.state = 'active';
      this.durationTimer = setTimeout(() => this.close(this.id).catch(() => {}), Math.max(0, this.maxDurationSeconds * 1000 - (Date.now() - this.startedAt)));
      this.heartbeat(this.id);
      if (this.shuttingDown) {
        await this.close(this.id);
        throw new SessionError('Server is shutting down.', 503);
      }
      return result;
    } catch (error) {
      if (this.state !== 'closed') {
        if (error.definitive && !this.id) this.state = 'idle';
        else this.fail('Session setup failed; closure is unconfirmed. Additional sessions are blocked.');
      }
      const detail = error.code ? ` (${error.code})` : '';
      throw new SessionError(error.definitive ? `OpenAI rejected session creation${detail}. Check model access and billing.` : 'Session setup failed. Check server status before continuing.', 502);
    }
  }

  heartbeat(id) {
    if (id !== this.id || this.state !== 'active') throw new SessionError('No matching active session.');
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => this.close(id).catch(() => {}), this.heartbeatMs);
    return this.status();
  }

  async close(id) {
    if (!id || id !== this.id) throw new SessionError('No matching session.');
    if (this.state === 'closed') return this.status();
    if (this.closePromise) { await this.closePromise; return this.status(); }
    this.clearTimers();
    this.state = 'closing';
    this.closePromise = new Promise((resolve) => { this.resolveClose = resolve; });
    this.closeTimer = setTimeout(() => {
      this.fail('Session closure timed out; final usage is unconfirmed.');
      this.control?.dispose();
      this.resolveClose();
    }, this.closeTimeoutMs);
    try { this.control.requestClose(); } catch {
      this.fail('Unable to request session closure; final usage is unconfirmed.');
      this.control?.dispose();
      this.resolveClose();
    }
    await this.closePromise;
    this.closePromise = undefined;
    return this.status();
  }

  async shutdown() {
    this.shuttingDown = true;
    await this.pending?.catch(() => {});
    if (this.id && this.state !== 'closed') await this.close(this.id);
    this.clearTimers();
    this.control?.dispose();
  }
}

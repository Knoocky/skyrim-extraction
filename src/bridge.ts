import { CoreClient, RemoteError, type Projection } from './client.ts';
import type { Command } from './protocol.ts';

export interface WorldProjectionPort {
  // Must freeze economic interactions until apply+readback has succeeded.
  freeze(): void | Promise<void>;
  replaceAndVerify(state: Projection): void | Promise<void>;
  resume(): void | Promise<void>;
}
/** Server-only orchestration; no automatic retry of an unverified game effect. */
export class ProjectionBridge {
  client: CoreClient;
  port: WorldProjectionPort;
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;
  readonly maxPending: number;
  constructor(client: CoreClient, port: WorldProjectionPort, maxPending = 64) {
    if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 1024) throw new Error('INVALID_QUEUE_LIMIT');
    this.client = client; this.port = port; this.maxPending = maxPending;
  }
  get pending() { return this.#pending; }
  #serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.#pending >= this.maxPending) return Promise.reject(new RemoteError('QUEUE_FULL', 429));
    this.#pending++;
    const result = this.#tail.then(work).finally(() => { this.#pending--; });
    this.#tail = result.catch(() => undefined);
    return result;
  }
  async #synchronize() {
    const state = await this.client.projection();
    await this.port.replaceAndVerify(state);
    await this.client.acknowledge(state);
    return state;
  }
  synchronize() {
    return this.#serialize(async () => {
      await this.port.freeze();
      const state = await this.#synchronize();
      await this.port.resume();
      return state;
    });
  }
  execute<T = unknown>(command: Command) {
    return this.#serialize(async () => {
      await this.port.freeze();
      await this.#synchronize();
      const result = await this.client.command<T>(command).catch(error => {
        if (error instanceof RemoteError && error.status >= 400 && error.status < 500 && !error.uncertain) error.commandRejected = true;
        throw error;
      });
      await this.#synchronize();
      await this.port.resume();
      return result;
      // Any failure leaves interactions frozen. Recovery must synchronize before resuming.
    });
  }
}

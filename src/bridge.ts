import { CoreClient, type Projection } from './client.ts';
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
  constructor(client: CoreClient, port: WorldProjectionPort) { this.client = client; this.port = port; }
  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work);
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
      const result = await this.client.command<T>(command);
      await this.#synchronize();
      await this.port.resume();
      return result;
      // Any failure leaves interactions frozen. Recovery must synchronize before resuming.
    });
  }
}

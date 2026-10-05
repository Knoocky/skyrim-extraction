import { createDemoHost } from './demo-host.ts';
const host = await createDemoHost();
host.server.listen(4173, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void host.close());

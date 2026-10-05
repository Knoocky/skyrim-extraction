import { createDemoHost } from './demo-host.ts';
const host = await createDemoHost();
host.server.listen(0, '127.0.0.1', () => {
  const address = host.server.address();
  if (address && typeof address !== 'string') console.log(`Demo only, temporary data: http://127.0.0.1:${address.port}/?demo=1`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void host.close());

import { beforeEach, vi } from 'vitest';

// Guard: no test may reach a real network/provider. Tests that need HTTP inject a stubbed fetchImpl.
beforeEach(() => {
  vi.stubGlobal('fetch', async (url) => {
    throw new Error(`Unexpected real network call in tests: ${url}`);
  });
});

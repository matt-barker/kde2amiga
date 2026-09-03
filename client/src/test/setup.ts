import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { installCanvas } from './installCanvas';
import { installBlobStream } from './installBlobStream';
import { installResizeObserver } from './installResizeObserver';

// The LHA encoder's oracle test shells out to the `lha` binary, so it runs under the
// node environment rather than jsdom. These shims all patch DOM globals that do not
// exist there — and must not, since installing them would mean the oracle was testing
// something other than plain bytes.
if (typeof HTMLCanvasElement !== 'undefined') {
  installCanvas();
  installBlobStream();
  installResizeObserver();
}

// React Testing Library only auto-registers its cleanup when Vitest runs with
// `globals: true`. This project does not, so unmount explicitly between tests —
// otherwise rendered DOM leaks across `it()` blocks and label queries match
// stale elements from a previous render.
afterEach(cleanup);

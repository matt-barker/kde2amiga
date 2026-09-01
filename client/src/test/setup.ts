import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { installCanvas } from './installCanvas';
import { installBlobStream } from './installBlobStream';

installCanvas();
installBlobStream();

// React Testing Library only auto-registers its cleanup when Vitest runs with
// `globals: true`. This project does not, so unmount explicitly between tests —
// otherwise rendered DOM leaks across `it()` blocks and label queries match
// stale elements from a previous render.
afterEach(cleanup);

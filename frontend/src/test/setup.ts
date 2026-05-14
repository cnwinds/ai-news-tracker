import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: vi.fn(),
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

const canvasContextMock = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  restore: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  strokeText: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn((text: string) => ({ width: String(text || '').length * 8 })),
};

Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: vi.fn(() => canvasContextMock),
});

const originalGetComputedStyle = window.getComputedStyle.bind(window);
Object.defineProperty(window, 'getComputedStyle', {
  writable: true,
  value: vi.fn((element: Element) => originalGetComputedStyle(element)),
});

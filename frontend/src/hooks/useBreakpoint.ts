import { Grid } from 'antd';

export function useBreakpoint() {
  const screens = Grid.useBreakpoint();
  // md === false means viewport < 768px; undefined on first paint — treat as desktop
  const isMobile = screens.md === false;
  return { isMobile, screens };
}

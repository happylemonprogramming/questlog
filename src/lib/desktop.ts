/**
 * The desktop app's bridge, when Offerdex runs inside it. The web app works
 * without it; features that need the desktop check `isDesktop()` first.
 */
export interface DesktopBridge {
  version: string;
}

declare global {
  interface Window {
    offerdexDesktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => window.offerdexDesktop;
export const isDesktop = () => !!window.offerdexDesktop;

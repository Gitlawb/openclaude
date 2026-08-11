import { useStartupNotification } from './useStartupNotification.js';
import { getNpmDeprecationNotification } from './npmDeprecationNotification.js';

export function useNpmDeprecationNotification() {
  useStartupNotification(getNpmDeprecationNotification);
}

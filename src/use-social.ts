import { useEffect, useSyncExternalStore } from 'react';
import { DISABLED_SOCIAL, type SocialClient } from './social-client';

const noSubscribe = () => () => {};
const disabled = () => DISABLED_SOCIAL;
export function useSocial(client?: SocialClient) {
  const state = useSyncExternalStore(client?.subscribe ?? noSubscribe, client?.getSnapshot ?? disabled);
  useEffect(() => client?.start(), [client]);
  return state;
}

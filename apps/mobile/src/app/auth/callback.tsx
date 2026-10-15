import { Redirect } from 'expo-router';
import React from 'react';
import { useAuth } from '@/state/auth';

/** OAuth / magic-link return URL: the auth listener already updated the session. */
export default function Callback(): React.JSX.Element {
  const status = useAuth((s) => s.status);
  return <Redirect href={status === 'signed_in' ? '/(tabs)' : '/auth/sign-in'} />;
}

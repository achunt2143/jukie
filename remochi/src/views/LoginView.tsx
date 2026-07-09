import React from 'react';
import { Button, Header, Subheader, Spinner } from 'remochi';
import { useAuth } from '@/store/AuthStore';

export default function LoginView() {
  const { login, isLoading, error } = useAuth();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: 20,
      padding: 32,
    }}>
      <div style={{ fontSize: 64 }}>🎵</div>
      <Header>Jukie</Header>
      <Subheader content="An unofficial Apple Music client" />

      {error && (
        <p style={{ color: 'var(--mochi-error, #c62828)', maxWidth: 320, textAlign: 'center' }}>
          {error}
        </p>
      )}

      {isLoading
        ? <Spinner active styleType="dark" size="large" />
        : (
          <Button variant="affirmative" onClick={login}>
            Sign in with Apple Music
          </Button>
        )
      }

      <p style={{ opacity: 0.4, fontSize: 12, maxWidth: 280, textAlign: 'center' }}>
        Jukie requires an active Apple Music subscription. Your credentials
        are handled entirely by Apple — Jukie never sees your password.
      </p>
    </div>
  );
}

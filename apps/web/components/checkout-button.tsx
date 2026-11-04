'use client';

import Script from 'next/script';
import { useState } from 'react';
import { Button } from './ui';

interface PaddleGlobal {
  Environment: { set(env: string): void };
  Initialize(options: { token: string }): void;
  Checkout: {
    open(options: {
      items: { priceId: string; quantity: number }[];
      customer?: { email: string };
      customData?: Record<string, string>;
    }): void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

/** Opens a Paddle overlay checkout; the webhook then updates the subscription. */
export function CheckoutButton(props: {
  label: string;
  priceId: string;
  clientToken: string;
  environment: 'sandbox' | 'production';
  email: string;
  userId: string;
}) {
  const [ready, setReady] = useState(false);
  return (
    <>
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        onLoad={() => {
          if (!window.Paddle) return;
          if (props.environment === 'sandbox') window.Paddle.Environment.set('sandbox');
          window.Paddle.Initialize({ token: props.clientToken });
          setReady(true);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={!ready}
        onClick={() =>
          window.Paddle?.Checkout.open({
            items: [{ priceId: props.priceId, quantity: 1 }],
            customer: { email: props.email },
            customData: { user_id: props.userId },
          })
        }
      >
        {props.label}
      </Button>
    </>
  );
}

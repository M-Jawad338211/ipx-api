import { handlePaddleEvent, paddleConfig, verifyPaddleSignature } from '@/server/billing';
import { getDb } from '@/server/db';

/** Paddle subscription webhook. Disabled (404) unless PAYMENTS_ENABLED=true. */
export async function POST(request: Request): Promise<Response> {
  const config = paddleConfig();
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!config || !secret) return new Response('Not found', { status: 404 });

  const raw = await request.text();
  if (!verifyPaddleSignature(raw, request.headers.get('paddle-signature'), secret)) {
    return new Response('Invalid signature', { status: 401 });
  }
  let event;
  try {
    event = JSON.parse(raw) as Parameters<typeof handlePaddleEvent>[1];
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const outcome = await handlePaddleEvent(getDb(), event, config.prices);
  console.info(`paddle webhook: ${outcome}`);
  return Response.json({ ok: true });
}

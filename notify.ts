export type Notifier = (text: string) => Promise<boolean>;
// Credentials stay in environment variables. Errors are swallowed so the token can never end up in logs.
export function telegramNotifier(token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID, f: typeof fetch = fetch): Notifier | null {
  if (!token || !chat) return null;
  return async text => {
    try {
      const r = await f(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(8000) });
      return r.ok;
    } catch { return false; }
  };
}

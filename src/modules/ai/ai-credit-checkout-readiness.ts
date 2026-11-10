/** Fail-closed operator rollout. Both the REST purchase action and quota UI share this guard.
 * Do not enable until FM Command commercial billing and the Cakto offers are homologated.
 * Nothing here changes a subscription or grants credits.
 */
export function aiCreditCheckoutReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const target = env.FMCC_IRON_CREDITS_CHECKOUT_URL;
  const token = env.FMCC_IRON_CREDITS_CHECKOUT_TOKEN?.trim();
  return env.IRON_AI_CREDITS_PURCHASE_ENABLED === 'true' &&
    target === 'https://app.fmcommand.com.br/api/internal/iron/ai-credits/checkout' &&
    typeof token === 'string' && token.length >= 32;
}

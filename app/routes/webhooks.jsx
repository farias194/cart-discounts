// app/routes/webhooks.jsx

import { authenticate } from '../shopify.server.js';
import { fetchDiscountThresholds } from '~/services/discount-messages';
import { saveDiscountMessages } from '~/services/metaobject-writer';

export async function action({ request }) {
  try {
    const { admin, topic, shop } = await authenticate.webhook(request);
    console.log(`📨 Webhook received: ${topic} for ${shop}`);

    const relevantTopics = [
      'discounts/create',
      'discounts/update',
      'discounts/delete',
    ];

    if (!relevantTopics.includes(topic)) {
      return new Response('OK', { status: 200 });
    }

    const messages = await fetchDiscountThresholds(admin);
    await saveDiscountMessages(admin, messages);

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return new Response(`Webhook error: ${error.message}`, { status: 500 });
  }
}
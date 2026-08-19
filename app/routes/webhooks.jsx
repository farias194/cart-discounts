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

    // The library returns topics in GraphQL enum form (e.g. DISCOUNTS_CREATE);
    // normalize to lowercase-with-slash so the comparison works either way.
    const normalizedTopic = topic.toLowerCase().replace(/_/g, '/');

    if (!relevantTopics.includes(normalizedTopic)) {
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
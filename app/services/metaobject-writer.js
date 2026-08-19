// app/services/metaobject-writer.js

// Merchant-owned metaobject type for discount thresholds. Each threshold is its
// own entry with native fields, so theme Liquid can read it WITHOUT JSON
// parsing (the `parse_json` filter is not functional in this theme's Liquid era).
const DEFINITION_TYPE = 'discount_threshold';

/**
 * Saves the discount threshold messages as individual metaobject entries
 * (one per discount), each with native fields the theme can read directly.
 *
 * @param {Object} admin - The Shopify Admin API context.
 * @param {Array} messages - The array of threshold messages from fetchDiscountThresholds().
 */
export async function saveDiscountMessages(admin, messages) {
  // 1. Make sure the definition exists (idempotent)
  await ensureThresholdDefinition(admin);

  // 2. Find the Online Store publication so entries are visible to Liquid
  const publicationId = await getOnlineStorePublicationId(admin);

  // 3. Upsert one entry per threshold (sorted ascending so handles are stable)
  const sorted = [...messages].sort((a, b) => a.thresholdMinor - b.thresholdMinor);
  for (let i = 0; i < sorted.length; i++) {
    await upsertThreshold(admin, `discount-${i + 1}`, sorted[i], publicationId);
  }

  console.log(`✅ Synced ${sorted.length} discount threshold(s) as metaobject entries.`);
}

// ============================================================
// PRIVATE HELPER FUNCTIONS
// ============================================================

/**
 * Creates the merchant-owned definition with storefront access and the
 * native fields the theme reads. No-op if it already exists.
 */
async function ensureThresholdDefinition(admin) {
  const mutation = `
    mutation EnsureDefinition {
      metaobjectDefinitionCreate(definition: {
        type: "${DEFINITION_TYPE}"
        name: "Discount Thresholds"
        description: "Discount progress-bar thresholds shown on the cart"
        access: { storefront: PUBLIC_READ }
        fieldDefinitions: [
          { key: "title", name: "Title", type: "single_line_text_field" }
          { key: "label", name: "Label", type: "single_line_text_field" }
          { key: "threshold_minor", name: "Threshold (minor units)", type: "number_integer" }
          { key: "enabled", name: "Enabled", type: "boolean" }
        ]
      }) {
        metaobjectDefinition { id }
        userErrors { field message }
      }
    }
  `;

  const response = await admin.graphql(mutation);
  const result = await response.json();
  const errors = result.data?.metaobjectDefinitionCreate?.userErrors || [];

  const isTakenError = (e) => /already.*taken/i.test(e.message);
  const alreadyExists = errors.some(isTakenError);
  const fatal = errors.filter((e) => !isTakenError(e));

  if (fatal.length > 0) {
    const details = fatal.map((e) => `${e.field}: ${e.message}`).join(', ');
    throw new Error(`Failed to ensure metaobject definition: ${details}`);
  }

  if (alreadyExists) {
    console.log('⚠️ Definition "discount_threshold" already exists (storefront access should be enabled in Custom data).');
  } else {
    console.log('✅ Metaobject definition "discount_threshold" is ready (storefront access: PUBLIC_READ).');
  }
}

/**
 * Creates or updates one threshold entry (handle = `discount-<n>`).
 */
async function upsertThreshold(admin, handle, msg, publicationId) {
  const fields = [
    { key: 'title', value: String(msg.title ?? '') },
    { key: 'label', value: String(msg.label ?? '') },
    { key: 'threshold_minor', value: String(msg.thresholdMinor ?? 0) },
    { key: 'enabled', value: 'true' },
  ];

  const mutation = `
    mutation UpsertThreshold($handle: MetaobjectHandleInput!, $fields: [MetaobjectFieldInput!]!) {
      metaobjectUpsert(handle: $handle, metaobject: { fields: $fields }) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;

  const response = await admin.graphql(mutation, {
    variables: { handle: { type: DEFINITION_TYPE, handle }, fields },
  });
  const result = await response.json();
  const errors = result.data?.metaobjectUpsert?.userErrors || [];

  if (errors.length > 0) {
    const details = errors.map((e) => `${e.field}: ${e.message}`).join(', ');
    throw new Error(`Failed to upsert threshold ${handle}: ${details}`);
  }

  const id = result.data.metaobjectUpsert.metaobject.id;

  if (publicationId) {
    await publishMetaobject(admin, id, publicationId);
  }
}

/**
 * Publishes the metaobject entry to a publication (e.g. Online Store) so
 * theme Liquid (`metaobjects['discount_threshold']`) can see it.
 * Best-effort: logs instead of throwing so the sync can continue.
 */
async function publishMetaobject(admin, id, publicationId) {
  try {
    const mutation = `
      mutation PublishMetaobject($id: ID!, $publications: [PublicationInput!]!) {
        metaobjectPublish(id: $id, publications: $publications) {
          userErrors { field message }
        }
      }
    `;
    const response = await admin.graphql(mutation, {
      variables: { id, publications: [{ publicationId }] },
    });
    const result = await response.json();
    const errors = result.data?.metaobjectPublish?.userErrors || [];
    if (errors.length > 0) {
      console.log(`⚠️ metaobjectPublish: ${errors.map((e) => `${e.field}: ${e.message}`).join(', ')}`);
    }
  } catch (err) {
    console.log(`⚠️ metaobjectPublish failed: ${err.message}`);
  }
}

/**
 * Finds the Online Store publication id. Returns null if not found (best effort).
 */
async function getOnlineStorePublicationId(admin) {
  try {
    const query = `
      query Publications {
        publications(first: 20) {
          nodes { id name }
        }
      }
    `;
    const response = await admin.graphql(query);
    const result = await response.json();
    const pubs = result.data?.publications?.nodes || [];
    const match = pubs.find((p) => /online store/i.test(p.name));
    if (!match) {
      console.log(`⚠️ No "Online Store" publication found (got: ${pubs.map((p) => p.name).join(', ') || 'none'}).`);
    }
    return match?.id || null;
  } catch (err) {
    console.log(`⚠️ Could not look up Online Store publication: ${err.message}`);
    return null;
  }
}

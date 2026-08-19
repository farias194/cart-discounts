// app/services/metaobject-writer.js

// App-owned metaobject type for the discount progress messages.
// Declared in shopify.app.toml as [metaobjects.app.discount_messages],
// AND self-provisioned at runtime below so `shopify app dev` works
// without a deploy (the CLI only creates TOML definitions on deploy).
const DEFINITION_TYPE = '$app:discount_messages';
const MESSAGES_FIELD_KEY = 'messages_json';

/**
 * Saves the discount threshold messages to a Shopify metaobject.
 * Ensures the app-owned "discount_messages" definition exists (with
 * storefront access) before writing the instance.
 *
 * @param {Object} admin - The Shopify Admin API context.
 * @param {Array} messages - The array of threshold messages from fetchDiscountThresholds().
 */
export async function saveDiscountMessages(admin, messages) {
  // 0. Make sure the definition exists (idempotent; safe to call every time)
  await ensureMetaobjectDefinition(admin);

  // 1. The handle (unique ID) for our metaobject instance
  const handle = 'discount_messages';

  // 2. Check if an instance (record) already exists
  let metaobjectId = await getMetaobjectIdByHandle(admin, handle);

  // 3. Prepare the data: Convert the messages array to a JSON string
  const fields = [
    {
      key: MESSAGES_FIELD_KEY,
      value: JSON.stringify(messages),
    },
  ];

  // 4. Create or update the metaobject instance
  if (metaobjectId) {
    // UPDATE existing record
    await updateMetaobject(admin, metaobjectId, fields);
    console.log(`✅ Updated metaobject (ID: ${metaobjectId}) with ${messages.length} messages.`);
  } else {
    // CREATE new record
    await createMetaobject(admin, handle, fields);
    console.log(`✅ Created new metaobject with ${messages.length} messages.`);
  }
}

// ============================================================
// PRIVATE HELPER FUNCTIONS
// ============================================================

/**
 * Creates the app-owned metaobject definition with storefront access,
 * so theme Liquid (`shop.metaobjects['$app:discount_messages']`) can read it.
 * No-op if it already exists.
 */
async function ensureMetaobjectDefinition(admin) {
  const mutation = `
    mutation EnsureDefinition {
      metaobjectDefinitionCreate(definition: {
        type: "${DEFINITION_TYPE}"
        name: "Discount Messages"
        description: "Discount threshold messages shown on the cart progress bar"
        access: { admin: MERCHANT_READ_WRITE, storefront: PUBLIC_READ }
        fieldDefinitions: [
          { key: "${MESSAGES_FIELD_KEY}", name: "Messages JSON", type: "multi_line_text_field" }
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

  // "Type has already been taken" means the definition exists — that's fine.
  const fatal = errors.filter(
    (e) => !(e.field === 'type' && /already.*taken/i.test(e.message))
  );

  if (fatal.length > 0) {
    const details = fatal.map((e) => `${e.field}: ${e.message}`).join(', ');
    throw new Error(`Failed to ensure metaobject definition: ${details}`);
  }

  console.log('✅ Metaobject definition "$app:discount_messages" is ready (storefront access: PUBLIC_READ).');
}

/**
 * Fetches the ID of a metaobject instance by its handle.
 * Returns null if not found.
 */
async function getMetaobjectIdByHandle(admin, handle) {
  const query = `
    query GetMetaobject($handle: String!) {
      metaobjectByHandle(handle: $handle) {
        id
      }
    }
  `;

  const response = await admin.graphql(query, { variables: { handle } });
  const { data } = await response.json();

  return data.metaobjectByHandle?.id || null;
}

/**
 * Creates a new metaobject instance.
 */
async function createMetaobject(admin, handle, fields) {
  const mutation = `
    mutation CreateMetaobject($handle: String!, $fields: [MetaobjectFieldInput!]!) {
      metaobjectCreate(metaobject: {
        type: "${DEFINITION_TYPE}"
        handle: $handle
        fields: $fields
      }) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;

  const response = await admin.graphql(mutation, {
    variables: { handle, fields },
  });
  const result = await response.json();

  if (result.data.metaobjectCreate.userErrors.length > 0) {
    const errors = result.data.metaobjectCreate.userErrors
      .map((e) => `${e.field}: ${e.message}`)
      .join(', ');
    throw new Error(`Failed to create metaobject: ${errors}`);
  }

  return result.data.metaobjectCreate.metaobject.id;
}

/**
 * Updates an existing metaobject instance.
 */
async function updateMetaobject(admin, id, fields) {
  const mutation = `
    mutation UpdateMetaobject($id: ID!, $fields: [MetaobjectFieldInput!]!) {
      metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;

  const response = await admin.graphql(mutation, {
    variables: { id, fields },
  });
  const result = await response.json();

  if (result.data.metaobjectUpdate.userErrors.length > 0) {
    const errors = result.data.metaobjectUpdate.userErrors
      .map((e) => `${e.field}: ${e.message}`)
      .join(', ');
    throw new Error(`Failed to update metaobject: ${errors}`);
  }

  return result.data.metaobjectUpdate.metaobject.id;
}
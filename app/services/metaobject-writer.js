// app/services/metaobject-writer.js

/**
 * Saves the discount threshold messages to a Shopify metaobject.
 * Assumes the "discount_messages" definition already exists in the admin.
 *
 * @param {Object} admin - The Shopify Admin API context.
 * @param {Array} messages - The array of threshold messages from fetchDiscountThresholds().
 */
export async function saveDiscountMessages(admin, messages) {
  // 1. The handle (unique ID) for our metaobject instance
  const handle = 'discount_messages';

  // 2. Check if an instance (record) already exists
  let metaobjectId = await getMetaobjectIdByHandle(admin, handle);

  // 3. Prepare the data: Convert the messages array to a JSON string
  const fields = [
    {
      key: 'messages_json',
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
        type: "discount_messages"
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
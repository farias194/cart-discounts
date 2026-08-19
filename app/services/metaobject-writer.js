// app/services/metaobject-writer.js

// Merchant-owned metaobject type for the discount progress messages.
// Created at runtime via the Admin API (no CLI deploy needed) so theme
// Liquid can read it with the plain, universally-supported key
// `shop.metaobjects['discount_messages']`.
const DEFINITION_TYPE = 'discount_messages';
const MESSAGES_FIELD_KEY = 'messages_json';

/**
 * Saves the discount threshold messages to a Shopify metaobject.
 * Ensures the merchant-owned "discount_messages" definition exists (with
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

  // 2. Find the Online Store publication so the instance is visible to Liquid
  const publicationId = await getOnlineStorePublicationId(admin);

  // 3. Check if an instance (record) already exists
  let metaobjectId = await getMetaobjectIdByHandle(admin, handle);

  // 4. Prepare the data: Convert the messages array to a JSON string
  const fields = [
    {
      key: MESSAGES_FIELD_KEY,
      value: JSON.stringify(messages),
    },
  ];

  // 5. Create or update the metaobject instance (active + published)
  if (metaobjectId) {
    // UPDATE existing record
    await updateMetaobject(admin, metaobjectId, fields);
    if (publicationId) {
      await publishMetaobject(admin, metaobjectId, publicationId);
    }
    console.log(`✅ Updated metaobject (ID: ${metaobjectId}) with ${messages.length} messages.`);
  } else {
    // CREATE new record
    metaobjectId = await createMetaobject(admin, handle, fields, publicationId);
    console.log(`✅ Created new metaobject with ${messages.length} messages.`);
  }

  // 6. Diagnostic: report the status Liquid will actually see
  await logMetaobjectStatus(admin, metaobjectId);
}

// ============================================================
// PRIVATE HELPER FUNCTIONS
// ============================================================

/**
 * Creates the merchant-owned metaobject definition with storefront access,
 * so theme Liquid (`shop.metaobjects['discount_messages']`) can read it.
 * If the definition already exists, ensures storefront access is ON.
 */
async function ensureMetaobjectDefinition(admin) {
  const mutation = `
    mutation EnsureDefinition {
      metaobjectDefinitionCreate(definition: {
        type: "${DEFINITION_TYPE}"
        name: "Discount Messages"
        description: "Discount threshold messages shown on the cart progress bar"
        access: { storefront: PUBLIC_READ }
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

  const isTakenError = (e) => /already.*taken/i.test(e.message);
  const alreadyExists = errors.some(isTakenError);
  const fatal = errors.filter((e) => !isTakenError(e));

  if (fatal.length > 0) {
    const details = fatal.map((e) => `${e.field}: ${e.message}`).join(', ');
    throw new Error(`Failed to ensure metaobject definition: ${details}`);
  }

  if (alreadyExists) {
    // Definition exists — try to ensure storefront access, but never block the
    // sync if the schema differs or the definition can't be located (the user
    // can enable Storefront access manually in Settings → Custom data).
    console.log('⚠️ Definition "discount_messages" already exists — ensuring storefront access (best effort)...');
    try {
      const findQuery = `
        query GetDefinition {
          metaobjectDefinitions(first: 50) {
            nodes { id type }
          }
        }
      `;
      const findResponse = await admin.graphql(findQuery);
      const findResult = await findResponse.json();
      const def = (findResult.data?.metaobjectDefinitions?.nodes || []).find(
        (n) => n.type === DEFINITION_TYPE
      );

      if (def) {
        const updateMutation = `
          mutation UpdateDefinition($id: ID!) {
            metaobjectDefinitionUpdate(id: $id, definition: {
              access: { storefront: PUBLIC_READ }
            }) {
              metaobjectDefinition { id }
              userErrors { field message }
            }
          }
        `;
        const updateResponse = await admin.graphql(updateMutation, { variables: { id: def.id } });
        const updateResult = await updateResponse.json();
        const updateErrors = updateResult.data?.metaobjectDefinitionUpdate?.userErrors || [];
        if (updateErrors.length > 0) {
          console.log(`⚠️ Storefront access update returned: ${updateErrors.map((e) => `${e.field}: ${e.message}`).join(', ')}`);
        } else {
          console.log('✅ Storefront access ensured on existing definition.');
        }
      } else {
        console.log('⚠️ Could not locate the existing definition to update — enable Storefront access manually in Settings → Custom data if the bar still doesn\'t show.');
      }
    } catch (err) {
      console.log(`⚠️ Could not auto-ensure storefront access (${err.message}) — enable it manually in Settings → Custom data if needed.`);
    }
  } else {
    console.log('✅ Metaobject definition "discount_messages" is ready (storefront access: PUBLIC_READ).');
  }
}

/**
 * Fetches the ID of a metaobject instance by its handle.
 * Returns null if not found.
 */
async function getMetaobjectIdByHandle(admin, handle) {
  const query = `
    query GetMetaobject($handle: MetaobjectHandleInput!) {
      metaobjectByHandle(handle: $handle) {
        id
      }
    }
  `;

  const response = await admin.graphql(query, {
    variables: { handle: { type: DEFINITION_TYPE, handle } },
  });
  const { data } = await response.json();

  return data.metaobjectByHandle?.id || null;
}

/**
 * Creates a new metaobject instance, active and published to the Online Store
 * so theme Liquid (`shop.metaobjects`) can see it.
 */
async function createMetaobject(admin, handle, fields, publicationId) {
  const mutation = `
    mutation CreateMetaobject($handle: String!, $fields: [MetaobjectFieldInput!]!, $publications: [PublicationInput!]) {
      metaobjectCreate(
        metaobject: {
          type: "${DEFINITION_TYPE}"
          handle: $handle
          fields: $fields
        }
        publications: $publications
      ) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `;

  const response = await admin.graphql(mutation, {
    variables: {
      handle,
      fields,
      publications: publicationId ? [{ publicationId }] : [],
    },
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
 * Updates an existing metaobject instance, keeping it active.
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

/**
 * Publishes the metaobject instance to a publication (e.g. Online Store).
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
    } else {
      console.log(`📌 Published metaobject to Online Store.`);
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
      console.log(`⚠️ No "Online Store" publication found (got: ${pubs.map((p) => p.name).join(', ') || 'none'}) — instance may not be visible to Liquid until published.`);
    }
    return match?.id || null;
  } catch (err) {
    console.log(`⚠️ Could not look up Online Store publication: ${err.message}`);
    return null;
  }
}

/**
 * Logs the instance status Liquid will see (draft instances return nil).
 */
async function logMetaobjectStatus(admin, id) {
  try {
    const query = `
      query MetaobjectStatus($id: ID!) {
        metaobject(id: $id) { id status }
      }
    `;
    const response = await admin.graphql(query, { variables: { id } });
    const result = await response.json();
    console.log(`📋 Metaobject status: ${result.data?.metaobject?.status ?? '(no status field — not publishable)'}`);
  } catch (err) {
    console.log(`⚠️ Could not read metaobject status: ${err.message}`);
  }
}
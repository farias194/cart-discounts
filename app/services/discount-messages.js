// app/services/discount-messages.js

export async function fetchDiscountThresholds(admin) {
  let data;
  try {
    const response = await admin.graphql(AUTOMATIC_DISCOUNTS_QUERY, {
      variables: { first: 50 },
    });
    const result = await response.json();

    if (result.errors) {
      throw new Error(`Failed to fetch discounts: ${JSON.stringify(result.errors)}`);
    }
    data = result.data;
  } catch (error) {
    throw await withDiscountFieldHint(admin, error);
  }

  const messages = [];

  for (const node of data.discountNodes.nodes) {
    const discount = node?.discount;
    if (!discount) continue;

    if (discount.status !== 'ACTIVE') continue;

    const subtotal = discount.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount;
    if (!subtotal) continue;

    const label = buildLabel(discount);
    if (!label) continue;

    messages.push({
      discountId: node.id,
      title: discount.title,
      thresholdMinor: Math.round(parseFloat(subtotal) * 100),
      label,
      enabled: true,
    });
  }

  return messages.sort((a, b) => a.thresholdMinor - b.thresholdMinor);
}

/**
 * If the discounts query fails with a schema error, introspect the actual
 * shape of the discount types in this API version and append it to the error
 * so the correct query can be written in one shot.
 */
async function withDiscountFieldHint(admin, error) {
  try {
    const response = await admin.graphql(
      `query {
        minSub: __type(name: "DiscountMinimumSubtotal") {
          kind
          fields { name type { kind name ofType { kind name ofType { kind name } } } }
        }
        minQty: __type(name: "DiscountMinimumQuantity") {
          kind
          fields { name type { kind name ofType { kind name ofType { kind name } } } }
        }
        custGets: __type(name: "DiscountCustomerGets") {
          kind
          fields { name type { kind name ofType { kind name ofType { kind name } } } }
        }
        custGetsVal: __type(name: "DiscountCustomerGetsValue") {
          kind
          possibleTypes { name }
        }
        pct: __type(name: "DiscountPercentage") {
          kind
          fields { name type { kind name ofType { kind name ofType { kind name } } } }
        }
        amt: __type(name: "DiscountAmount") {
          kind
          fields { name type { kind name ofType { kind name ofType { kind name } } } }
        }
        money: __type(name: "MoneyV2") {
          kind
          fields { name type { kind name ofType { kind name ofType { kind name } } } }
        }
      }`
    );
    const result = await response.json();
    const d = result.data || {};

    const typeChain = (t) => {
      const parts = [];
      let cur = t;
      while (cur) {
        parts.push(`${cur.kind || ''}:${cur.name || ''}`);
        cur = cur.ofType;
      }
      return parts.join(' > ');
    };
    const typeFields = (t) => (t?.fields || []).map((f) => `${f.name}: ${typeChain(f.type)}`).join('; ');
    const possibleTypes = (t) => (t?.possibleTypes || []).map((p) => p.name).join(', ') || 'n/a';

    return new Error(
      `${error.message} | DiscountMinimumSubtotal fields=[${typeFields(d.minSub)}] | DiscountMinimumQuantity fields=[${typeFields(d.minQty)}] | DiscountCustomerGets fields=[${typeFields(d.custGets)}] | DiscountCustomerGetsValue union=[${possibleTypes(d.custGetsVal)}] | DiscountPercentage fields=[${typeFields(d.pct)}] | DiscountAmount fields=[${typeFields(d.amt)}] | MoneyV2 fields=[${typeFields(d.money)}]`
    );
  } catch {
    return error;
  }
}

function buildLabel(discount) {
  switch (discount.__typename) {
    case 'DiscountAutomaticFreeShipping':
      return 'free shipping';
    case 'DiscountAutomaticBasic': {
      const value = discount.customerGets?.value;
      if (value?.__typename === 'DiscountPercentage') {
        const percent = Math.round(parseFloat(value.percentage) * 100);
        return `${percent}% off`;
      }
      if (value?.__typename === 'DiscountAmount') {
        return `${value.amount.amount} off`;
      }
      return null;
    }
    default:
      return null;
  }
}

const AUTOMATIC_DISCOUNTS_QUERY = `
  query AutomaticDiscounts($first: Int!) {
    discountNodes(first: $first) {
      nodes {
        id
        discount {
          ... on DiscountAutomaticBasic {
            __typename
            title
            status
            minimumRequirement {
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal {
                  amount
                  currencyCode
                }
              }
            }
            customerGets {
              value {
                ... on DiscountPercentage {
                  percentage
                }
                ... on DiscountAmount {
                  amount {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
          ... on DiscountAutomaticFreeShipping {
            __typename
            title
            status
            minimumRequirement {
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

// app/services/discount-messages.js

export async function fetchDiscountThresholds(admin) {
  const response = await admin.graphql(AUTOMATIC_DISCOUNTS_QUERY, {
    variables: { first: 50 },
  });
  const { data, errors } = await response.json();

  if (errors) {
    throw new Error(`Failed to fetch discounts: ${JSON.stringify(errors)}`);
  }

  const messages = [];

  for (const node of data.discounts.nodes) {
    const discount = node?.discount;
    if (!discount) continue;

    if (discount.status !== 'ACTIVE') continue;

    const subtotal = discount.minimumRequirement?.subtotal?.amount;
    if (!subtotal) continue;

    const label = buildLabel(discount);
    if (!label) continue;

    messages.push({
      discountId: discount.id,
      title: discount.title,
      thresholdMinor: Math.round(parseFloat(subtotal) * 100),
      label,
      enabled: true,
    });
  }

  return messages.sort((a, b) => a.thresholdMinor - b.thresholdMinor);
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
    discounts(first: $first) {
      nodes {
        ... on DiscountAutomaticNode {
          discount {
            id
            title
            status
            ... on DiscountAutomaticBasic {
              minimumRequirement {
                ... on DiscountMinimumSubtotal {
                  subtotal {
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
              minimumRequirement {
                ... on DiscountMinimumSubtotal {
                  subtotal {
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
  }
`;
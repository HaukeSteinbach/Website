/**
 * The shop catalogue.
 *
 * One product for now — RecLight, a physical thing that gets posted. Prices and
 * shipping live here rather than in the Stripe dashboard, so what is charged is
 * versioned with the code and a change is reviewable. The browser only ever
 * sends a slug; everything about money is resolved on this side.
 *
 * Hauke is a small business under § 19 UStG, so no VAT is charged and none may
 * be shown on the invoice. Prices are therefore final prices, full stop.
 */

export const CURRENCY = 'eur';

export const PRODUCTS = {
  reclight: {
    slug: 'reclight',
    name: 'RecLight',
    description: 'WiFi recording light for the studio door, with the free AU/VST3 plugin',
    /* The invoice is a German document under German law, so its item line is
       German too — mixing the two on one page reads like an oversight. */
    invoiceDescription: 'WLAN-Aufnahmeleuchte für die Studiotür, mit kostenlosem AU/VST3-Plugin',
    /* Cents. The page has said 30 € since the pre-order went up. */
    priceCents: 3000,
    page: 'reclight.html',
    /* Physical goods: the buyer's address is needed to post it. */
    shipped: true,
    weightNote: 'Small parcel'
  }
};

/**
 * Where it can be posted, and what that costs.
 *
 * Deliberately EU-only for the first batch. Outside the customs union every
 * parcel needs a declaration and the buyer can be charged import fees on
 * arrival — a bad surprise for a thirty-euro item, and not something to
 * discover after taking the money. Adding a country later is one line.
 */
export const SHIPPING = {
  de: {
    label: 'Germany',
    priceCents: 490,
    countries: ['DE'],
    deliveryDays: { min: 2, max: 4 }
  },
  eu: {
    label: 'Europe',
    priceCents: 990,
    countries: [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GR', 'HU',
      'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI',
      'ES', 'SE'
    ],
    deliveryDays: { min: 4, max: 8 }
  }
};

export const ALLOWED_COUNTRIES = [
  ...SHIPPING.de.countries,
  ...SHIPPING.eu.countries
];

export function getProduct(slug) {
  return PRODUCTS[String(slug || '')] || null;
}

/** Cents to something a person reads, in German notation. */
export function formatPrice(cents, currency = CURRENCY) {
  const value = (cents / 100).toFixed(2).replace('.', ',');
  return currency === 'eur' ? `${value} €` : `${value} ${currency.toUpperCase()}`;
}

/**
 * Shipping options in the shape Stripe Checkout wants them.
 *
 * Both are offered to everyone and Stripe shows only what matches the address
 * the buyer picks — cheaper for German buyers without asking them to classify
 * themselves first.
 */
export function shippingOptions() {
  return Object.values(SHIPPING).map((option) => ({
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: option.priceCents, currency: CURRENCY },
      display_name: `${option.label} — ${formatPrice(option.priceCents)}`,
      delivery_estimate: {
        minimum: { unit: 'business_day', value: option.deliveryDays.min },
        maximum: { unit: 'business_day', value: option.deliveryDays.max }
      }
    }
  }));
}

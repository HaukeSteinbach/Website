/**
 * The shop catalogue.
 *
 * Two products: RecLight, a physical thing that gets posted, and Steinbach
 * Chain, a plug-in that is downloaded. Prices and
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
  },

  chain: {
    slug: 'chain',
    name: 'Steinbach Chain',
    description: 'Channel strip plug-in for CLAP, VST3 and AU, one licence',
    invoiceDescription: 'Steinbach Chain, Kanalzug-Plug-in für CLAP, VST3 und AU, eine Lizenz',
    /* Cents. steinbach-chain.html has said 49 € since it went up; the page and
       this line have to be changed together. */
    priceCents: 4900,
    page: 'steinbach-chain.html',
    /* Nothing is posted, so Stripe must not ask for an address: a delivery
       address for a download is a field the buyer fills in for nothing and a
       piece of personal data kept without a reason. */
    shipped: false,
    /* The word that goes into the licence key, between the name and "Key". */
    keyword: 'Chain',
    /* WHY THE DOWNLOAD IS NOT PER BUYER. What is downloaded is the demo: the
       complete plug-in without a time limit, which is turned into the full
       version by entering the key. So the file behind this link is the same
       file the product page hands to anyone who asks, and dressing it up as a
       personal link would suggest a protection that is not there while costing
       every buyer a link that expires. One address, cached by Cloudflare,
       resumable, and it still works in a year when someone sets up a new
       machine. The licence is what is personal, not the file. */
    demo: true
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

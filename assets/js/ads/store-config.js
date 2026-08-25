/**
 * Steinbach Instruments — store configuration
 *
 * Everything in this file is PUBLIC by design. The Supabase anon key is a
 * publishable key (like a Stripe publishable key): it only grants what the
 * database row-level-security policies allow. Secrets (Stripe secret key,
 * service role key) live exclusively in Supabase Edge Function secrets and
 * must never appear anywhere in this repository.
 *
 * Setup: see README-SHOP.md. Until supabaseUrl is filled in, the store layer
 * stays completely dormant and the site behaves exactly as before.
 */
window.STORE_CONFIG = {
  /* From Supabase → Project Settings → API */
  supabaseUrl: 'https://eojchbkieeqyfgfazydk.supabase.co',
  supabaseAnonKey: 'sb_publishable_8IE5BzG1DT9ueGfG7TVMbw_VxYHd2mU',

  /*
   * Newsletter welcome code, shown after a confirmed sign-up. Create it in
   * Stripe as a promotion code (25% off, limited to first purchase) — the
   * discount is enforced by Stripe, this string is only displayed.
   */
  welcomeCode: 'ARCHIVE25',

  /*
   * Per product:
   *  - name/page:    display name and page to return to when checkout is cancelled
   *  - available:    set to true once the Stripe price is configured server-side
   *                  (supabase/functions/_shared/products.ts) — before that the
   *                  page keeps its original "coming soon" button
   *  - priceLabel:   display only; the amount actually charged is always the
   *                  Stripe price object on the server
   *  - downloads:    download keys and their labels; the keys must match the
   *                  `files` keys in _shared/products.ts. With more than one
   *                  entry the labels fill the picker, so name the VERSION
   *                  there ('Plug-in · macOS'), not the action. With a single
   *                  entry there is nothing to pick and the label sits on the
   *                  button itself, so it reads 'Download · macOS'.
   */
  products: {
    'historic-organ': {
      name: 'Historic Organ',
      page: 'historic-organ.html',
      available: true,
      priceLabel: '€80',
      versionLabel: 'v1.2.0',
      patronPriceLabel: '€150',
      downloads: {
        mac: 'Plug-in · macOS',
        macStandalone: 'Standalone app · macOS',
        win: 'Plug-in · Windows',
        kontaktMac: 'Kontakt Library · macOS',
        kontaktWin: 'Kontakt Library · Windows',
      }
    },
    'tine-piano': {
      name: 'Tine Piano',
      page: 'tine-piano.html',
      available: false,
      priceLabel: '€80',
      downloads: { mac: 'Download · macOS' }
    },
    'transistor-organ': {
      name: 'Transistor Organ',
      page: 'transistor-organ.html',
      available: false,
      priceLabel: '€80',
      downloads: { mac: 'Download · macOS' }
    },
    'reed-piano': {
      name: 'Reed Piano',
      page: 'reed-piano.html',
      available: false,
      priceLabel: '€80',
      downloads: { mac: 'Download · macOS' }
    }
  }
};

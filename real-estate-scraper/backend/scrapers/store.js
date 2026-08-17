import db from '../db/index.js';

/**
 * Uloží nebo aktualizuje inzerát a zaznamená změnu ceny.
 * Sdílené všemi scrapery, aby historie cen vznikala všude stejně.
 *
 * @returns {'created'|'updated'|'unchanged'|'skipped'}
 */
export async function upsertListing(listing) {
  if (!listing?.url || !listing.price) return 'skipped';

  const existing = await db('listings').where('url', listing.url).first();

  if (!existing) {
    const [row] = await db('listings')
      .insert({ ...listing, first_seen_at: new Date(), last_scraped: new Date() })
      .returning('id');

    await db('price_history').insert({
      listing_id: row.id ?? row,
      price: listing.price,
      price_per_m2: listing.price_per_m2
    });

    return 'created';
  }

  const priceChanged = Number(existing.price) !== Number(listing.price);

  await db('listings')
    .where('id', existing.id)
    .update({
      ...listing,
      // first_seen_at se nikdy nepřepisuje — drží stáří inzerátu.
      is_discounted: priceChanged && Number(listing.price) < Number(existing.price)
        ? true
        : existing.is_discounted,
      original_price:
        priceChanged && Number(listing.price) < Number(existing.price) && !existing.original_price
          ? existing.price
          : existing.original_price,
      updated_at: new Date(),
      last_scraped: new Date()
    });

  if (priceChanged) {
    await db('price_history').insert({
      listing_id: existing.id,
      price: listing.price,
      price_per_m2: listing.price_per_m2
    });
    return 'updated';
  }

  return 'unchanged';
}

/** Zpracuje dávku inzerátů a vrátí souhrn pro log. */
export async function saveBatch(listings, label = '') {
  const stats = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };

  for (const listing of listings) {
    try {
      stats[await upsertListing(listing)] += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`  ✗ ${listing?.url}: ${err.message}`);
    }
  }

  console.log(
    `  ${label} nových ${stats.created}, změna ceny ${stats.updated}, ` +
      `beze změny ${stats.unchanged}, přeskočeno ${stats.skipped}, chyb ${stats.failed}`
  );
  return stats;
}

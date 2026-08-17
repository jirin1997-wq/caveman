/**
 * Rozšíření schématu na úroveň kotulator.cz:
 * dispozice, typ stavby, stav, vybavenost, lokalita, doba na trhu, zdroj.
 */
export function up(knex) {
  return knex.schema
    .alterTable('listings', (table) => {
      // Typ nabídky — novostavba (projekt) vs. byt (sekundární trh)
      table.enum('listing_type', ['novostavba', 'byt']).notNullable().defaultTo('byt');
      table.integer('completion_year'); // jen novostavby

      // Dispozice jako string ("3+kk"), rooms zůstává jako číselný pomocník
      table.string('disposition', 16);

      // Charakteristika objektu
      table.enum('building_type', ['cihlova', 'panelova', 'smisena']);
      table.enum('condition', ['dobry', 'k_rekonstrukci', 'novostavba']);
      table.boolean('is_tenement').defaultTo(false); // činžovní dům

      // Vybavenost — pole stringů: balkon, terasa, lodzie, sklep, vytah, garaz, parkovani
      table.jsonb('amenities').defaultTo('[]');

      // Lokalita
      table.string('district', 64);      // "Praha 10", "Brno-střed"
      table.string('neighborhood', 64);  // "Vinohrady", "Vršovice"

      // Zdroj a trh
      table.string('source_name', 64);   // "Lexxus Norton", "NovéProjekty"
      table.timestamp('first_seen_at').defaultTo(knex.fn.now());
      table.boolean('is_discounted').defaultTo(false);
      table.decimal('original_price', 15, 2); // cena před zlevněním

      table.index(['listing_type', 'city']);
      table.index(['disposition']);
      table.index(['district']);
      table.index(['size_m2']);
    })
    // Referenční nájmy pro výpočet hrubého výnosu (Kč/m²/měsíc)
    .createTable('rent_benchmarks', (table) => {
      table.increments('id').primary();
      table.string('city', 32).notNullable();
      table.string('district', 64);
      table.decimal('rent_per_m2_month', 8, 2).notNullable();
      table.timestamp('valid_from').defaultTo(knex.fn.now());
      table.unique(['city', 'district']);
    })
    // Agregovaný vývoj cen v čase (plní se snapshotem po každém scrapu)
    .createTable('market_snapshots', (table) => {
      table.increments('id').primary();
      table.string('city', 32).notNullable();
      table.string('district', 64);
      table.enum('listing_type', ['novostavba', 'byt']).notNullable();
      table.decimal('median_price_per_m2', 10, 2);
      table.decimal('median_price', 15, 2);
      table.integer('sample_size');
      table.date('snapshot_date').notNullable();
      table.unique(['city', 'district', 'listing_type', 'snapshot_date']);
      table.index(['city', 'snapshot_date']);
    });
}

export function down(knex) {
  return knex.schema
    .dropTableIfExists('market_snapshots')
    .dropTableIfExists('rent_benchmarks')
    .alterTable('listings', (table) => {
      table.dropColumn('listing_type');
      table.dropColumn('completion_year');
      table.dropColumn('disposition');
      table.dropColumn('building_type');
      table.dropColumn('condition');
      table.dropColumn('is_tenement');
      table.dropColumn('amenities');
      table.dropColumn('district');
      table.dropColumn('neighborhood');
      table.dropColumn('source_name');
      table.dropColumn('first_seen_at');
      table.dropColumn('is_discounted');
      table.dropColumn('original_price');
    });
}

export function up(knex) {
  return knex.schema
    .createTable('listings', (table) => {
      table.increments('id').primary();
      table.string('url').unique().notNullable();
      table.enum('source', ['sreality', 'idnes', 'developer']).notNullable();
      table.string('title').notNullable();
      table.decimal('price', 15, 2).notNullable();
      table.decimal('price_per_m2', 10, 2);
      table.decimal('size_m2', 8, 2);
      table.integer('rooms');
      table.string('address').notNullable();
      table.enum('city', ['praha', 'brno']).notNullable();
      table.decimal('latitude', 10, 8);
      table.decimal('longitude', 11, 8);
      table.text('description');
      table.json('photos');
      table.string('developer');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('last_scraped');
      table.index(['source', 'city']);
      table.index(['price_per_m2']);
      table.index(['rooms']);
    })
    .createTable('price_history', (table) => {
      table.increments('id').primary();
      table.integer('listing_id').unsigned().notNullable();
      table.foreign('listing_id').references('listings.id').onDelete('cascade');
      table.decimal('price', 15, 2).notNullable();
      table.decimal('price_per_m2', 10, 2);
      table.timestamp('recorded_at').defaultTo(knex.fn.now());
      table.index(['listing_id', 'recorded_at']);
    });
}

export function down(knex) {
  return knex.schema
    .dropTableIfExists('price_history')
    .dropTableIfExists('listings');
}

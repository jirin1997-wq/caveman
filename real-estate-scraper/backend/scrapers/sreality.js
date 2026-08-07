import puppeteer from 'puppeteer';
import { db } from '../server.js';
import dotenv from 'dotenv';

dotenv.config();

const CITIES = {
  praha: 1,      // Sreality region ID pro Prahu
  brno: 80       // Brno
};

async function scrapeSreality() {
  let browser;
  try {
    console.log('🔍 Starting Sreality scraper...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const [city, regionId] of Object.entries(CITIES)) {
      await scrapeCity(browser, city, regionId);
    }

    console.log('✓ Sreality scraper finished');
  } catch (err) {
    console.error('✗ Sreality scraper error:', err);
  } finally {
    if (browser) await browser.close();
  }
}

async function scrapeCity(browser, city, regionId) {
  const baseUrl = `https://www.sreality.cz/api/cs/v2/estates?locality_region_id=${regionId}&category_main_cb=1&category_sub_cb=1&per_page=100`;

  console.log(`📍 Scraping ${city}...`);

  try {
    // Sreality má API, ale pro robustnost použijeme web scraping
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    await page.goto(`https://www.sreality.cz/hledani/prodej/byty/${city.toLowerCase()}`, {
      waitUntil: 'domcontentloaded'
    });

    // Scroll to load more listings (Sreality je infinite scroll)
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });

    // Wait for listings to load
    await page.waitForSelector('.estates-item', { timeout: 5000 }).catch(() => {
      console.warn(`⚠ No listings found for ${city}`);
    });

    // Extract listings
    const listings = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.estates-item')).map((el) => {
        const titleEl = el.querySelector('.estates-item__name');
        const priceEl = el.querySelector('.estates-item__price');
        const areaEl = el.querySelector('.estates-item__area');
        const linkEl = el.querySelector('a');

        if (!titleEl || !priceEl) return null;

        const title = titleEl.textContent?.trim() || '';
        const priceText = priceEl.textContent?.trim() || '0';
        const areaText = areaEl?.textContent?.trim() || '';
        const url = linkEl?.href || '';

        // Parse price (remove "Kč" and spaces)
        const price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;

        // Parse area (e.g., "67 m²" → 67)
        const size_m2 = parseFloat(areaText.match(/[\d.]+/)?.[0]) || 0;

        // Extract rooms from title (rough guess)
        const rooms = extractRooms(title);

        return {
          title,
          price,
          size_m2,
          rooms,
          url,
          pricePerM2: size_m2 > 0 ? Math.round(price / size_m2) : 0
        };
      }).filter(Boolean);
    });

    console.log(`  Found ${listings.length} listings`);

    // Save to DB
    for (const listing of listings) {
      try {
        const existing = await db('listings').where('url', listing.url).first();

        if (!existing) {
          // New listing
          const id = await db('listings').insert({
            url: listing.url,
            source: 'sreality',
            title: listing.title,
            price: listing.price,
            price_per_m2: listing.pricePerM2,
            size_m2: listing.size_m2,
            rooms: listing.rooms,
            address: listing.title, // TODO: parse from Sreality detail page
            city: city,
            last_scraped: new Date()
          });

          // Log price in history
          await db('price_history').insert({
            listing_id: id[0],
            price: listing.price,
            price_per_m2: listing.pricePerM2
          });

          console.log(`  ✓ Saved new: ${listing.title}`);
        } else {
          // Update existing
          const priceChanged = existing.price !== listing.price;

          await db('listings').where('id', existing.id).update({
            price: listing.price,
            price_per_m2: listing.pricePerM2,
            last_scraped: new Date()
          });

          if (priceChanged) {
            await db('price_history').insert({
              listing_id: existing.id,
              price: listing.price,
              price_per_m2: listing.pricePerM2
            });
            console.log(`  📉 Price changed: ${listing.title} → ${listing.price} Kč`);
          }
        }
      } catch (err) {
        console.error(`  ✗ Error saving listing: ${listing.url}`, err.message);
      }
    }

    await page.close();
  } catch (err) {
    console.error(`✗ Error scraping ${city}:`, err.message);
  }
}

function extractRooms(title) {
  const match = title.match(/(\d)\+(\d)/);
  if (match) {
    return parseInt(match[1]) + parseInt(match[2]);
  }
  return null;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeSreality().then(() => process.exit(0)).catch(() => process.exit(1));
}

export { scrapeSreality };

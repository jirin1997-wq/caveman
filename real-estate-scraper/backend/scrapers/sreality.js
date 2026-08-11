import puppeteer from 'puppeteer';
import { db } from '../server.js';
import dotenv from 'dotenv';

dotenv.config();

const CITIES = {
  praha: { regionId: 1, lat: 50.0755, lng: 14.4378 },
  brno: { regionId: 80, lat: 49.1922, lng: 16.6113 }
};

async function scrapeSreality() {
  let browser;
  try {
    console.log('🔍 Starting Sreality scraper...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const [city, data] of Object.entries(CITIES)) {
      await scrapeCity(browser, city, data);
    }

    console.log('✓ Sreality scraper finished');
  } catch (err) {
    console.error('✗ Sreality scraper error:', err);
  } finally {
    if (browser) await browser.close();
  }
}

async function scrapeCity(browser, city, cityData) {
  const { regionId, lat, lng } = cityData;
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
        const geo = generateGeoData(lat, lng);

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
            latitude: geo.latitude,
            longitude: geo.longitude,
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

// Generate dummy geo data (centered on city with small random offset)
// TODO: Replace with real geocoding from Sreality API or Google Maps
function generateGeoData(centerLat, centerLng) {
  const offsetLat = (Math.random() - 0.5) * 0.1; // ~5km radius
  const offsetLng = (Math.random() - 0.5) * 0.1;
  return {
    latitude: parseFloat((centerLat + offsetLat).toFixed(6)),
    longitude: parseFloat((centerLng + offsetLng).toFixed(6))
  };
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeSreality().then(() => process.exit(0)).catch(() => process.exit(1));
}

export { scrapeSreality };

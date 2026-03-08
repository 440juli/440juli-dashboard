// api/webhook/[id].js
// Vercel Serverless Function
// Empfängt Discord Webhooks und speichert sie in Supabase

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Service key (nicht anon!) damit wir ohne Login schreiben können
);

export default async function handler(req, res) {
  // Nur POST erlaubt
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id: tabId } = req.query;
  if (!tabId) {
    return res.status(400).json({ error: 'Tab ID fehlt' });
  }

  const body = req.body;

  // Discord Webhook parsen
  const order = parseDiscordWebhook(body);
  order.id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
  order.receivedAt = new Date().toISOString();

  // Alle User-States finden die diesen Tab haben
  const { data: rows, error: fetchError } = await supabase
    .from('dashboard_state')
    .select('user_id, state');

  if (fetchError) {
    console.error('Supabase fetch error:', fetchError);
    return res.status(500).json({ error: 'Datenbankfehler' });
  }

  // Den richtigen User + Tab finden
  let updated = false;
  for (const row of rows) {
    const state = row.state;
    const tab = state?.tabs?.find(t => t.id === tabId);
    if (!tab) continue;

    // Eintrag hinzufügen
    tab.orders = [order, ...(tab.orders || [])];

    // Zurück in Supabase speichern
    const { error: updateError } = await supabase
      .from('dashboard_state')
      .update({ state, updated_at: new Date().toISOString() })
      .eq('user_id', row.user_id);

    if (updateError) {
      console.error('Supabase update error:', updateError);
      return res.status(500).json({ error: 'Speicherfehler' });
    }

    updated = true;
    console.log(`✅ Webhook für Tab "${tab.name}" gespeichert:`, order.product);
    break;
  }

  if (!updated) {
    return res.status(404).json({ error: `Tab "${tabId}" nicht gefunden` });
  }

  return res.status(200).json({ ok: true, id: order.id });
}

// Discord Webhook Body → OrderTracker Format
function parseDiscordWebhook(body) {
  if (body?.embeds?.length > 0) {
    const embed = body.embeds[0];
    const fields = {};
    (embed.fields || []).forEach(f => {
      fields[f.name.toLowerCase()] = f.value;
    });
    return {
      product:       embed.title || fields['produkt'] || fields['product'] || 'Unbekannt',
      sku:           fields['sku'] || fields['artikelnummer'] || '',
      date:          fields['datum'] || fields['date'] || fields['kaufdatum'] || new Date().toISOString().slice(0, 10),
      size:          fields['größe'] || fields['groesse'] || fields['size'] || '—',
      purchasePrice: parseFloat(fields['preis'] || fields['price'] || fields['einkaufspreis'] || '0') || 0,
      shop:          fields['shop'] || fields['store'] || '—',
      orderNumber:   fields['bestellnr'] || fields['order'] || fields['bestellnummer'] || '—',
      note:          embed.description || fields['notiz'] || '',
      imageUrl:      embed.thumbnail?.url || embed.image?.url || '',
    };
  }

  // Fallback: plain text content
  return {
    product:       body.content || 'Discord Webhook',
    sku:           '',
    date:          new Date().toISOString().slice(0, 10),
    size:          '—',
    purchasePrice: 0,
    shop:          '—',
    orderNumber:   '—',
    note:          JSON.stringify(body).slice(0, 500),
    imageUrl:      '',
  };
}

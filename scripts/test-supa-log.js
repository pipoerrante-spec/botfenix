require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const client = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  const payload = {
    id: crypto.randomUUID(),
    conversation_id: 'debug-test',
    channel: 'whatsapp',
    direction: 'incoming',
    phone: '000',
    name: 'Script',
    message: 'Insert desde script',
    metadata: { source: 'script' },
    created_at: new Date().toISOString(),
  };

  const { error } = await client.from('conversation_logs').insert(payload);
  if (error) {
    console.error('Supabase insert error:', error);
  } else {
    console.log('Insert exitoso. Verifica la tabla conversation_logs.');
  }
}

run().catch(console.error);

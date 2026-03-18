import Database from 'better-sqlite3';

const db = new Database('data/database.sqlite');
const keys = ['model_planner', 'model_writer', 'model_critic', 'model_embedding', 'model_vision'];
const settings: Record<string, string> = {};

keys.forEach(key => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  settings[key] = row ? row.value : 'qwen-plus (default)';
});

console.log(JSON.stringify(settings, null, 2));

import Database from 'better-sqlite3';
import fs from 'fs';
const db = new Database('data/database.sqlite');
const row = db.prepare("SELECT md_path FROM reports WHERE title LIKE '%中国电力期货%'").get();
if (row && row.md_path) {
  const content = fs.readFileSync(row.md_path, 'utf8');
  const matches = content.match(/.*###.*/g);
  console.log(matches ? matches.join('\n') : 'No ### found');
} else {
  console.log('Not found');
}

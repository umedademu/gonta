import {DatabaseSync} from 'node:sqlite';
export class Store {
 constructor(file){this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS line_users(id TEXT PRIMARY KEY,session_key TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS line_events(id TEXT PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created INTEGER NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS pairing(code TEXT PRIMARY KEY,session_key TEXT NOT NULL,expires INTEGER NOT NULL);
 `);}
 get(k){const r=this.db.prepare('SELECT value FROM settings WHERE key=?').get(k);return r?JSON.parse(r.value):undefined;}
 set(k,v){this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));}
 pair(code,key){this.db.prepare('DELETE FROM pairing WHERE expires < ?').run(Date.now());this.db.prepare('INSERT INTO pairing VALUES(?,?,?)').run(code,key,Date.now()+600000);}
 consume(code,user){const r=this.db.prepare('SELECT * FROM pairing WHERE code=? AND expires>?').get(code,Date.now());if(!r)return false;this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('DELETE FROM pairing WHERE code=?').run(code);this.bind(user,r.session_key);this.db.exec('COMMIT');return true;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 bind(user,key){this.db.prepare('INSERT INTO line_users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET session_key=excluded.session_key').run(user,key);}
 user(id){return this.db.prepare('SELECT session_key FROM line_users WHERE id=?').get(id)?.session_key;}
 enqueue(e){return this.db.prepare('INSERT OR IGNORE INTO line_events(id,body,created) VALUES(?,?,?)').run(e.webhookEventId,JSON.stringify(e),Date.now()).changes>0;}
 next(){return this.db.prepare("SELECT * FROM line_events WHERE status='pending' ORDER BY created LIMIT 1").get();}
 status(id,status,error=null){this.db.prepare('UPDATE line_events SET status=?,error=? WHERE id=?').run(status,error,id);}
 counts(){return this.db.prepare('SELECT status,count(*) AS count FROM line_events GROUP BY status').all();}
 close(){this.db.close();}
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const ROOT = __dirname;
const db = new Database(path.join(ROOT, 'central-auto.db'));

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vehicles (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, brand TEXT NOT NULL, model TEXT NOT NULL,
 version TEXT, year TEXT, mileage INTEGER DEFAULT 0, price REAL DEFAULT 0, city TEXT, state TEXT, color TEXT,
 fuel TEXT, transmission TEXT, plate_end TEXT, notes TEXT, description TEXT, stock_status TEXT NOT NULL DEFAULT 'AVAILABLE',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS photos (
 id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER NOT NULL, filename TEXT NOT NULL, is_primary INTEGER DEFAULT 0,
 sort_order INTEGER DEFAULT 0, FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider TEXT NOT NULL, name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', access_token TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ads (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, vehicle_id INTEGER NOT NULL,
 title TEXT NOT NULL, description TEXT, price REAL, status TEXT NOT NULL DEFAULT 'DRAFT', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS publications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ad_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', message TEXT, published_at TEXT,
 FOREIGN KEY(ad_id) REFERENCES ads(id) ON DELETE CASCADE, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
`);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, path.join(ROOT, 'uploads')),
    filename: (_, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + path.extname(file.originalname))
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 20 }
});

app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));
app.use('/uploads', express.static(path.join(ROOT, 'uploads')));
app.use(express.static(path.join(ROOT, 'public')));

function auth(req,res,next){
  const token=(req.headers.authorization||'').replace('Bearer ','');
  try { req.user=jwt.verify(token,JWT_SECRET); next(); }
  catch { res.status(401).json({error:'Sessão expirada ou não autorizada.'}); }
}
function vehicleText(v){
  return [v.brand,v.model,v.version,v.year].filter(Boolean).join(' ');
}
function generateDescription(v){
  const lines=[`🚗 ${vehicleText(v)}`];
  if(v.mileage) lines.push(`📏 ${Number(v.mileage).toLocaleString('pt-BR')} km`);
  if(v.fuel) lines.push(`⛽ ${v.fuel}`);
  if(v.transmission) lines.push(`⚙️ ${v.transmission}`);
  if(v.color) lines.push(`🎨 ${v.color}`);
  if(v.price) lines.push(`\n💰 R$ ${Number(v.price).toLocaleString('pt-BR',{minimumFractionDigits:2})}`);
  if(v.city||v.state) lines.push(`📍 ${[v.city,v.state].filter(Boolean).join(' - ')}`);
  if(v.notes) lines.push(`\n${v.notes}`);
  lines.push('\n📲 Entre em contato para mais informações.');
  return lines.join('\n');
}

app.post('/api/auth/register',(req,res)=>{
  const {name,email,password}=req.body||{};
  if(!name||!email||!password||password.length<6) return res.status(400).json({error:'Informe nome, e-mail e senha com pelo menos 6 caracteres.'});
  try{
    const count=db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const hash=bcrypt.hashSync(password,12);
    const info=db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(name,email.toLowerCase().trim(),hash,count===0?'admin':'user');
    const user={id:info.lastInsertRowid,name,email:email.toLowerCase().trim(),role:count===0?'admin':'user'};
    res.json({token:jwt.sign(user,JWT_SECRET,{expiresIn:'7d'}),user});
  }catch(e){res.status(400).json({error:'E-mail já cadastrado ou dados inválidos.'});}
});
app.post('/api/auth/login',(req,res)=>{
  const {email,password}=req.body||{};
  const u=db.prepare('SELECT * FROM users WHERE email=?').get((email||'').toLowerCase().trim());
  if(!u||!bcrypt.compareSync(password||'',u.password_hash)) return res.status(401).json({error:'E-mail ou senha inválidos.'});
  const user={id:u.id,name:u.name,email:u.email,role:u.role};
  res.json({token:jwt.sign(user,JWT_SECRET,{expiresIn:'7d'}),user});
});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));

app.get('/api/dashboard',auth,(req,res)=>{
  const uid=req.user.id;
  const get=(sql)=>db.prepare(sql).get(uid).c;
  res.json({vehicles:get('SELECT COUNT(*) c FROM vehicles WHERE user_id=?'),ads:get('SELECT COUNT(*) c FROM ads WHERE user_id=?'),published:get("SELECT COUNT(*) c FROM ads WHERE user_id=? AND status='PUBLISHED'"),pending:get("SELECT COUNT(*) c FROM ads WHERE user_id=? AND status IN ('PENDING','DRAFT')"),errors:get("SELECT COUNT(*) c FROM publications p JOIN ads a ON a.id=p.ad_id WHERE a.user_id=? AND p.status='ERROR'")});
});

app.get('/api/vehicles',auth,(req,res)=>res.json(db.prepare('SELECT * FROM vehicles WHERE user_id=? ORDER BY id DESC').all(req.user.id)));
app.get('/api/vehicles/:id',auth,(req,res)=>{
  const v=db.prepare('SELECT * FROM vehicles WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if(!v)return res.status(404).json({error:'Veículo não encontrado.'});
  v.photos=db.prepare('SELECT * FROM photos WHERE vehicle_id=? ORDER BY sort_order,id').all(v.id);res.json(v);
});
app.post('/api/vehicles',auth,(req,res)=>{
 const v=req.body||{}; if(!v.brand||!v.model)return res.status(400).json({error:'Marca e modelo são obrigatórios.'});
 const description=v.description||generateDescription(v);
 const info=db.prepare(`INSERT INTO vehicles(user_id,brand,model,version,year,mileage,price,city,state,color,fuel,transmission,plate_end,notes,description,stock_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id,v.brand,v.model,v.version||'',v.year||'',Number(v.mileage)||0,Number(v.price)||0,v.city||'',v.state||'',v.color||'',v.fuel||'',v.transmission||'',v.plate_end||'',v.notes||'',description,v.stock_status||'AVAILABLE');
 res.json({id:info.lastInsertRowid});
});
app.put('/api/vehicles/:id',auth,(req,res)=>{
 const v=req.body||{}; const exists=db.prepare('SELECT id FROM vehicles WHERE id=? AND user_id=?').get(req.params.id,req.user.id); if(!exists)return res.status(404).json({error:'Veículo não encontrado.'});
 const description=v.description||generateDescription(v);
 db.prepare(`UPDATE vehicles SET brand=?,model=?,version=?,year=?,mileage=?,price=?,city=?,state=?,color=?,fuel=?,transmission=?,plate_end=?,notes=?,description=?,stock_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`).run(v.brand,v.model,v.version||'',v.year||'',Number(v.mileage)||0,Number(v.price)||0,v.city||'',v.state||'',v.color||'',v.fuel||'',v.transmission||'',v.plate_end||'',v.notes||'',description,v.stock_status||'AVAILABLE',req.params.id,req.user.id);
 res.json({ok:true});
});
app.delete('/api/vehicles/:id',auth,(req,res)=>{db.prepare('DELETE FROM vehicles WHERE id=? AND user_id=?').run(req.params.id,req.user.id);res.json({ok:true});});
app.post('/api/vehicles/:id/photos',auth,upload.array('photos',20),(req,res)=>{
 const v=db.prepare('SELECT id FROM vehicles WHERE id=? AND user_id=?').get(req.params.id,req.user.id); if(!v)return res.status(404).json({error:'Veículo não encontrado.'});
 const start=db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM photos WHERE vehicle_id=?').get(v.id).n;
 const stmt=db.prepare('INSERT INTO photos(vehicle_id,filename,sort_order,is_primary) VALUES(?,?,?,?)');
 req.files.forEach((f,i)=>stmt.run(v.id,f.filename,start+i,i===0&&start===0?1:0));res.json({ok:true});
});
app.post('/api/vehicles/:id/generate-description',auth,(req,res)=>{const v=db.prepare('SELECT * FROM vehicles WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!v)return res.status(404).json({error:'Não encontrado.'});res.json({description:generateDescription(v)});});

app.get('/api/accounts',auth,(req,res)=>res.json(db.prepare('SELECT id,provider,name,status,created_at FROM accounts WHERE user_id=? ORDER BY id DESC').all(req.user.id)));
app.post('/api/accounts',auth,(req,res)=>{
 const {provider='Meta',name}=req.body||{}; if(!name)return res.status(400).json({error:'Informe um nome para a conta.'});
 const info=db.prepare('INSERT INTO accounts(user_id,provider,name,status) VALUES(?,?,?,?)').run(req.user.id,provider,name,'PENDING');res.json({id:info.lastInsertRowid,message:'Conta criada como preparação de integração. A autenticação oficial ainda precisa ser configurada.'});
});
app.delete('/api/accounts/:id',auth,(req,res)=>{db.prepare('DELETE FROM accounts WHERE id=? AND user_id=?').run(req.params.id,req.user.id);res.json({ok:true});});

app.get('/api/ads',auth,(req,res)=>res.json(db.prepare(`SELECT a.*,v.brand,v.model,v.version,v.year FROM ads a JOIN vehicles v ON v.id=a.vehicle_id WHERE a.user_id=? ORDER BY a.id DESC`).all(req.user.id)));
app.post('/api/ads',auth,(req,res)=>{
 const {vehicle_id,title,description,price}=req.body||{}; const v=db.prepare('SELECT * FROM vehicles WHERE id=? AND user_id=?').get(vehicle_id,req.user.id);if(!v)return res.status(404).json({error:'Veículo não encontrado.'});
 const info=db.prepare('INSERT INTO ads(user_id,vehicle_id,title,description,price,status) VALUES(?,?,?,?,?,?)').run(req.user.id,vehicle_id,title||vehicleText(v),description||v.description,Number(price||v.price), 'DRAFT');res.json({id:info.lastInsertRowid});
});
app.post('/api/ads/:id/publish',auth,(req,res)=>{
 const ad=db.prepare('SELECT * FROM ads WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!ad)return res.status(404).json({error:'Anúncio não encontrado.'});
 const accountIds=Array.isArray(req.body.account_ids)?req.body.account_ids:[]; if(!accountIds.length)return res.status(400).json({error:'Selecione pelo menos uma conta.'});
 const accounts=accountIds.map(id=>db.prepare('SELECT * FROM accounts WHERE id=? AND user_id=?').get(id,req.user.id)).filter(Boolean);
 const ins=db.prepare('INSERT INTO publications(ad_id,account_id,status,message) VALUES(?,?,?,?)');
 for(const a of accounts) ins.run(ad.id,a.id,'ERROR','A publicação real depende da API oficial do canal. Configure OAuth/API da integração antes de publicar.');
 db.prepare("UPDATE ads SET status='PENDING' WHERE id=?").run(ad.id);
 res.json({ok:true,message:'Solicitação registrada. Nenhuma automação de navegador foi executada.',count:accounts.length});
});
app.get('/api/history',auth,(req,res)=>res.json(db.prepare(`SELECT p.*,a.title,v.brand,v.model,ac.name account_name,ac.provider FROM publications p JOIN ads a ON a.id=p.ad_id JOIN vehicles v ON v.id=a.vehicle_id JOIN accounts ac ON ac.id=p.account_id WHERE a.user_id=? ORDER BY p.id DESC`).all(req.user.id)));

app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
app.listen(PORT,()=>console.log(`Central Auto rodando na porta ${PORT}`));

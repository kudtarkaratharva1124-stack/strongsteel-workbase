# StrongSteel Workbase

Operations Management System for StrongSteel — built with React + Vite + Supabase.

## Project Structure

```
strongsteel-workbase/
├── public/
│   ├── icons/
│   │   ├── icon-192.png      ← PWA icon
│   │   └── icon-512.png      ← PWA icon
│   └── manifest.json         ← PWA manifest
├── src/
│   ├── index.html            ← HTML entry point
│   └── app.jsx               ← All React components + logic
├── .env                      ← Your secret keys (never commit this)
├── .gitignore
├── package.json
├── vite.config.js
└── README.md
```

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Edit `.env` with your actual keys:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_GEMINI_API_KEY=your_gemini_key
VITE_FAST2SMS_KEY=your_fast2sms_key   ← optional, for real SMS
VITE_OFFICE_LAT=19.403174
VITE_OFFICE_LNG=72.8717664
VITE_GEOFENCE_RADIUS=150
```

### 3. Run locally
```bash
npm run dev
```
Opens at http://localhost:3000

### 4. Build for production
```bash
npm run build
```
Output goes to `/dist` folder.

## Supabase Tables Required

Run these in your Supabase SQL editor:

```sql
-- Users
create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password text not null,
  name text,
  role text default 'worker',
  designation text,
  mobile text,
  whatsapp text,
  notify boolean default true,
  active boolean default true,
  avatar text,
  color text
);

-- Tasks
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  priority text default 'medium',
  assigned_to uuid references users(id),
  assigned_by uuid references users(id),
  deadline bigint,
  done boolean default false,
  seen boolean default false,
  done_note text,
  created_at bigint
);

-- Punch log
create table punch_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  date text,
  in_time text,
  in_time_ms bigint,
  out_time text,
  hours text
);

-- Mail notifications
create table mail_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  type text,
  from_email text,
  subject text,
  message text,
  draft text,
  sent_at bigint,
  created_at bigint default extract(epoch from now()) * 1000,
  read boolean default false
);

-- Mail settings
create table mail_settings (
  id text primary key,
  gmail_id text,
  incharge_id uuid references users(id)
);

-- Enable realtime on all tables
alter publication supabase_realtime add table users;
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table punch_log;
alter publication supabase_realtime add table mail_notifications;
```

## Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# For production
vercel --prod
```

Add your `.env` variables in Vercel Dashboard → Project → Settings → Environment Variables.

## n8n Webhooks (optional)

In n8n, create workflows triggered by Supabase webhooks for:
- Task assigned → WhatsApp/SMS notification
- Daily summary report → Boss email
- Punch in/out alerts

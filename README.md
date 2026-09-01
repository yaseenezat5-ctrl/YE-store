# POS Cashier Dashboard

## Setup

1. Copy `.env.example` to `.env`
2. Add your Supabase project values:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Start the app:

```bash
npm install
npm start
```

## Run continuously with PM2

PM2 keeps the production server running and restarts it if it exits. The computer
must remain powered on and connected to the network.

```bash
npm install -g pm2
npm run build
npm run pm2:start
npm run pm2:save
```

Useful commands:

```bash
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
```

The app is fixed to port `3000` in both development and production. PM2 runs
the production build through `npm start`, so do not run `npm run dev` at the
same time on the same port.

## Deploy to Vercel

PM2 only keeps a local computer online. To access the app from a phone while
the computer is off, import this repository into Vercel and deploy it as a
Next.js project. Vercel will use `npm run build` automatically and provide a
public URL. Add the same `SUPABASE_URL` and `SUPABASE_ANON_KEY` values in the
Vercel project environment variables if Supabase is enabled.

## Default Login

- Username: `admin`
- Password: `admin123`

## Supabase tables

Create these tables in Supabase SQL editor:

```sql
create table products (
  id text primary key,
  name text,
  price numeric,
  stock integer,
  category text
);

create table branches (
  id text primary key,
  name text,
  status text
);

create table employees (
  id text primary key,
  name text,
  status text
);

create table orders (
  id text primary key,
  type text,
  customer text,
  employee text,
  branch text,
  product text,
  quantity integer,
  total numeric,
  createdAt timestamptz default now()
);
```

## Notes

The app works in local fallback mode even without Supabase credentials. Once the env variables are set, it syncs data to Supabase automatically.

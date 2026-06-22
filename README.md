# PatchReach independent site

Production-oriented inquiry catalog based on the supplied `index 3.html` layout:

- Public Precision Catalog with search, filters, comparison, and quote requests
- PostgreSQL product and inquiry storage
- Private `/admin` dashboard for product publishing and customer follow-up
- Local product image uploads
- SMTP inquiry notifications
- Quantity-aware quote lists and fixed-price PayPal Checkout
- Server-verified orders and PayPal webhook updates
- Docker Compose deployment with Node.js, PostgreSQL, and Nginx

## How product publishing works

1. Open `https://your-domain.com/admin`.
2. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.
3. Select **New product**, enter the SKU, product information, price, and technical dimensions.
4. Upload a JPG, PNG, WebP, or AVIF image under 5 MB.
5. Choose a status:
   - `Draft`: saved in the database but hidden from customers.
   - `Published`: immediately returned by `/api/products` and visible in the catalog.
   - `Archived`: retained in the database but hidden from customers.
6. Save the product. No source-code edit or rebuild is required.

Customer inquiries are inserted into PostgreSQL first and then emailed through SMTP. If email delivery fails, the inquiry remains visible under **Admin → Inquiries**.

## Local setup

Docker is the supported full-stack environment:

```bash
cp .env.example .env
# Edit every password, email, URL, and SMTP value in .env.
docker compose up -d --build
docker compose exec app node server/seed.js
```

Open:

- Public catalog: `http://localhost`
- Admin dashboard: `http://localhost/admin`
- Health check: `http://localhost/api/health`

For a first production deployment, follow [DEPLOYMENT.zh-CN.md](DEPLOYMENT.zh-CN.md). It covers the VPS, Cloudflare Tunnel, clean catalog migration, R2 backups, Sandbox verification, and the controlled PayPal Live switch.

The seed command is idempotent. It creates or updates the initial example products without deleting products added through the admin.

## Ubuntu server deployment

1. Install Docker Engine and the Docker Compose plugin.
2. Clone this repository and create `.env` from `.env.example`.
3. Generate long random values for `POSTGRES_PASSWORD`, `JWT_SECRET`, and `ADMIN_PASSWORD`.
4. Configure a Cloudflare Tunnel with `http://nginx:80` as its origin.
5. Run `docker compose --profile tunnel up -d --build`.
6. Run `scripts/healthcheck.sh`, then migrate the reviewed catalog or add products through `/admin`.

The production host binds Nginx to `127.0.0.1:8080` through `HTTP_BIND`; PostgreSQL is never published. Local development continues to default to port 80.

Back up both named volumes:

- `postgres_data`: products and inquiries
- `product_uploads`: uploaded product images

`scripts/backup.sh` creates database and upload archives and can synchronize them to a private Cloudflare R2 bucket. `scripts/export-catalog.sh` and `scripts/import-catalog.sh` move products and uploads without copying Sandbox orders or inquiry data.

## Required launch edits

- Replace `example.com` and placeholder emails.
- Configure working SMTP credentials and `INQUIRY_TO_EMAIL`.
- Change every default secret.
- Replace concept images with owned product photography as it becomes available.
- Review dimensions and `From` prices before publishing.
- Replace every `REPLACE_BEFORE_LAUNCH` marker in the public policy templates.
- Run `scripts/preflight.sh` on the production host before public launch.

## PayPal checkout setup

Enable **Direct checkout** only for a published product with a fixed USD price. Products with custom or starting prices should continue through the quote workflow.

For Sandbox testing:

1. Create a PayPal Developer app and Sandbox business account.
2. Add `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` to `.env`.
3. Keep `PAYPAL_ENV=sandbox`.
4. Register `https://your-domain.com/api/paypal/webhook`.
5. Subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, and `CUSTOMER.DISPUTE.CREATED`.
6. Add the generated webhook ID as `PAYPAL_WEBHOOK_ID`.
7. Rebuild with `docker compose up -d --build`.

For production, create Live credentials, switch `PAYPAL_ENV=live`, and register the same HTTPS webhook in the Live app. Product payments enter the connected PayPal business account. Shipping is excluded from the first payment and collected separately after confirmation.

## API summary

- `GET /api/products`: published products
- `POST /api/inquiries`: public inquiry submission
- `GET /api/checkout/config`: public checkout configuration
- `POST /api/checkout/orders`: server-priced PayPal order creation
- `POST /api/checkout/orders/:paypalOrderId/capture`: payment capture
- `POST /api/paypal/webhook`: verified PayPal events
- `POST /api/admin/login`: administrator login
- `GET/POST/PUT/DELETE /api/admin/products`: authenticated product management
- `POST /api/admin/upload`: authenticated product-image upload
- `GET/PATCH /api/admin/inquiries`: authenticated inquiry management
- `GET /api/admin/orders`: authenticated order list

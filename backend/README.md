# Backend (FastAPI)

Run locally:

1. pip install -r requirements.txt
2. Copy `.env.example` to `.env` and fill `MONGO_URI`
3. uvicorn main:app --reload

Environment additions for hidden super admin:

- `SUPER_ADMIN_SECRET_PATH=/your-non-guessable-secret-route`
- `JWT_SECRET_KEY=strong-random-secret`

Available endpoints:

- GET /products
- GET /product/{id}
- POST /login
- POST /signup
- POST /auth/google
